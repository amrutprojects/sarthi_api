import type { Express } from 'express';
import {
  AppDataSource,
  API,
  actorWith,
  auth,
  request,
  setupTestApp,
  superAdmin,
  teardownTestApp,
  type TestActor,
} from '../../helpers/test-app';
import { seedAboutAmrut } from '../../../src/database/seeds/seed-about-amrut';
import { auditService } from '../../../src/modules/audit/audit.service';
import { AboutImplementationPartner1794600000000 } from '../../../src/database/migrations/1794600000000-AboutImplementationPartner';

const ADMIN_URL = `${API}/cms/about`;
const PUBLIC_URL = `${API}/public/about`;

let app: Express;
let admin: TestActor;

interface Pair {
  mr: string;
  en: string;
}
interface Detail {
  field: string;
  message: string;
}
interface Fact {
  id: string;
  label: Pair;
  value: Pair;
  displayOrder: number;
  isActive: boolean;
  updatedAt: string;
}
interface Card {
  id: string;
  heading: Pair;
  description: Pair;
  displayOrder: number;
  isActive: boolean;
  isRequired: boolean;
  updatedAt: string;
}

const pair = (mr: string, en: string): Pair => ({ mr, en });
const BLANK = pair('', '');

/* What the website showed before the section was managed (content/org.ts and the home section's labels). */
const DESCRIPTION_EN =
  "AMRUT - the Academy of Maharashtra Research, Upliftment and Training - is an autonomous body established by the Government of Maharashtra to develop students, youth and other candidates from economically weaker sections of the open category. Its Governing Board is chaired by the Hon. Principal Secretary, Other Backward Bahujan Welfare Department, and schemes are implemented with the Board's approval.";
const SEEDED_FACTS = [
  { label: pair('स्थापना', 'Established'), value: pair('२२ ऑगस्ट २०१९ च्या शासन निर्णयाद्वारे', 'By Government Resolution dated 22 August 2019') },
  {
    label: pair('नोंदणी', 'Registration'),
    value: pair(
      'सोसायटी रजिस्ट्रेशन अ‍ॅक्ट १८६० व सार्वजनिक विश्वस्त व्यवस्था अधिनियम १९५० अंतर्गत नोंदणीकृत',
      'Registered under the Society Registration Act 1860 and the Public Trusts Act 1950',
    ),
  },
  { label: pair('मुख्यालय', 'Headquarters'), value: pair('मुख्यालय: पुणे', 'Headquarters: Pune') },
  /* Printed by the About page from its bundled strings until it became a CMS row. */
  {
    label: pair('अंमलबजावणी भागीदार', 'Implementation partner'),
    value: pair('SUMAGO INFOTECH PVT LTD — अंमलबजावणी व तंत्रज्ञान भागीदार', 'SUMAGO INFOTECH PVT LTD — Implementation & technology partner'),
  },
];
const SEEDED_CARD_HEADINGS = [pair('आमचे ध्येय', 'Our Mission'), pair('आमचा दृष्टिकोन', 'Our Vision'), pair('आमची मूल्ये', 'Our Values')];

const details = (res: { body: { error: { details: Detail[] } } }) => res.body.error.details;
const dashboard = async () => (await request(app).get(ADMIN_URL).set(auth(admin.token)).expect(200)).body.data;
const pub = async () => (await request(app).get(PUBLIC_URL).expect(200)).body.data;
const patchSection = (b: unknown) => request(app).patch(`${ADMIN_URL}/settings`).set(auth(admin.token)).send(b as object);
const post = (kind: 'facts' | 'cards', b: unknown, token = admin.token) => request(app).post(`${ADMIN_URL}/${kind}`).set(auth(token)).send(b as object);
const patch = (kind: 'facts' | 'cards', id: string, b: unknown) => request(app).patch(`${ADMIN_URL}/${kind}/${id}`).set(auth(admin.token)).send(b as object);
const del = (kind: 'facts' | 'cards', id: string) => request(app).delete(`${ADMIN_URL}/${kind}/${id}`).set(auth(admin.token));

beforeAll(async () => {
  app = await setupTestApp();
  admin = await superAdmin();
});
afterAll(teardownTestApp);
afterEach(() => jest.restoreAllMocks());

describe('About AMRUT — before the seed', () => {
  it('the public feed is null and the dashboard reports it is not configured', async () => {
    expect(await pub()).toBeNull();
    expect((await request(app).get(ADMIN_URL).set(auth(admin.token))).status).toBe(404);
  });
});

describe('About AMRUT seed', () => {
  it('seeds exactly the heading, description, rows and cards the website showed', async () => {
    expect(await seedAboutAmrut(AppDataSource)).toEqual({ created: true, factsCreated: 4, cardsCreated: 3 });
    const d = await dashboard();
    expect(d.section).toMatchObject({ heading: pair('अमृत विषयी माहिती', 'About AMRUT'), subtitle: BLANK, showSection: true });
    expect(d.section.description.en).toBe(DESCRIPTION_EN);
    expect((d.facts as Fact[]).map(({ label, value }) => ({ label, value }))).toEqual(SEEDED_FACTS);
    expect((d.cards as Card[]).map((c) => [c.heading, c.displayOrder, c.isActive, c.isRequired])).toEqual(
      SEEDED_CARD_HEADINGS.map((h, i) => [h, i + 1, true, true]),
    );
    expect(d.cards[0].description.en).toBe(
      'To make research, training and development opportunities available to every citizen of the state, and to empower youth through skill development.',
    );

    const p = await pub();
    expect(p).toMatchObject({ heading: pair('अमृत विषयी माहिती', 'About AMRUT'), subtitle: null, showSection: true });
    expect(p.facts.map(({ id: _i, ...f }: Record<string, unknown>) => f)).toEqual(SEEDED_FACTS);
    expect(p.cards.map((c: { heading: Pair }) => c.heading)).toEqual(SEEDED_CARD_HEADINGS);
  });

  it('is idempotent and never overwrites administrator edits', async () => {
    expect(await seedAboutAmrut(AppDataSource)).toEqual({ created: false, factsCreated: 0, cardsCreated: 0 });
    const [{ n }] = await AppDataSource.query(`SELECT count(*)::int AS n FROM "about_facts"`);
    expect(n).toBe(4);
  });
});

describe('Section settings and description', () => {
  it('changes only the fields sent, keeps line breaks and Unicode, and the website follows', async () => {
    const before = (await dashboard()).section;
    const res = await patchSection({ description: pair('पहिला परिच्छेद.\n\nदुसरा परिच्छेद — ज्ञ, क्ष.', 'First paragraph.\n\nSecond paragraph.'), expectedUpdatedAt: before.updatedAt });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ heading: before.heading, description: pair('पहिला परिच्छेद.\n\nदुसरा परिच्छेद — ज्ञ, क्ष.', 'First paragraph.\n\nSecond paragraph.') });

    await patchSection({ heading: pair('चाचणी शीर्षक', 'Test heading'), subtitle: pair('उपशीर्षक', 'Subtitle') }).expect(200);
    expect(await pub()).toMatchObject({ heading: pair('चाचणी शीर्षक', 'Test heading'), subtitle: pair('उपशीर्षक', 'Subtitle') });
    await patchSection({ heading: before.heading, subtitle: BLANK, description: before.description }).expect(200);
    expect((await pub()).subtitle).toBeNull();
  });

  it('requires both halves of the heading and description, limits the length and refuses an empty update', async () => {
    const res = await patchSection({ heading: pair('', 'x'), description: pair('क', 'x'.repeat(4001)) });
    expect(res.status).toBe(422);
    expect(details(res)).toEqual(
      expect.arrayContaining([
        { field: 'body.heading.mr', message: 'Heading (Marathi) is required' },
        { field: 'body.description.en', message: 'Description (English) must be at most 4000 characters' },
      ]),
    );
    expect((await patchSection({ description: pair('क', 'x'.repeat(4000)) })).status).toBe(200);
    expect((await patchSection({})).status).toBe(422);
    expect((await patchSection({ subtitle: pair('फक्त', '') })).status).toBe(422);
    expect((await patchSection({ description: pair('क', 'x'), expectedUpdatedAt: '2020-01-01T00:00:00.000Z' })).status).toBe(409);
  });

  it('can hide the whole section', async () => {
    await patchSection({ showSection: false }).expect(200);
    expect(await pub()).toMatchObject({ showSection: false, facts: [], cards: [] });
    await patchSection({ showSection: true }).expect(200);
  });
});

describe('Information rows', () => {
  it('adds a row at the end, shows it publicly, and refuses a duplicate label', async () => {
    const res = await post('facts', { label: pair('सीएमएस चाचणी क्षेत्र', 'CMS Test Field'), value: pair('चाचणी मूल्य', 'Test value') });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ displayOrder: 5, isActive: true });
    expect((await pub()).facts.map((f: { label: Pair }) => f.label.en)).toEqual(['Established', 'Registration', 'Headquarters', 'Implementation partner', 'CMS Test Field']);
    const dup = await post('facts', { label: pair('नवीन', 'established'), value: pair('x', 'x') });
    expect(dup.status).toBe(409);
    expect(dup.body.message).toBe('Information row "स्थापना" / "Established" already exists.');
  });

  it('replays a double-submitted form instead of adding the row twice', async () => {
    const send = () => post('facts', { label: pair('पत्ता', 'Office Address'), value: pair('पुणे', 'Pune') }).set('Idempotency-Key', 'about-fact-key-0001');
    const [a, b] = [await send(), await send()];
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(b.headers['idempotent-replayed']).toBe('true');
    expect(b.body.data.id).toBe(a.body.data.id);
    expect((await dashboard()).facts.filter((f: Fact) => f.label.en === 'Office Address')).toHaveLength(1);
  });

  it('edits one field only, hides and shows, deletes, and reorders by id', async () => {
    const hq = ((await dashboard()).facts as Fact[]).find((f) => f.label.en === 'Headquarters')!;
    const res = await patch('facts', hq.id, { value: pair('मुख्यालय: चाचणी', 'Headquarters: Test'), expectedUpdatedAt: hq.updatedAt });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ label: hq.label, value: pair('मुख्यालय: चाचणी', 'Headquarters: Test') });
    await patch('facts', hq.id, { value: hq.value }).expect(200);

    const test = ((await dashboard()).facts as Fact[]).find((f) => f.label.en === 'CMS Test Field')!;
    await request(app).patch(`${ADMIN_URL}/facts/${test.id}/status`).set(auth(admin.token)).send({ isActive: false }).expect(200);
    expect((await pub()).facts.map((f: { id: string }) => f.id)).not.toContain(test.id);

    const others = ((await dashboard()).facts as Fact[]).filter((f) => f.id !== test.id);
    expect((await del('facts', test.id)).status).toBe(200);
    expect((await dashboard()).facts).toEqual(others);
    expect((await del('facts', test.id)).status).toBe(404);

    const ids = others.map((f) => f.id).reverse();
    const ordered = await request(app).put(`${ADMIN_URL}/facts/order`).set(auth(admin.token)).send({ ids });
    expect(ordered.status).toBe(200);
    expect((await pub()).facts.map((f: { id: string }) => f.id)).toEqual(ids);
    expect((await request(app).put(`${ADMIN_URL}/facts/order`).set(auth(admin.token)).send({ ids: ids.slice(1) })).status).toBe(409);
    await request(app).put(`${ADMIN_URL}/facts/order`).set(auth(admin.token)).send({ ids: [...ids].reverse() }).expect(200);
  });

  it('names missing fields and answers 422 / 404 for malformed and unknown ids', async () => {
    const res = await post('facts', { label: pair('', '') });
    expect(res.status).toBe(422);
    expect(details(res).map((d) => d.field).sort()).toEqual(['body.label.en', 'body.label.mr', 'body.value']);
    expect((await request(app).get(`${ADMIN_URL}/facts/nope`).set(auth(admin.token))).status).toBe(422);
    const unknown = '00000000-0000-4000-8000-000000000000';
    expect((await request(app).get(`${ADMIN_URL}/facts/${unknown}`).set(auth(admin.token))).status).toBe(404);
    expect((await patch('facts', unknown, { value: pair('x', 'x') })).status).toBe(404);
  });
});

describe('About cards', () => {
  it('edits a required card but never deletes or hides it', async () => {
    const mission = ((await dashboard()).cards as Card[])[0]!;
    const res = await patch('cards', mission.id, { description: pair('तात्पुरते ध्येय', 'Temporary mission') });
    expect(res.status).toBe(200);
    expect((await pub()).cards[0].description).toEqual(pair('तात्पुरते ध्येय', 'Temporary mission'));
    await patch('cards', mission.id, { description: mission.description }).expect(200);

    const blocked = await del('cards', mission.id);
    expect(blocked.status).toBe(409);
    expect(blocked.body.message).toBe('"Our Mission" is one of the required Mission, Vision and Values cards. It can be edited but not deleted.');
    expect((await request(app).patch(`${ADMIN_URL}/cards/${mission.id}/status`).set(auth(admin.token)).send({ isActive: false })).status).toBe(409);
    expect((await patch('cards', mission.id, { isActive: false })).status).toBe(409);
    /* The database holds the rule even for a write that bypasses the API. */
    await expect(AppDataSource.query(`UPDATE "about_cards" SET "isDelete" = true WHERE "id" = $1`, [mission.id])).rejects.toThrow(/CHK_about_cards_required_kept/);
    expect(((await dashboard()).cards as Card[]).map((c) => c.heading.en)).toEqual(['Our Mission', 'Our Vision', 'Our Values']);
  });

  it('adds, reorders and deletes an additional card', async () => {
    const res = await post('cards', { heading: pair('सीएमएस चाचणी कार्ड', 'CMS Test Card'), description: pair('चाचणी\nवर्णन', 'Test\ndescription') });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ displayOrder: 4, isRequired: false, description: pair('चाचणी\nवर्णन', 'Test\ndescription') });
    expect((await pub()).cards.map((c: { heading: Pair }) => c.heading.en)).toEqual(['Our Mission', 'Our Vision', 'Our Values', 'CMS Test Card']);

    const ids = ((await dashboard()).cards as Card[]).map((c) => c.id);
    await request(app).put(`${ADMIN_URL}/cards/order`).set(auth(admin.token)).send({ ids: [ids[3], ids[0], ids[1], ids[2]] }).expect(200);
    expect((await pub()).cards[0].heading.en).toBe('CMS Test Card');

    expect((await del('cards', res.body.data.id)).status).toBe(200);
    expect((await pub()).cards.map((c: { heading: Pair }) => c.heading.en)).toEqual(['Our Mission', 'Our Vision', 'Our Values']);
    expect((await post('cards', { heading: pair('आमचे ध्येय', 'x'), description: pair('x', 'x') })).status).toBe(409);
  });

  it('keeps the saved card when the database save fails', async () => {
    const vision = ((await dashboard()).cards as Card[]).find((c) => c.heading.en === 'Our Vision')!;
    jest.spyOn(auditService, 'recordInTx').mockRejectedValueOnce(new Error('simulated database failure'));
    expect((await patch('cards', vision.id, { description: pair('नको', 'Must not stick') })).status).toBe(500);
    expect(((await dashboard()).cards as Card[]).find((c) => c.id === vision.id)).toEqual(vision);
  });
});

describe('Access control', () => {
  it('refuses every admin route without a session', async () => {
    expect((await request(app).get(ADMIN_URL)).status).toBe(401);
    expect((await request(app).patch(`${ADMIN_URL}/settings`).send({ showSection: false })).status).toBe(401);
    expect((await request(app).post(`${ADMIN_URL}/facts`).send({})).status).toBe(401);
  });

  it('a view-only administrator can read but not change anything', async () => {
    const viewer = await actorWith(['cms-about.view']);
    const V = auth(viewer.token);
    const d = await dashboard();
    expect((await request(app).get(ADMIN_URL).set(V)).status).toBe(200);
    expect((await request(app).patch(`${ADMIN_URL}/settings`).set(V).send({ showSection: false })).status).toBe(403);
    expect((await post('facts', { label: pair('a', 'a'), value: pair('b', 'b') }, viewer.token)).status).toBe(403);
    expect((await request(app).patch(`${ADMIN_URL}/cards/${d.cards[0].id}`).set(V).send({ description: pair('x', 'x') })).status).toBe(403);
    expect((await request(app).delete(`${ADMIN_URL}/facts/${d.facts[0].id}`).set(V)).status).toBe(403);
  });

  it('another CMS permission does not open this section', async () => {
    const other = await actorWith(['cms-board.view', 'cms-board.update']);
    expect((await request(app).get(ADMIN_URL).set(auth(other.token))).status).toBe(403);
  });
});

describe('Implementation partner row (migration 1794600000000)', () => {
  const migration = new AboutImplementationPartner1794600000000();
  const run = async (step: 'up' | 'down') => {
    const qr = AppDataSource.createQueryRunner();
    try {
      await migration[step](qr);
    } finally {
      await qr.release();
    }
  };
  const partnerRows = async () =>
    (await AppDataSource.query(`SELECT "id", "valueEn", "displayOrder" FROM "about_facts" WHERE "labelEn" = 'Implementation partner' AND "isDelete" = false`)) as {
      id: string;
      valueEn: string;
      displayOrder: number;
    }[];

  it('is a manageable row like the others: edit its label and value, hide and show it', async () => {
    const [row] = await partnerRows();
    const res = await patch('facts', row!.id, { value: pair('SUMAGO INFOTECH PVT LTD — संपादित', 'SUMAGO INFOTECH PVT LTD — Edited role') });
    expect(res.status).toBe(200);
    expect((await pub()).facts.find((f: { id: string }) => f.id === row!.id).value.en).toBe('SUMAGO INFOTECH PVT LTD — Edited role');
    await patch('facts', row!.id, { value: SEEDED_FACTS[3]!.value }).expect(200);
    await request(app).patch(`${ADMIN_URL}/facts/${row!.id}/status`).set(auth(admin.token)).send({ isActive: false }).expect(200);
    expect((await pub()).facts.map((f: { id: string }) => f.id)).not.toContain(row!.id);
    await request(app).patch(`${ADMIN_URL}/facts/${row!.id}/status`).set(auth(admin.token)).send({ isActive: true }).expect(200);
  });

  it('adds the row once to a database seeded before it existed, at the end, and never duplicates it', async () => {
    /* A database seeded before this change: the three original rows only. */
    await AppDataSource.query(`DELETE FROM "about_facts" WHERE "labelEn" = 'Implementation partner'`);
    expect(await partnerRows()).toEqual([]);

    await run('up');
    const added = await partnerRows();
    expect(added).toHaveLength(1);
    expect(added[0]!.valueEn).toBe('SUMAGO INFOTECH PVT LTD — Implementation & technology partner');
    const facts = (await pub()).facts.map(({ id: _i, ...f }: Record<string, unknown>) => f);
    expect(facts.slice(0, 3)).toEqual(SEEDED_FACTS.slice(0, 3));
    expect(facts[facts.length - 1]).toEqual(SEEDED_FACTS[3]);

    await run('up');
    expect(await partnerRows()).toHaveLength(1);
  });

  it('does nothing on a database whose About section is not seeded yet (the seed writes the row there)', async () => {
    await AppDataSource.query(`DELETE FROM "about_facts" WHERE "labelEn" = 'Implementation partner'`);
    await AppDataSource.query(`UPDATE "about_section" SET "isDelete" = true`);
    try {
      await run('up');
      expect(await partnerRows()).toEqual([]);
    } finally {
      await AppDataSource.query(`UPDATE "about_section" SET "isDelete" = false`);
    }
    await run('up');
    expect(await partnerRows()).toHaveLength(1);
  });

  it('rolls back only a row it wrote and nobody edited', async () => {
    const [row] = await partnerRows();
    await patch('facts', row!.id, { value: pair('संपादित', 'Edited') }).expect(200);
    await run('down');
    expect(await partnerRows()).toHaveLength(1);
    await patch('facts', row!.id, { value: SEEDED_FACTS[3]!.value }).expect(200);
    await run('down');
    expect(await partnerRows()).toEqual([]);
    await run('up');
    expect(await partnerRows()).toHaveLength(1);
  });
});
