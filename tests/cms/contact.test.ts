import type { Express } from 'express';
import { AppDataSource, API, actorWith, auth, request, setupTestApp, superAdmin, teardownTestApp, type TestActor } from '../helpers/test-app';
import { seedContactPage } from '../../src/database/seeds/seed-contact-page';
import { ContactOrganization, ContactPageSettings } from '../../src/cms/contact/contact.model';

const ADMIN_URL = `${API}/cms/contact`;
const PUBLIC_URL = `${API}/public/contact`;

let app: Express;
let admin: TestActor;

type Pair = { mr: string; en: string };

/* The request body as the admin screen sends it. Written out so tests can vary one field at a time. */
interface OrgPayload {
  orgType: string;
  name: Pair;
  role?: Pair;
  address?: Pair;
  email?: string;
  phone?: string;
  websiteUrl?: string;
  helpdeskHours?: Pair;
  displayOrder?: number;
  isActive?: boolean;
}

interface PagePayload {
  pageTitle: Pair;
  pageSubtitle: Pair;
  isPublished?: boolean;
  organizations: OrgPayload[];
}

/* The shape the admin screen submits: the banner plus both cards. */
const validPayload = (): PagePayload => ({
  pageTitle: { mr: 'संपर्क', en: 'Contact' },
  pageSubtitle: { mr: 'संपर्क माहिती', en: 'Contact Information' },
  isPublished: true,
  organizations: [
    {
      orgType: 'AMRUT',
      name: { mr: 'AMRUT', en: 'AMRUT' },
      address: { mr: 'पुणे पत्ता', en: 'Pune address' },
      email: 'info@mahaamrut.org.in',
      phone: '+91 97301 51450',
      websiteUrl: 'https://mahaamrut.org.in/',
      displayOrder: 0,
    },
    {
      orgType: 'IMPLEMENTATION_PARTNER',
      name: { mr: 'SUMAGO INFOTECH PVT LTD', en: 'SUMAGO INFOTECH PVT LTD' },
      role: { mr: 'भागीदार', en: 'Implementation & technology partner' },
      email: 'programme@sumago.demo',
      helpdeskHours: { mr: 'सोम–शनि', en: 'Mon–Sat, 10:00 – 18:00' },
      displayOrder: 1,
    },
  ],
});

/* resetData() truncates the contact tables, so each file re-seeds the singleton it edits. */
beforeAll(async () => {
  app = await setupTestApp();
  await seedContactPage(AppDataSource);
  admin = await superAdmin();
});
afterAll(teardownTestApp);

describe('Contact page seed', () => {
  it('seeds the page and both cards with the values the site used to hardcode', async () => {
    const res = await request(app).get(ADMIN_URL).set(auth(admin.token));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      pageTitle: { mr: 'संपर्क', en: 'Contact' },
      pageSubtitle: { mr: 'संपर्क माहिती', en: 'Contact Information' },
      isPublished: true,
    });

    const types = res.body.data.organizations.map((o: { orgType: string }) => o.orgType);
    expect(types).toEqual(['AMRUT', 'IMPLEMENTATION_PARTNER']);

    const amrut = res.body.data.organizations[0];
    expect(amrut).toMatchObject({
      email: 'info@mahaamrut.org.in',
      phone: '+91 97301 51450',
      websiteUrl: 'https://mahaamrut.org.in/',
    });
    expect(amrut.address.en).toMatch(/AMRUT Building/);
    expect(amrut.address.mr).toMatch(/अमृत/);

    const partner = res.body.data.organizations[1];
    expect(partner.role.en).toBe('Implementation & technology partner');
    expect(partner.helpdeskHours.en).toMatch(/Mon–Sat/);
  });

  it('never overwrites administrator edits on a later run', async () => {
    await request(app)
      .put(ADMIN_URL)
      .set(auth(admin.token))
      .send({ ...validPayload(), pageTitle: { mr: 'नवीन शीर्षक', en: 'Edited title' } })
      .expect(200);

    const summary = await seedContactPage(AppDataSource);
    expect(summary).toEqual({ created: false, organizationsCreated: 0 });

    const after = await request(app).get(ADMIN_URL).set(auth(admin.token));
    expect(after.body.data.pageTitle.en).toBe('Edited title');
  });

  it('refuses a second settings row at the database level', async () => {
    const repo = AppDataSource.getRepository(ContactPageSettings);
    await expect(
      repo.insert({
        pageTitleMr: 'दुसरे', pageTitleEn: 'Second',
        pageSubtitleMr: 'उप', pageSubtitleEn: 'Sub',
        isPublished: true,
      }),
    ).rejects.toThrow();
  });
});

describe('Contact page update', () => {
  it('saves the banner and both cards, in both languages', async () => {
    const payload = validPayload();
    payload.pageTitle = { mr: 'संपर्क करा', en: 'Contact us' };
    payload.organizations[0].phone = '+91 20 1234 5678';

    const res = await request(app).put(ADMIN_URL).set(auth(admin.token)).send(payload);
    expect(res.status).toBe(200);
    expect(res.body.data.pageTitle).toEqual({ mr: 'संपर्क करा', en: 'Contact us' });
    expect(res.body.data.organizations[0].phone).toBe('+91 20 1234 5678');

    /* Round-trips through the database, not just echoed back. */
    const reread = await request(app).get(ADMIN_URL).set(auth(admin.token));
    expect(reread.body.data.pageTitle.mr).toBe('संपर्क करा');
  });

  it('lower-cases the email and keeps Marathi text intact', async () => {
    const payload = validPayload();
    payload.organizations[0].email = 'INFO@MahaAmrut.ORG.in';
    const res = await request(app).put(ADMIN_URL).set(auth(admin.token)).send(payload);
    expect(res.status).toBe(200);
    expect(res.body.data.organizations[0].email).toBe('info@mahaamrut.org.in');
    expect(res.body.data.organizations[0].address.mr).toBe('पुणे पत्ता');
  });

  it('rejects a half-translated field (422)', async () => {
    const payload = validPayload() as unknown as { pageTitle: { mr: string; en?: string } };
    delete payload.pageTitle.en;
    const res = await request(app).put(ADMIN_URL).set(auth(admin.token)).send(payload);
    expect(res.status).toBe(422);
  });

  it('enforces the fields each card type requires (422)', async () => {
    const noAddress = validPayload();
    delete (noAddress.organizations[0] as { address?: unknown }).address;
    const a = await request(app).put(ADMIN_URL).set(auth(admin.token)).send(noAddress);
    expect(a.status).toBe(422);
    expect(JSON.stringify(a.body)).toMatch(/Address is required for the AMRUT card/);

    const noHours = validPayload();
    delete (noHours.organizations[1] as { helpdeskHours?: unknown }).helpdeskHours;
    const b = await request(app).put(ADMIN_URL).set(auth(admin.token)).send(noHours);
    expect(b.status).toBe(422);
    expect(JSON.stringify(b.body)).toMatch(/Helpdesk hours are required/);
  });

  it('rejects a malformed email, phone and website URL (422)', async () => {
    const cases: [string, unknown][] = [
      ['email', 'not-an-email'],
      ['phone', 'call me maybe'],
      ['phone', '12345'],
      ['websiteUrl', 'javascript:alert(1)'],
      ['websiteUrl', 'mahaamrut.org.in'],
    ];
    for (const [field, value] of cases) {
      const payload = validPayload();
      (payload.organizations[0] as unknown as Record<string, unknown>)[field] = value;
      const res = await request(app).put(ADMIN_URL).set(auth(admin.token)).send(payload);
      expect([422, 400]).toContain(res.status);
    }
  });

  it('rejects unknown fields and a duplicate card type', async () => {
    const extra = { ...validPayload(), somethingElse: 1 };
    expect((await request(app).put(ADMIN_URL).set(auth(admin.token)).send(extra)).status).toBe(422);

    const dup = validPayload();
    dup.organizations.push({ ...dup.organizations[0] });
    const res = await request(app).put(ADMIN_URL).set(auth(admin.token)).send(dup);
    expect([400, 422]).toContain(res.status);
  });

  it('is transactional: a rejected payload changes nothing', async () => {
    const before = await request(app).get(ADMIN_URL).set(auth(admin.token));

    const broken = validPayload();
    broken.pageTitle = { mr: 'अर्धवट', en: 'Half saved' };
    broken.organizations[0].email = 'not-an-email';
    await request(app).put(ADMIN_URL).set(auth(admin.token)).send(broken);

    const after = await request(app).get(ADMIN_URL).set(auth(admin.token));
    expect(after.body.data.pageTitle).toEqual(before.body.data.pageTitle);
  });

  it('writes an audit entry for the change', async () => {
    await request(app).put(ADMIN_URL).set(auth(admin.token)).send(validPayload()).expect(200);
    const logs = await request(app).get(`${API}/audit-logs`).query({ limit: 20 }).set(auth(admin.token));
    const actions = logs.body.data.map((l: { action: string }) => l.action);
    expect(actions).toContain('cms.contact-page.update');
  });
});

describe('Contact page publication', () => {
  afterEach(async () => {
    await request(app).patch(`${ADMIN_URL}/status`).set(auth(admin.token)).send({ isPublished: true });
  });

  it('publishes and unpublishes', async () => {
    const off = await request(app).patch(`${ADMIN_URL}/status`).set(auth(admin.token)).send({ isPublished: false });
    expect(off.status).toBe(200);
    expect(off.body.data.isPublished).toBe(false);
  });

  it('hides the content from the public endpoint while unpublished', async () => {
    await request(app).patch(`${ADMIN_URL}/status`).set(auth(admin.token)).send({ isPublished: false }).expect(200);

    const hidden = await request(app).get(PUBLIC_URL);
    expect(hidden.status).toBe(200);
    expect(hidden.body.data).toBeNull();

    await request(app).patch(`${ADMIN_URL}/status`).set(auth(admin.token)).send({ isPublished: true }).expect(200);
    const shown = await request(app).get(PUBLIC_URL);
    expect(shown.body.data).not.toBeNull();
  });

  it('rejects a non-boolean status (422)', async () => {
    expect((await request(app).patch(`${ADMIN_URL}/status`).set(auth(admin.token)).send({ isPublished: 'yes' })).status).toBe(422);
  });
});

describe('public Contact endpoint', () => {
  it('serves the page without a session, in both languages', async () => {
    const res = await request(app).get(PUBLIC_URL);
    expect(res.status).toBe(200);
    expect(res.body.data.pageTitle).toHaveProperty('mr');
    expect(res.body.data.pageTitle).toHaveProperty('en');
    expect(res.body.data.organizations.length).toBe(2);
  });

  it('exposes only the words on the page — no ids, timestamps or flags', async () => {
    const res = await request(app).get(PUBLIC_URL);
    const serialised = JSON.stringify(res.body.data);
    for (const leaked of ['"id"', 'isActive', 'isDelete', 'isPublished', 'createdAt', 'updatedAt', 'displayOrder', 'settingsId']) {
      expect(serialised).not.toContain(leaked);
    }
  });

  it('omits inactive cards', async () => {
    const payload = validPayload();
    payload.organizations[1].isActive = false;
    await request(app).put(ADMIN_URL).set(auth(admin.token)).send(payload).expect(200);

    const res = await request(app).get(PUBLIC_URL);
    expect(res.body.data.organizations.map((o: { orgType: string }) => o.orgType)).toEqual(['AMRUT']);

    /* The admin still sees it — only the public view filters. */
    const adminView = await request(app).get(ADMIN_URL).set(auth(admin.token));
    expect(adminView.body.data.organizations.length).toBe(2);

    await request(app).put(ADMIN_URL).set(auth(admin.token)).send(validPayload()).expect(200);
  });

  it('offers no write path', async () => {
    for (const method of ['post', 'put', 'patch', 'delete'] as const) {
      const res = await request(app)[method](PUBLIC_URL).send(validPayload());
      expect(res.status).toBe(404);
    }
  });
});

describe('Contact page authorisation', () => {
  it('needs a session', async () => {
    expect((await request(app).get(ADMIN_URL)).status).toBe(401);
    expect((await request(app).put(ADMIN_URL).send(validPayload())).status).toBe(401);
    expect((await request(app).patch(`${ADMIN_URL}/status`).send({ isPublished: false })).status).toBe(401);
  });

  it('a view-only actor can read but not write (403)', async () => {
    const viewer = await actorWith(['cms-contact.view']);
    expect((await request(app).get(ADMIN_URL).set(auth(viewer.token))).status).toBe(200);
    expect((await request(app).put(ADMIN_URL).set(auth(viewer.token)).send(validPayload())).status).toBe(403);
    expect((await request(app).patch(`${ADMIN_URL}/status`).set(auth(viewer.token)).send({ isPublished: false })).status).toBe(403);
  });

  it('an actor without the CMS codes cannot even read (403)', async () => {
    const outsider = await actorWith(['users.view']);
    expect((await request(app).get(ADMIN_URL).set(auth(outsider.token))).status).toBe(403);
  });

  it('keeps a card for every type after the round trip', async () => {
    const rows = await AppDataSource.getRepository(ContactOrganization).find({ where: { isDelete: false } });
    expect(rows.map((r) => r.orgType).sort()).toEqual(['AMRUT', 'IMPLEMENTATION_PARTNER']);
  });
});
