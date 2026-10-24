import type { Express } from 'express';
import type { QueryRunner } from 'typeorm';
import {
  AppDataSource,
  API,
  actorWith,
  auth,
  createRoleWith,
  createUser,
  login,
  request,
  setupTestApp,
  superAdmin,
  teardownTestApp,
  type TestActor,
} from '../../helpers/test-app';
import { Permission, RolePermission } from '../../../src/database/entities';
import { ALL_PERMISSIONS, MENU_ACTIONS } from '../../../src/modules/roles-permissions/permission.constants';
import { rbacService } from '../../../src/modules/roles-permissions/rbac.service';
import { seedRbac } from '../../../src/database/seeds/seed-rbac';
import { seedHomeHero } from '../../../src/database/seeds/seed-home-hero';
import { seedModulesPage } from '../../../src/database/seeds/seed-modules-page';
import { CmsHomeHero1794000000000 } from '../../../src/database/migrations/1794000000000-CmsHomeHero';

const ADMIN_URL = `${API}/cms/hero`;
const PUBLIC_URL = `${API}/public/hero`;
const MODULES_PUBLIC_URL = `${API}/public/modules`;

const STALE = 'The home hero section was changed after you opened it. Reload to see the latest version, then make your changes again.';
const UNSAFE_LINK = 'Button link must be a page on this site, starting with /';
const PROGRAMME_NOT_CONFIGURED = 'The programme content has not been configured yet. Run the database seed to create it.';

/* The "Programme at a glance" card as the seeded Modules page sums it: four 120-hour modules, ten domains. */
const SEEDED_GLANCE = { totalHours: 480, modules: 4, domains: 10, districtCount: 36, modulesLabel: '4 × 120 hours', hiddenModules: 0 };

let app: Express;
let admin: TestActor;

interface Pair {
  mr: string;
  en: string;
}
interface AdminSlide {
  id: string;
  tag: Pair;
  title: Pair;
  description: Pair;
  ctaLabel: Pair;
  ctaLink: string;
  displayOrder: number;
  isActive: boolean;
}
interface Detail {
  field: string;
  message: string;
}

const pair = (mr: string, en: string): Pair => ({ mr, en });

/* What the website showed before the hero was managed: content/announcements.ts and the global strings. */
const SEEDED_READ_MORE = pair('अधिक जाणून घ्या', 'Learn more');
const SEEDED_CHECK_STATUS = pair('अर्जाची स्थिती पहा', 'Check Application Status');
const SEEDED_SLIDES = [
  {
    tag: pair('प्रवेश सुरू', 'Admissions open'),
    title: pair('अमृत कलश - कौशल्य प्रशिक्षणासाठी ऑनलाइन अर्ज करा', 'AMRUT Kalash - apply online for skill training'),
    description: pair(
      'खुल्या प्रवर्गातील आर्थिकदृष्ट्या दुर्बल घटकातील युवकांसाठी ४८० तासांचा डिप्लोमा कार्यक्रम.',
      'A 480-hour diploma programme for economically weaker youth from the open category.',
    ),
    ctaLabel: pair('आता अर्ज करा', 'Apply now'),
    ctaLink: '/apply',
  },
  {
    tag: pair('दोन प्रशिक्षण पद्धती', 'Two training modes'),
    title: pair('ऑफलाइन केंद्र किंवा ऑनलाइन - तुमच्या सोयीनुसार निवडा', 'Offline centre or online - choose what suits you'),
    description: pair(
      'मान्यताप्राप्त प्रशिक्षण केंद्रावर किंवा सुमागो LMS द्वारे केंद्रीय ऑनलाइन पद्धतीने प्रशिक्षण.',
      'Train at an approved centre, or centrally online through the SUMAGO LMS.',
    ),
    ctaLabel: pair('अधिक जाणून घ्या', 'Learn more'),
    ctaLink: '/programme',
  },
  {
    tag: pair('प्रमाणपत्र पडताळणी', 'Certificate verification'),
    title: pair('QR कोडद्वारे प्रमाणपत्राची त्वरित पडताळणी', 'Verify any certificate instantly by QR code'),
    description: pair(
      'नियोक्ते व संस्था प्रमाणपत्र क्रमांक टाकून सत्यता तपासू शकतात.',
      'Employers and institutions can confirm authenticity using the certificate number.',
    ),
    ctaLabel: pair('पडताळणी करा', 'Verify now'),
    ctaLink: '/verify',
  },
];

const slide = (n: number, extra: Record<string, unknown> = {}) => ({
  tag: pair(`टॅग ${n}`, `Tag ${n}`),
  title: pair(`शीर्षक ${n}`, `Heading ${n}`),
  description: pair(`वर्णन ${n}`, `Description ${n}`),
  ctaLabel: pair(`बटण ${n}`, `Button ${n}`),
  ctaLink: '/apply',
  ...extra,
});
const validPayload = () => ({
  readMoreLabel: pair('अधिक वाचा', 'Read more'),
  checkStatusLabel: pair('स्थिती तपासा', 'Track my application'),
  slides: [slide(1), slide(2, { ctaLink: '/programme' })],
});

/* A slide as the public feed prints it: words and link only. */
const publicSlide = (s: ReturnType<typeof slide>) => ({
  tag: s.tag,
  title: s.title,
  description: s.description,
  ctaLabel: s.ctaLabel,
  ctaLink: s.ctaLink,
});

const getAdmin = async () => (await request(app).get(ADMIN_URL).set(auth(admin.token)).expect(200)).body.data;
const put = (payload: object) => request(app).put(ADMIN_URL).set(auth(admin.token)).send(payload);
const details = (res: { body: { error: { details: Detail[] } } }) => res.body.error.details;
const auditCount = async (action: string) =>
  (await AppDataSource.query(`SELECT count(*)::int AS n FROM "audit_logs" WHERE "action" = $1`, [action]))[0].n as number;

const lastAuditDetails = async (action: string) =>
  (await AppDataSource.query(`SELECT "details" FROM "audit_logs" WHERE "action" = $1 ORDER BY "createdAt" DESC LIMIT 1`, [action]))[0]
    .details as Record<string, unknown>;

/*
 * resetData() truncates the hero tables and the programme tables, so this file seeds the singleton
 * it edits and the Modules page content the "at a glance" card is summed from.
 */
beforeAll(async () => {
  app = await setupTestApp();
  expect(await seedHomeHero(AppDataSource)).toEqual({ created: true, slidesCreated: 3 });
  await seedModulesPage(AppDataSource);
  admin = await superAdmin();
});
afterAll(teardownTestApp);

describe('Home hero seed', () => {
  it('seeds exactly the banner the website showed, in both languages', async () => {
    const res = await request(app).get(ADMIN_URL).set(auth(admin.token));
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Home hero section retrieved successfully');
    const d = res.body.data;
    expect(d.readMoreLabel).toEqual(SEEDED_READ_MORE);
    expect(d.checkStatusLabel).toEqual(SEEDED_CHECK_STATUS);
    expect(d.isPublished).toBe(true);
    const slides = d.slides as AdminSlide[];
    expect(slides.map(({ id: _id, displayOrder: _o, isActive: _a, ...words }) => words)).toEqual(SEEDED_SLIDES);
    expect(slides.map((s) => s.displayOrder)).toEqual([0, 1, 2]);
    expect(slides.every((s) => s.isActive)).toBe(true);

    const pub = await request(app).get(PUBLIC_URL);
    expect(pub.status).toBe(200);
    expect(pub.body.data).toEqual({ readMoreLabel: SEEDED_READ_MORE, checkStatusLabel: SEEDED_CHECK_STATUS, slides: SEEDED_SLIDES });
  });

  it('returns the documented admin shape', async () => {
    const d = await getAdmin();
    expect(Object.keys(d).sort()).toEqual([
      'checkStatusLabel',
      'createdAt',
      'glance',
      'id',
      'isPublished',
      'readMoreLabel',
      'slides',
      'updatedAt',
    ]);
    expect(Object.keys(d.glance).sort()).toEqual(['districtCount', 'domains', 'hiddenModules', 'modules', 'modulesLabel', 'totalHours']);
    expect(d.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(new Date(d.updatedAt).toISOString()).toBe(d.updatedAt);
    for (const s of d.slides as AdminSlide[]) {
      expect(Object.keys(s).sort()).toEqual(['ctaLabel', 'ctaLink', 'description', 'displayOrder', 'id', 'isActive', 'tag', 'title']);
    }
  });

  it('is idempotent and never overwrites administrator edits on a later run', async () => {
    expect(await seedHomeHero(AppDataSource)).toEqual({ created: false, slidesCreated: 0 });
    const [{ n: heroes }] = await AppDataSource.query(`SELECT count(*)::int AS n FROM "home_hero"`);
    const [{ n: slides }] = await AppDataSource.query(`SELECT count(*)::int AS n FROM "home_hero_slides"`);
    expect([heroes, slides]).toEqual([1, 3]);

    await put(validPayload()).expect(200);
    expect(await seedHomeHero(AppDataSource)).toEqual({ created: false, slidesCreated: 0 });
    const after = await getAdmin();
    expect(after.readMoreLabel).toEqual(pair('अधिक वाचा', 'Read more'));
    expect((after.slides as AdminSlide[]).map((s) => s.title.en)).toEqual(['Heading 1', 'Heading 2']);
  });
});

describe('Home hero management', () => {
  it('saves the whole section, trimming every string, and returns the admin shape', async () => {
    const payload = {
      ...validPayload(),
      checkStatusLabel: pair('  स्थिती  ', '  Status  '),
      slides: [slide(1, { title: pair('  शीर्षक  ', '  Padded heading  '), ctaLink: '  /faq  ' })],
    };
    const res = await put(payload);
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Home hero section updated successfully');
    expect(res.body.data.checkStatusLabel).toEqual(pair('स्थिती', 'Status'));
    expect(res.body.data.slides).toHaveLength(1);
    expect(res.body.data.slides[0]).toMatchObject({
      title: pair('शीर्षक', 'Padded heading'),
      ctaLink: '/faq',
      displayOrder: 0,
      isActive: true,
    });
    expect(await getAdmin()).toEqual(res.body.data);
  });

  it('replaces the slides: adds, removes, reorders and hides', async () => {
    const first = await put({ ...validPayload(), slides: [slide(1), slide(2), slide(3)] }).expect(200);
    const firstIds = (first.body.data.slides as AdminSlide[]).map((s) => s.id);
    expect((first.body.data.slides as AdminSlide[]).map((s) => [s.title.en, s.displayOrder])).toEqual([
      ['Heading 1', 0],
      ['Heading 2', 1],
      ['Heading 3', 2],
    ]);

    /* Slide 2 removed, slide 3 moved first, slide 1 hidden, slide 4 added. */
    const second = await put({
      ...validPayload(),
      slides: [slide(3, { ctaLink: '/verify' }), slide(1, { isActive: false }), slide(4, { ctaLink: '/contact' })],
    }).expect(200);
    const slides = second.body.data.slides as AdminSlide[];
    expect(slides.map((s) => [s.title.en, s.displayOrder, s.isActive, s.ctaLink])).toEqual([
      ['Heading 3', 0, true, '/verify'],
      ['Heading 1', 1, false, '/apply'],
      ['Heading 4', 2, true, '/contact'],
    ]);
    /* Rewritten wholesale: every slide is a new row, and the old rows are soft-deleted, not removed. */
    expect(slides.some((s) => firstIds.includes(s.id))).toBe(false);
    const [{ n: deleted }] = await AppDataSource.query(
      `SELECT count(*)::int AS n FROM "home_hero_slides" WHERE "id" = ANY($1) AND "isDelete" = true AND "isActive" = false`,
      [firstIds],
    );
    expect(deleted).toBe(3);

    /* Hidden slides stay editable in the admin read and never reach the website. */
    const pub = await request(app).get(PUBLIC_URL).expect(200);
    expect(pub.body.data.slides).toEqual([publicSlide(slide(3, { ctaLink: '/verify' })), publicSlide(slide(4, { ctaLink: '/contact' }))]);
  });

  it('orders slides by displayOrder when it is given', async () => {
    const res = await put({ ...validPayload(), slides: [slide(1, { displayOrder: 5 }), slide(2, { displayOrder: 1 })] }).expect(200);
    expect((res.body.data.slides as AdminSlide[]).map((s) => [s.title.en, s.displayOrder])).toEqual([
      ['Heading 2', 1],
      ['Heading 1', 5],
    ]);
    const pub = await request(app).get(PUBLIC_URL).expect(200);
    expect((pub.body.data.slides as { title: Pair }[]).map((s) => s.title.en)).toEqual(['Heading 2', 'Heading 1']);
  });

  it('keeps a line break typed in a description, and leaves slides retired by earlier saves untouched', async () => {
    await put(validPayload()).expect(200);
    const retired = await AppDataSource.query(`SELECT "id", "updatedAt" FROM "home_hero_slides" WHERE "isDelete" = true ORDER BY "id"`);
    expect(retired.length).toBeGreaterThan(0);

    const description = pair('पहिली ओळ\nदुसरी ओळ', 'Line one\nLine two');
    const res = await put({ ...validPayload(), slides: [slide(1, { description })] }).expect(200);
    expect(res.body.data.slides[0].description).toEqual(description);

    const after = await AppDataSource.query(`SELECT "id", "updatedAt" FROM "home_hero_slides" WHERE "id" = ANY($1) ORDER BY "id"`, [
      retired.map((r: { id: string }) => r.id),
    ]);
    expect(after).toEqual(retired);
  });

  it('serves the public feed with the words and links only', async () => {
    const payload = { ...validPayload(), slides: [slide(1), slide(2, { isActive: false }), slide(3, { ctaLink: '/track' })] };
    await put(payload).expect(200);

    const pub = await request(app).get(PUBLIC_URL);
    expect(pub.status).toBe(200);
    expect(pub.body.message).toBe('Home hero section retrieved successfully');
    expect(pub.body.data).toEqual({
      readMoreLabel: payload.readMoreLabel,
      checkStatusLabel: payload.checkStatusLabel,
      slides: [publicSlide(slide(1)), publicSlide(slide(3, { ctaLink: '/track' }))],
    });
    expect(Object.keys(pub.body.data).sort()).toEqual(['checkStatusLabel', 'readMoreLabel', 'slides']);
    for (const s of pub.body.data.slides) expect(Object.keys(s).sort()).toEqual(['ctaLabel', 'ctaLink', 'description', 'tag', 'title']);
    for (const field of ['"id"', '"isActive"', '"isPublished"', '"displayOrder"', '"createdAt"', '"updatedAt"', '"isDelete"', '"heroId"']) {
      expect(JSON.stringify(pub.body.data)).not.toContain(field);
    }
  });

  it('unpublishing makes the public feed return null (200), publishing restores it', async () => {
    const off = await request(app).patch(`${ADMIN_URL}/status`).set(auth(admin.token)).send({ isPublished: false });
    expect(off.status).toBe(200);
    expect(off.body.message).toBe('Home hero section unpublished');
    expect(off.body.data.isPublished).toBe(false);

    const hidden = await request(app).get(PUBLIC_URL);
    expect(hidden.status).toBe(200);
    expect(hidden.body.data).toBeNull();
    expect(hidden.body.message).toBe('Home hero section is not published');
    /* The admin screen still reads and edits an unpublished section, and a save leaves it unpublished. */
    await put(validPayload()).expect(200);
    expect((await getAdmin()).isPublished).toBe(false);
    expect((await request(app).get(PUBLIC_URL)).body.data).toBeNull();

    const on = await request(app).patch(`${ADMIN_URL}/status`).set(auth(admin.token)).send({ isPublished: true });
    expect(on.status).toBe(200);
    expect(on.body.message).toBe('Home hero section published');
    expect((await request(app).get(PUBLIC_URL)).body.data).not.toBeNull();

    /* PUT can carry the switch too. */
    await put({ ...validPayload(), isPublished: false }).expect(200);
    expect((await request(app).get(PUBLIC_URL)).body.data).toBeNull();
    await put({ ...validPayload(), isPublished: true }).expect(200);
    expect((await request(app).get(PUBLIC_URL)).body.data).not.toBeNull();

    const bad = await request(app).patch(`${ADMIN_URL}/status`).set(auth(admin.token)).send({ isPublished: 'yes', extra: 1 });
    expect(bad.status).toBe(422);
  });

  it('audits every save and every publish switch', async () => {
    const { id } = await getAdmin();
    const updates = await auditCount('cms.home-hero.update');
    const statuses = await auditCount('cms.home-hero.status');

    await put({ ...validPayload(), slides: [slide(1), slide(2), slide(3)] }).expect(200);
    await request(app).patch(`${ADMIN_URL}/status`).set(auth(admin.token)).send({ isPublished: true }).expect(200);

    expect(await auditCount('cms.home-hero.update')).toBe(updates + 1);
    expect(await auditCount('cms.home-hero.status')).toBe(statuses + 1);
    const [update] = await AppDataSource.query(
      `SELECT "resource", "resourceId", "outcome", "details", "actorUserId" FROM "audit_logs" WHERE "action" = 'cms.home-hero.update' ORDER BY "createdAt" DESC LIMIT 1`,
    );
    expect(update).toMatchObject({
      resource: 'home-hero',
      resourceId: id,
      actorUserId: admin.user.id,
      details: { isPublished: true, slides: 3 },
    });
    const [status] = await AppDataSource.query(
      `SELECT "resource", "resourceId", "details" FROM "audit_logs" WHERE "action" = 'cms.home-hero.status' ORDER BY "createdAt" DESC LIMIT 1`,
    );
    expect(status).toEqual({ resource: 'home-hero', resourceId: id, details: { isPublished: true } });
  });
});

describe('Home hero "Programme at a glance" card', () => {
  afterAll(async () => {
    await put({ ...validPayload(), districtCount: SEEDED_GLANCE.districtCount }).expect(200);
  });

  it('reports the four figures, summed from the active modules exactly as the website sums them', async () => {
    expect((await getAdmin()).glance).toEqual(SEEDED_GLANCE);

    /* The website's own source for the same card. */
    const pub = (await request(app).get(MODULES_PUBLIC_URL).expect(200)).body.data;
    const modules = pub.modules as { timeSplit: { moduleHours: number }; electives: { no: number }[] }[];
    expect(modules.reduce((sum, m) => sum + m.timeSplit.moduleHours, 0)).toBe(SEEDED_GLANCE.totalHours);
    expect(modules).toHaveLength(SEEDED_GLANCE.modules);
    expect(new Set(modules.flatMap((m) => m.electives.map((d) => d.no))).size).toBe(SEEDED_GLANCE.domains);
    expect(pub.stats.districtCount).toBe(SEEDED_GLANCE.districtCount);
  });

  it('leaves out a hidden module and a hidden domain, and labels modules of different lengths by count alone', async () => {
    const modules: { id: string; isActive: boolean; moduleHours: number; trainingHours: number }[] = await AppDataSource.query(
      `SELECT "id", "isActive", "moduleHours", "trainingHours" FROM "programme_modules" WHERE "isDelete" = false`,
    );
    /* Domain 10 of every module but DS-ADS, so switching them off takes it out of the live modules only. */
    const domainTen: { id: string }[] = await AppDataSource.query(
      `SELECT d."id" FROM "programme_elective_domains" d JOIN "programme_modules" m ON m."id" = d."moduleId"
        WHERE m."code" <> 'DS-ADS' AND d."no" = 10 AND d."isActive" = true AND d."isDelete" = false AND m."isDelete" = false`,
    );
    expect(domainTen).toHaveLength(3);
    try {
      /* DS-ADS hidden with its domains still on, domain 10 off everywhere else, DS-BDS cut to 90 hours. */
      await AppDataSource.query(`UPDATE "programme_modules" SET "isActive" = false WHERE "code" = 'DS-ADS' AND "isDelete" = false`);
      await AppDataSource.query(`UPDATE "programme_elective_domains" SET "isActive" = false WHERE "id" = ANY($1)`, [
        domainTen.map((d) => d.id),
      ]);
      await AppDataSource.query(
        `UPDATE "programme_modules" SET "moduleHours" = 90, "trainingHours" = 69 WHERE "code" = 'DS-BDS' AND "isDelete" = false`,
      );

      const glance = (await getAdmin()).glance;
      expect(glance).toEqual({ totalHours: 330, modules: 3, domains: 9, districtCount: 36, modulesLabel: '3', hiddenModules: 1 });

      /* The website's own source agrees. */
      const pub = (await request(app).get(MODULES_PUBLIC_URL).expect(200)).body.data;
      const live = pub.modules as { timeSplit: { moduleHours: number }; electives: { no: number }[] }[];
      expect(live.reduce((sum, m) => sum + m.timeSplit.moduleHours, 0)).toBe(glance.totalHours);
      expect(live).toHaveLength(glance.modules);
      expect(new Set(live.flatMap((m) => m.electives.map((d) => d.no))).size).toBe(glance.domains);
    } finally {
      for (const m of modules) {
        await AppDataSource.query(
          `UPDATE "programme_modules" SET "isActive" = $2, "moduleHours" = $3, "trainingHours" = $4 WHERE "id" = $1`,
          [m.id, m.isActive, m.moduleHours, m.trainingHours],
        );
      }
      await AppDataSource.query(`UPDATE "programme_elective_domains" SET "isActive" = true WHERE "id" = ANY($1)`, [
        domainTen.map((d) => d.id),
      ]);
    }
    expect((await getAdmin()).glance).toEqual(SEEDED_GLANCE);
  });

  it('carries the card on the PUT and PATCH /status responses too', async () => {
    expect((await put(validPayload()).expect(200)).body.data.glance).toEqual(SEEDED_GLANCE);
    const status = await request(app).patch(`${ADMIN_URL}/status`).set(auth(admin.token)).send({ isPublished: true }).expect(200);
    expect(status.body.data.glance).toEqual(SEEDED_GLANCE);
  });

  it('saves the district count with the hero, and leaves it alone when it is omitted', async () => {
    const res = await put({ ...validPayload(), districtCount: 40 });
    expect(res.status).toBe(200);
    expect(res.body.data.glance).toEqual({ ...SEEDED_GLANCE, districtCount: 40 });
    expect((await getAdmin()).glance.districtCount).toBe(40);
    expect((await request(app).get(MODULES_PUBLIC_URL).expect(200)).body.data.stats.districtCount).toBe(40);

    await put(validPayload()).expect(200);
    expect((await getAdmin()).glance.districtCount).toBe(40);
    expect((await request(app).get(MODULES_PUBLIC_URL).expect(200)).body.data.stats.districtCount).toBe(40);

    /* Both ends of the range, and a numeric string as a form field sends it. */
    expect((await put({ ...validPayload(), districtCount: 0 }).expect(200)).body.data.glance.districtCount).toBe(0);
    expect((await put({ ...validPayload(), districtCount: 9999 }).expect(200)).body.data.glance.districtCount).toBe(9999);
    expect((await put({ ...validPayload(), districtCount: '12' }).expect(200)).body.data.glance.districtCount).toBe(12);
  });

  it('audits the district count when it is sent, and only then', async () => {
    await put({ ...validPayload(), districtCount: 37 }).expect(200);
    expect(await lastAuditDetails('cms.home-hero.update')).toEqual({ isPublished: true, slides: 2, districtCount: 37 });

    await put(validPayload()).expect(200);
    expect(await lastAuditDetails('cms.home-hero.update')).toEqual({ isPublished: true, slides: 2 });
  });

  it('refuses a stale save with 409 without touching the district count', async () => {
    const opened = await getAdmin();
    await put({ ...validPayload(), districtCount: 30, expectedUpdatedAt: opened.updatedAt }).expect(200);
    const stale = await put({ ...validPayload(), districtCount: 31, expectedUpdatedAt: opened.updatedAt });
    expect(stale.status).toBe(409);
    expect((await getAdmin()).glance.districtCount).toBe(30);
  });
});

describe('Home hero validation', () => {
  /* A rejected save changes nothing. */
  let before: unknown;
  beforeAll(async () => {
    await put(validPayload()).expect(200);
    before = await getAdmin();
  });
  afterEach(async () => {
    expect(await getAdmin()).toEqual(before);
  });

  it('requires both halves of every pair, and treats whitespace as blank', async () => {
    const res = await put({
      ...validPayload(),
      readMoreLabel: pair('   ', 'Read more'),
      checkStatusLabel: { mr: 'स्थिती' },
      slides: [
        slide(1, {
          tag: pair('', 'Tag'),
          title: pair('शीर्षक', '   '),
          description: { en: 'Description' },
          ctaLabel: pair('बटण', ''),
          ctaLink: '',
        }),
      ],
    });
    expect(res.status).toBe(422);
    expect(details(res)).toEqual(
      expect.arrayContaining([
        { field: 'body.readMoreLabel.mr', message: 'Learn more button (Marathi) is required' },
        { field: 'body.checkStatusLabel.en', message: 'Check status button (English) is required' },
        { field: 'body.slides.0.tag.mr', message: 'Tag (Marathi) is required' },
        { field: 'body.slides.0.title.en', message: 'Heading (English) is required' },
        { field: 'body.slides.0.description.mr', message: 'Description (Marathi) is required' },
        { field: 'body.slides.0.ctaLabel.en', message: 'Button label (English) is required' },
        { field: 'body.slides.0.ctaLink', message: 'Button link is required' },
      ]),
    );
    /* A blank link says "required" once, not also "must be a page". */
    expect(details(res).filter((d) => d.field === 'body.slides.0.ctaLink')).toHaveLength(1);
  });

  it('refuses control characters with a 422 naming the field, rather than failing in the database', async () => {
    const res = await put({
      ...validPayload(),
      slides: [slide(1, { title: pair('शीर्ष\u0000क', 'Heading'), tag: pair('टॅग', 'Tag\u0007') })],
    });
    expect(res.status).toBe(422);
    expect(details(res)).toEqual(
      expect.arrayContaining([
        { field: 'body.slides.0.title.mr', message: 'Heading (Marathi) contains characters that cannot be displayed' },
        { field: 'body.slides.0.tag.en', message: 'Tag (English) contains characters that cannot be displayed' },
      ]),
    );
  });

  it('enforces the length of every field, and accepts the maximum', async () => {
    const tooLong = await put({
      ...validPayload(),
      readMoreLabel: pair('अ'.repeat(61), 'Read more'),
      checkStatusLabel: pair('स्थिती', 'x'.repeat(61)),
      slides: [
        slide(1, {
          tag: pair('t'.repeat(61), 'Tag'),
          title: pair('शीर्षक', 'h'.repeat(201)),
          description: pair('d'.repeat(401), 'Description'),
          ctaLabel: pair('बटण', 'b'.repeat(61)),
          ctaLink: `/${'a'.repeat(200)}`,
        }),
      ],
    });
    expect(tooLong.status).toBe(422);
    expect(details(tooLong)).toEqual(
      expect.arrayContaining([
        { field: 'body.readMoreLabel.mr', message: 'Learn more button (Marathi) must be at most 60 characters' },
        { field: 'body.checkStatusLabel.en', message: 'Check status button (English) must be at most 60 characters' },
        { field: 'body.slides.0.tag.mr', message: 'Tag (Marathi) must be at most 60 characters' },
        { field: 'body.slides.0.title.en', message: 'Heading (English) must be at most 200 characters' },
        { field: 'body.slides.0.description.mr', message: 'Description (Marathi) must be at most 400 characters' },
        { field: 'body.slides.0.ctaLabel.en', message: 'Button label (English) must be at most 60 characters' },
        { field: 'body.slides.0.ctaLink', message: 'Button link must be at most 200 characters' },
      ]),
    );

    const atMax = {
      readMoreLabel: pair('अ'.repeat(60), 'r'.repeat(60)),
      checkStatusLabel: pair('स'.repeat(60), 'c'.repeat(60)),
      slides: [
        slide(1, {
          tag: pair('t'.repeat(60), 'T'.repeat(60)),
          title: pair('h'.repeat(200), 'H'.repeat(200)),
          description: pair('d'.repeat(400), 'D'.repeat(400)),
          ctaLabel: pair('b'.repeat(60), 'B'.repeat(60)),
          ctaLink: `/${'a'.repeat(199)}`,
        }),
      ],
    };
    const ok = await put(atMax);
    expect(ok.status).toBe(200);
    expect(ok.body.data.slides[0].ctaLink).toHaveLength(200);
    /* Put the baseline back so the shared afterEach check still holds. */
    await put(validPayload()).expect(200);
    before = await getAdmin();
  });

  it('rejects unknown keys at every level', async () => {
    const res = await put({
      ...validPayload(),
      extra: 1,
      readMoreLabel: { ...pair('अधिक', 'More'), hi: 'और' },
      slides: [{ ...slide(1), id: '00000000-0000-0000-0000-000000000000' }],
    });
    expect(res.status).toBe(422);
    const fields = details(res).map((d) => d.field);
    expect(fields).toEqual(expect.arrayContaining(['body', 'body.readMoreLabel', 'body.slides.0']));
  });

  it('requires 1 to 10 slides, at least one of them visible', async () => {
    const none = await put({ ...validPayload(), slides: [] });
    expect(none.status).toBe(422);
    expect(details(none)).toEqual([{ field: 'body.slides', message: 'At least one slide is required' }]);

    const eleven = await put({ ...validPayload(), slides: Array.from({ length: 11 }, (_, i) => slide(i + 1)) });
    expect(eleven.status).toBe(422);
    expect(details(eleven)).toEqual([{ field: 'body.slides', message: 'At most 10 slides' }]);

    const hidden = await put({ ...validPayload(), slides: [slide(1, { isActive: false }), slide(2, { isActive: false })] });
    expect(hidden.status).toBe(422);
    expect(details(hidden)).toEqual([{ field: 'body.slides', message: 'At least one slide must be visible' }]);
  });

  it.each([
    'javascript:alert(1)',
    '//evil.example',
    'https://evil.example',
    '#/apply',
    'apply',
    '/a b',
    '/x"onmouseover=y',
    'data:text/html,x',
  ])('refuses the unsafe link %p', async (ctaLink) => {
    const res = await put({ ...validPayload(), slides: [slide(1, { ctaLink })] });
    expect(res.status).toBe(422);
    expect(details(res)).toEqual([{ field: 'body.slides.0.ctaLink', message: UNSAFE_LINK }]);
  });

  it('accepts any page of this site, with a query or a fragment', async () => {
    const links = ['/', '/programme?tab=objectives#top', '/a-b_c.d~e/f%20g', '/track?id=1&x=2'];
    const res = await put({ ...validPayload(), slides: links.map((ctaLink, i) => slide(i + 1, { ctaLink })) });
    expect(res.status).toBe(200);
    expect((res.body.data.slides as AdminSlide[]).map((s) => s.ctaLink)).toEqual(links);
    await put(validPayload()).expect(200);
    before = await getAdmin();
  });

  it('rejects a malformed expectedUpdatedAt', async () => {
    const res = await put({ ...validPayload(), expectedUpdatedAt: 'yesterday' });
    expect(res.status).toBe(422);
    expect(details(res).map((d) => d.field)).toEqual(['body.expectedUpdatedAt']);
  });

  it.each<[unknown, string]>([
    [-1, 'District count cannot be negative'],
    [10000, 'District count is too large'],
    [1.5, 'District count must be a whole number'],
    ['abc', 'District count must be a number'],
  ])('rejects the district count %p, naming the field', async (districtCount, message) => {
    const res = await put({ ...validPayload(), districtCount });
    expect(res.status).toBe(422);
    expect(details(res).map((d) => d.field)).toEqual(['body.districtCount']);
    expect(details(res)[0].message).toBe(message);
  });
});

describe('Home hero concurrent edits', () => {
  it('saves when expectedUpdatedAt matches, and refuses a stale one with 409 changing nothing', async () => {
    const opened = await getAdmin();

    const first = await put({ ...validPayload(), slides: [slide(7)], expectedUpdatedAt: opened.updatedAt });
    expect(first.status).toBe(200);
    expect(new Date(first.body.data.updatedAt).getTime()).toBeGreaterThan(new Date(opened.updatedAt).getTime());
    const saved = await getAdmin();
    const audits = await auditCount('cms.home-hero.update');

    /* A second screen opened before the first save, now saving over it. */
    const stale = await put({ ...validPayload(), slides: [slide(8)], expectedUpdatedAt: opened.updatedAt });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('CONFLICT');
    expect(stale.body.message).toBe(STALE);
    expect(await getAdmin()).toEqual(saved);
    expect(await auditCount('cms.home-hero.update')).toBe(audits);

    /* A publish switch is a change too. */
    await request(app).patch(`${ADMIN_URL}/status`).set(auth(admin.token)).send({ isPublished: true }).expect(200);
    expect((await put({ ...validPayload(), expectedUpdatedAt: saved.updatedAt })).status).toBe(409);

    /* Without the field, the save is unconditional, as before. */
    expect((await put(validPayload())).status).toBe(200);
  });
});

describe('Home hero permissions', () => {
  it('registers the two permission codes under the menu name', async () => {
    const rows: { code: string; name: string; description: string }[] = await AppDataSource.query(
      `SELECT "code", "name", "description" FROM "permissions" WHERE "code" IN ('cms-hero.view', 'cms-hero.update') AND "isDelete" = false ORDER BY "code"`,
    );
    expect(rows).toEqual([
      { code: 'cms-hero.update', name: 'Update Home Hero Section', description: 'Update in the Home Hero Section menu' },
      { code: 'cms-hero.view', name: 'View Home Hero Section', description: 'View in the Home Hero Section menu' },
    ]);
  });

  it('enforces the CMS permissions; the public feed needs no session', async () => {
    const viewer = await actorWith(['cms-hero.view']);
    expect((await request(app).get(ADMIN_URL).set(auth(viewer.token))).status).toBe(200);
    expect((await request(app).put(ADMIN_URL).set(auth(viewer.token)).send(validPayload())).status).toBe(403);
    expect((await request(app).patch(`${ADMIN_URL}/status`).set(auth(viewer.token)).send({ isPublished: false })).status).toBe(403);

    expect((await request(app).get(ADMIN_URL)).status).toBe(401);
    expect((await request(app).put(ADMIN_URL).send(validPayload())).status).toBe(401);
    expect((await request(app).patch(`${ADMIN_URL}/status`).send({ isPublished: false })).status).toBe(401);
    expect((await request(app).get(PUBLIC_URL)).status).toBe(200);
    expect((await getAdmin()).isPublished).toBe(true);
  });

  it('no longer registers the Home Page Figures menu, and /cms/home is gone', async () => {
    expect(ALL_PERMISSIONS.filter((p) => p.module === 'cms-home')).toEqual([]);
    const [{ n }] = await AppDataSource.query(`SELECT count(*)::int AS n FROM "permissions" WHERE "code" LIKE 'cms-home.%'`);
    expect(n).toBe(0);

    expect((await request(app).get(`${API}/cms/home`).set(auth(admin.token))).status).toBe(404);
    expect((await request(app).patch(`${API}/cms/home`).set(auth(admin.token)).send({ districtCount: 1 })).status).toBe(404);
  });

  /*
   * A database seeded before the merge holds the five cms-home codes and the grants an administrator
   * gave them. The next seed run moves each grant to the matching cms-hero code and retires the old one.
   */
  it('moves grants of the retired cms-home codes to cms-hero on the next seed run', async () => {
    const perms = AppDataSource.getRepository(Permission);
    const old = await perms.save(
      MENU_ACTIONS.map((a) => perms.create({ code: `cms-home.${a}`, name: `${a} Home Page Figures`, module: 'cms-home', description: a })),
    );
    const role = await createRoleWith(['cms-highlight.view']);
    const granted = old.filter((p) => p.code === 'cms-home.view' || p.code === 'cms-home.update');
    await AppDataSource.getRepository(RolePermission).insert(granted.map((p) => ({ roleId: role.id, permissionId: p.id })));

    expect((await seedRbac(AppDataSource)).permissionsRetired).toBe(5);
    rbacService.invalidate();

    const codes: { code: string }[] = await AppDataSource.query(
      `SELECT p."code" FROM "role_permissions" rp JOIN "permissions" p ON p."id" = rp."permissionId"
        WHERE rp."roleId" = $1 AND rp."isDelete" = false ORDER BY p."code"`,
      [role.id],
    );
    expect(codes.map((c) => c.code)).toEqual(['cms-hero.update', 'cms-hero.view', 'cms-highlight.view']);
    const retired: { code: string; isDelete: boolean; isActive: boolean }[] = await AppDataSource.query(
      `SELECT "code", "isDelete", "isActive" FROM "permissions" WHERE "code" LIKE 'cms-home.%' ORDER BY "code"`,
    );
    expect(retired).toHaveLength(5);
    expect(retired.every((p) => p.isDelete && !p.isActive)).toBe(true);

    /* Once only: a second run finds nothing left to move. */
    expect((await seedRbac(AppDataSource)).permissionsRetired).toBe(0);
    rbacService.invalidate();

    /* The moved grants work: the role now edits the whole banner, district count included. */
    const user = await createUser({ roleCodes: [role.code] });
    const token = await login(user.email);
    expect((await request(app).get(ADMIN_URL).set(auth(token))).status).toBe(200);
    const res = await request(app)
      .put(ADMIN_URL)
      .set(auth(token))
      .send({ ...validPayload(), districtCount: SEEDED_GLANCE.districtCount });
    expect(res.status).toBe(200);
  });

  /* A deactivated code gives its holders nothing today, so retiring it must not give them a working cms-hero code. */
  it('retires a cms-home code an administrator switched off without handing its holders the cms-hero one', async () => {
    const perms = AppDataSource.getRepository(Permission);
    const old = await perms.save(
      MENU_ACTIONS.map((a) => perms.create({ code: `cms-home.${a}`, name: `${a} Home Page Figures`, module: 'cms-home', description: a })),
    );
    const role = await createRoleWith(['cms-highlight.view']);
    const granted = old.filter((p) => p.code === 'cms-home.view' || p.code === 'cms-home.update');
    await AppDataSource.getRepository(RolePermission).insert(granted.map((p) => ({ roleId: role.id, permissionId: p.id })));
    const update = granted.find((p) => p.code === 'cms-home.update')!;
    await request(app).patch(`${API}/permissions/${update.id}/status`).set(auth(admin.token)).send({ isActive: false }).expect(200);

    expect((await seedRbac(AppDataSource)).permissionsRetired).toBe(5);
    rbacService.invalidate();

    const codes: { code: string }[] = await AppDataSource.query(
      `SELECT p."code" FROM "role_permissions" rp JOIN "permissions" p ON p."id" = rp."permissionId"
        WHERE rp."roleId" = $1 AND rp."isDelete" = false ORDER BY p."code"`,
      [role.id],
    );
    /* The active code still moves; the switched-off one is retired with its grant and replaced by nothing. */
    expect(codes.map((c) => c.code)).toEqual(['cms-hero.view', 'cms-highlight.view']);
    const [retired] = await AppDataSource.query(`SELECT "isDelete", "isActive" FROM "permissions" WHERE "id" = $1`, [update.id]);
    expect(retired).toEqual({ isDelete: true, isActive: false });
    const [{ n: liveGrants }] = await AppDataSource.query(
      `SELECT count(*)::int AS n FROM "role_permissions" WHERE "permissionId" = $1 AND "isDelete" = false`,
      [update.id],
    );
    expect(liveGrants).toBe(0);
  });
});

describe('Home hero not configured', () => {
  it('reports the missing row to the admin screen (404) and serves null publicly', async () => {
    const qr = AppDataSource.createQueryRunner();
    await qr.connect();
    try {
      /* Soft-deleting the row is what "no configuration" looks like; restored afterwards. */
      await qr.query(`UPDATE "home_hero" SET "isDelete" = true`);
      const res = await request(app).get(ADMIN_URL).set(auth(admin.token));
      expect(res.status).toBe(404);
      expect(res.body.message).toBe('The home hero section has not been configured yet. Run the database seed to create it.');
      expect((await put(validPayload())).status).toBe(404);
      const pub = await request(app).get(PUBLIC_URL);
      expect(pub.status).toBe(200);
      expect(pub.body.data).toBeNull();
    } finally {
      await qr.query(`UPDATE "home_hero" SET "isDelete" = false`);
      await qr.release();
    }
    expect((await request(app).get(ADMIN_URL).set(auth(admin.token))).status).toBe(200);
  });

  it('shows no "at a glance" card while the Modules page is not configured, and refuses the whole save that sends a district count', async () => {
    await put(validPayload()).expect(200);
    try {
      /* Soft-deleting the Modules page configuration is what "not configured" looks like; restored afterwards. */
      await AppDataSource.query(`UPDATE "programme_module_settings" SET "isDelete" = true`);
      const before = await getAdmin();
      expect(before.glance).toBeNull();
      const audits = await auditCount('cms.home-hero.update');

      const refused = await put({ ...validPayload(), readMoreLabel: pair('नवीन', 'Changed'), districtCount: 40 });
      expect(refused.status).toBe(404);
      expect(refused.body.message).toBe(PROGRAMME_NOT_CONFIGURED);
      /* Rolled back as one: the hero's own texts were not saved either. */
      expect(await getAdmin()).toEqual(before);
      expect(await auditCount('cms.home-hero.update')).toBe(audits);

      /* Without a district count the slides are still editable. */
      const saved = await put({ ...validPayload(), readMoreLabel: pair('नवीन', 'Changed') });
      expect(saved.status).toBe(200);
      expect(saved.body.data.glance).toBeNull();
      expect(saved.body.data.readMoreLabel).toEqual(pair('नवीन', 'Changed'));
    } finally {
      await AppDataSource.query(`UPDATE "programme_module_settings" SET "isDelete" = false`);
    }
    expect((await getAdmin()).glance).toEqual(SEEDED_GLANCE);
  });
});

describe('migration 1794000000000', () => {
  /* Runs one statement under a savepoint and reports the PostgreSQL error code, or null when it succeeded. */
  const attempt = async (qr: QueryRunner, sql: string, params: unknown[] = []): Promise<string | null> => {
    await qr.query('SAVEPOINT attempt');
    try {
      await qr.query(sql, params);
      return null;
    } catch (e) {
      const err = e as { code?: string; driverError?: { code?: string } };
      return err.driverError?.code ?? err.code ?? 'unknown';
    } finally {
      await qr.query('ROLLBACK TO SAVEPOINT attempt');
    }
  };

  /*
   * Runs down() then up() inside a transaction that is always rolled back, so the shared test
   * schema is left exactly as the migrations built it whatever happens here.
   */
  it('drops and recreates both tables, with the singleton and the link rule enforced', async () => {
    const migration = new CmsHomeHero1794000000000();
    const qr = AppDataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();
    try {
      await migration.down(qr);
      const [gone] = await qr.query(`SELECT to_regclass('home_hero') AS hero, to_regclass('home_hero_slides') AS slides`);
      expect(gone).toEqual({ hero: null, slides: null });

      await migration.up(qr);
      const [hero] = await qr.query(
        `INSERT INTO "home_hero" ("readMoreLabelMr", "readMoreLabelEn", "checkStatusLabelMr", "checkStatusLabelEn")
         VALUES ('अ', 'Learn more', 'स', 'Check') RETURNING "id", "isPublished"`,
      );
      expect(hero.isPublished).toBe(true);

      /* One live configuration, ever. */
      expect(
        await attempt(
          qr,
          `INSERT INTO "home_hero" ("readMoreLabelMr", "readMoreLabelEn", "checkStatusLabelMr", "checkStatusLabelEn") VALUES ('a','b','c','d')`,
        ),
      ).toBe('23505');
      expect(
        await attempt(
          qr,
          `INSERT INTO "home_hero" ("readMoreLabelMr", "readMoreLabelEn", "checkStatusLabelMr", "checkStatusLabelEn", "isDelete") VALUES ('a','b','c','d', true)`,
        ),
      ).toBeNull();
      expect(await attempt(qr, `UPDATE "home_hero" SET "checkStatusLabelEn" = '  '`)).toBe('23514');

      const insertSlide = (ctaLink: string, extra = '') =>
        attempt(
          qr,
          `INSERT INTO "home_hero_slides" ("heroId", "tagMr", "tagEn", "titleMr", "titleEn", "descriptionMr", "descriptionEn",
             "ctaLabelMr", "ctaLabelEn", "ctaLink"${extra ? ', "displayOrder"' : ''})
           VALUES ($1, 't', 't', 'h', 'h', 'd', 'd', 'b', 'b', $2${extra ? `, ${extra}` : ''})`,
          [hero.id, ctaLink],
        );
      expect(await insertSlide('/apply')).toBeNull();
      expect(await insertSlide('/programme?x=1#top')).toBeNull();
      for (const bad of ['javascript:x', '//evil.example', 'https://evil.example', '#/apply', 'apply', '/a b', '']) {
        expect([bad, await insertSlide(bad)]).toEqual([bad, '23514']);
      }
      expect(await insertSlide('/apply', '-1')).toBe('23514');
      expect(await insertSlide('/apply'.padEnd(201, 'x'))).toBe('22001');

      /* The foreign key: a slide must belong to a hero, and a hero with slides cannot be removed. */
      expect(
        await attempt(
          qr,
          `INSERT INTO "home_hero_slides" ("heroId", "tagMr", "tagEn", "titleMr", "titleEn", "descriptionMr", "descriptionEn", "ctaLabelMr", "ctaLabelEn", "ctaLink")
           VALUES (gen_random_uuid(), 't', 't', 'h', 'h', 'd', 'd', 'b', 'b', '/apply')`,
        ),
      ).toBe('23503');
      await qr.query(
        `INSERT INTO "home_hero_slides" ("heroId", "tagMr", "tagEn", "titleMr", "titleEn", "descriptionMr", "descriptionEn", "ctaLabelMr", "ctaLabelEn", "ctaLink")
         VALUES ($1, 't', 't', 'h', 'h', 'd', 'd', 'b', 'b', '/apply')`,
        [hero.id],
      );
      /*
       * The delete is refused by ON DELETE RESTRICT. Newer PostgreSQL reports restrict_violation (23001);
       * PostgreSQL 17 and earlier report the generic foreign_key_violation (23503).
       */
      expect(['23001', '23503']).toContain(await attempt(qr, `DELETE FROM "home_hero" WHERE "id" = $1`, [hero.id]));

      const triggers: { tgname: string }[] = await qr.query(
        `SELECT tgname FROM pg_trigger WHERE tgname IN ('TRG_home_hero_updated_at', 'TRG_home_hero_slides_updated_at') ORDER BY tgname`,
      );
      expect(triggers.map((t) => t.tgname)).toEqual(['TRG_home_hero_slides_updated_at', 'TRG_home_hero_updated_at']);
      const [idx] = await qr.query(`SELECT indexdef FROM pg_indexes WHERE indexname = 'IDX_home_hero_slides_heroId'`);
      expect(idx.indexdef).toContain('"heroId"');
    } finally {
      await qr.rollbackTransaction();
      await qr.release();
    }
    /* The rollback left the seeded section in place. */
    expect((await request(app).get(ADMIN_URL).set(auth(admin.token))).status).toBe(200);
  });
});
