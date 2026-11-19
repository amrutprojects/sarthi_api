import type { Express } from 'express';
import { AppDataSource, API, actorWith, auth, request, setupTestApp, superAdmin, teardownTestApp, type TestActor } from '../../helpers/test-app';
import { MISSING_ID, makeDistrict, makeState } from '../../cms/helpers';
import { seedContactPage } from '../../../src/database/seeds/seed-contact-page';
import { seedContactDirectory } from '../../../src/database/seeds/seed-contact-directory';
import { seedContactTrainingCentres } from '../../../src/database/seeds/seed-contact-training-centres';
import { ContactTrainingCentres1798300000000 } from '../../../src/database/migrations/1798300000000-ContactTrainingCentres';

/*
 * Contact Page Management → Approved training centres: the card on every District Office page,
 * any number of centres per district, each with its own status, and a "Show on website" switch.
 */
const ADMIN_URL = `${API}/cms/contact`;
const CENTRES_URL = `${ADMIN_URL}/training-centres`;
const SECTION_URL = `${ADMIN_URL}/training-centres-section`;
const PUBLIC_URL = `${API}/public/contact`;

let app: Express;
let admin: TestActor;
let pune: string;
let nashik: string;

type Pair = { mr: string; en: string };
interface Centre {
  id: string;
  district: { id: string; code: string; name: string };
  name: Pair;
  address: Pair | null;
  managerName: Pair | null;
  phone: string | null;
  email: string | null;
  displayOrder: number;
  isActive: boolean;
}

const pair = (mr: string, en: string): Pair => ({ mr, en });
const create = (body: object, token = admin.token) => request(app).post(CENTRES_URL).set(auth(token)).send(body);
const list = async (query = ''): Promise<Centre[]> =>
  (await request(app).get(`${CENTRES_URL}${query}`).set(auth(admin.token)).expect(200)).body.data;
const publicView = async () => (await request(app).get(PUBLIC_URL).expect(200)).body.data;
const clear = () => AppDataSource.query(`DELETE FROM "contact_training_centres"`);

beforeAll(async () => {
  app = await setupTestApp();
  await seedContactPage(AppDataSource);
  admin = await superAdmin();
  const state = await makeState(app, admin.token, 'Centre State', 'CS');
  pune = (await makeDistrict(app, admin.token, state.id, 'Pune', 'PUN')).id;
  nashik = (await makeDistrict(app, admin.token, state.id, 'Nashik', 'NAS')).id;
});
afterAll(teardownTestApp);
afterEach(async () => {
  await request(app).patch(SECTION_URL).set(auth(admin.token)).send({ show: true });
});

describe('Training centres — adding and editing', () => {
  beforeEach(clear);

  it('creates a centre with every field, trimmed, and lists it for the admin', async () => {
    const res = await create({
      districtId: pune,
      name: pair('  हवेली केंद्र ', ' Haveli Centre '),
      address: pair('हवेली, पुणे', 'Haveli, Pune'),
      managerName: pair('सुनील पवार', 'Sunil Pawar'),
      phone: '+91 98XXX 51200',
      email: 'Haveli@Example.org',
    });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      district: { id: pune, code: 'PUN', name: 'Pune' },
      name: pair('हवेली केंद्र', 'Haveli Centre'),
      address: pair('हवेली, पुणे', 'Haveli, Pune'),
      managerName: pair('सुनील पवार', 'Sunil Pawar'),
      phone: '+91 98XXX 51200',
      email: 'haveli@example.org',
      displayOrder: 0,
      isActive: true,
    });
    expect((await list()).map((c) => c.id)).toEqual([res.body.data.id]);
  });

  it('needs only a district and a name in both languages; the rest is optional', async () => {
    const res = await create({ districtId: pune, name: pair('केंद्र', 'Centre') });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ address: null, managerName: null, phone: null, email: null });

    const bad = await create({ districtId: pune, name: pair('', 'Centre'), address: { mr: 'पत्ता' }, email: 'nope' });
    expect(bad.status).toBe(422);
    const fields = bad.body.error.details.map((d: { field: string }) => d.field).sort();
    expect(fields).toEqual(['body.address.en', 'body.email', 'body.name.mr']);

    expect((await create({ districtId: MISSING_ID, name: pair('केंद्र', 'Centre') })).status).toBe(400);
  });

  it('adds any number of centres to a district, each at the end unless an order is given', async () => {
    const a = (await create({ districtId: pune, name: pair('अ', 'A') }).expect(201)).body.data;
    const b = (await create({ districtId: pune, name: pair('ब', 'B') }).expect(201)).body.data;
    const c = (await create({ districtId: pune, name: pair('क', 'C'), displayOrder: 0 }).expect(201)).body.data;
    expect([a.displayOrder, b.displayOrder, c.displayOrder]).toEqual([0, 1, 0]);
    /* Its own district's order: Nashik starts again at 0. */
    expect((await create({ districtId: nashik, name: pair('न', 'N') }).expect(201)).body.data.displayOrder).toBe(0);

    expect((await list(`?districtId=${pune}`)).map((x) => x.name.en)).toEqual(['A', 'C', 'B']);
    expect((await list()).map((x) => x.name.en)).toEqual(['N', 'A', 'C', 'B']);
  });

  it('edits any subset of fields, clears an optional one with null, and moves a centre to another district', async () => {
    const { id } = (await create({ districtId: pune, name: pair('अ', 'A'), phone: '020 1234 5678' }).expect(201)).body.data;
    const res = await request(app)
      .patch(`${CENTRES_URL}/${id}`)
      .set(auth(admin.token))
      .send({ districtId: nashik, managerName: pair('मनीषा', 'Manisha'), phone: null });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ district: { code: 'NAS' }, name: pair('अ', 'A'), managerName: pair('मनीषा', 'Manisha'), phone: null });

    expect((await request(app).patch(`${CENTRES_URL}/${id}`).set(auth(admin.token)).send({})).status).toBe(422);
    expect((await request(app).patch(`${CENTRES_URL}/${MISSING_ID}`).set(auth(admin.token)).send({ phone: null })).status).toBe(404);
  });

  it('deactivates, reactivates and deletes a centre', async () => {
    const { id } = (await create({ districtId: pune, name: pair('अ', 'A') }).expect(201)).body.data;
    expect((await request(app).patch(`${CENTRES_URL}/${id}/status`).set(auth(admin.token)).send({ isActive: false }).expect(200)).body.data.isActive).toBe(false);
    expect((await list('?isActive=false')).map((c) => c.id)).toEqual([id]);
    await request(app).patch(`${CENTRES_URL}/${id}/status`).set(auth(admin.token)).send({ isActive: true }).expect(200);

    await request(app).delete(`${CENTRES_URL}/${id}`).set(auth(admin.token)).expect(200);
    expect(await list()).toEqual([]);
    expect((await request(app).get(`${CENTRES_URL}/${id}`).set(auth(admin.token))).status).toBe(404);
  });
});

describe('Training centres — on the website', () => {
  beforeEach(clear);

  it('sends every active centre in district order, leaving out what is blank and what is inactive', async () => {
    await create({ districtId: pune, name: pair('अ', 'A'), phone: '+91 98XXX 51200' }).expect(201);
    await create({ districtId: pune, name: pair('ब', 'B'), isActive: false }).expect(201);
    await create({ districtId: nashik, name: pair('न', 'N'), email: 'n@example.org' }).expect(201);

    const pub = await publicView();
    expect(pub.showTrainingCentres).toBe(true);
    expect(pub.trainingCentres).toEqual([
      { district: { code: 'NAS', name: 'Nashik' }, name: pair('न', 'N'), email: 'n@example.org' },
      { district: { code: 'PUN', name: 'Pune' }, name: pair('अ', 'A'), phone: '+91 98XXX 51200' },
    ]);
  });

  it('hides the whole card with its switch, keeping the centres for when it is shown again', async () => {
    await create({ districtId: pune, name: pair('अ', 'A') }).expect(201);

    const off = await request(app).patch(SECTION_URL).set(auth(admin.token)).send({ show: false });
    expect(off.status).toBe(200);
    expect(off.body.message).toBe('Training centres hidden from the website');
    expect(off.body.data.showTrainingCentres).toBe(false);
    expect(await publicView()).toMatchObject({ showTrainingCentres: false, trainingCentres: [] });
    /* The admin still sees and edits them. */
    expect(await list()).toHaveLength(1);
    /* The other sections are untouched. */
    expect(off.body.data.showDistrictOffices).toBe(true);

    await request(app).patch(SECTION_URL).set(auth(admin.token)).send({ show: true }).expect(200);
    expect((await publicView()).trainingCentres).toHaveLength(1);
  });

  it('is not changed by saving the page form', async () => {
    await request(app).patch(SECTION_URL).set(auth(admin.token)).send({ show: false }).expect(200);
    const page = (await request(app).get(ADMIN_URL).set(auth(admin.token)).expect(200)).body.data;
    const organizations = page.organizations.map(({ id: _id, createdAt: _c, updatedAt: _u, ...o }: Record<string, unknown>) => o);
    await request(app)
      .put(ADMIN_URL)
      .set(auth(admin.token))
      .send({ pageTitle: page.pageTitle, pageSubtitle: page.pageSubtitle, organizations })
      .expect(200);
    expect((await request(app).get(ADMIN_URL).set(auth(admin.token))).body.data.showTrainingCentres).toBe(false);
  });
});

describe('Training centres — seed and permissions', () => {
  it('seeds the ten centres the website showed, without e-mail, once', async () => {
    await clear();
    await seedContactDirectory(AppDataSource);
    const summary = await seedContactTrainingCentres(AppDataSource);
    expect(summary.centresCreated).toBe(10);
    const centres = await list('?limit=50');
    expect(centres).toHaveLength(10);
    expect(centres.every((c) => c.email === null)).toBe(true);
    expect(centres.find((c) => c.name.en === 'Sangamner Rural Skill Centre')).toMatchObject({
      name: pair('संगमनेर ग्रामीण कौशल्य केंद्र', 'Sangamner Rural Skill Centre'),
      managerName: pair('कविता चव्हाण', 'Kavita Chavan'),
      phone: '+91 98XXX 51203',
    });

    /* A list an administrator emptied stays empty. */
    await AppDataSource.query(`UPDATE "contact_training_centres" SET "isDelete" = true`);
    expect((await seedContactTrainingCentres(AppDataSource)).centresCreated).toBe(0);
  });

  it('the migration gives an existing database the same ten centres, matched to its districts', async () => {
    await seedContactDirectory(AppDataSource);
    const migration = new ContactTrainingCentres1798300000000();
    const qr = AppDataSource.createQueryRunner();
    try {
      await migration.down(qr);
      await migration.up(qr);
    } finally {
      await qr.release();
    }
    const centres = await list('?limit=50');
    expect(centres).toHaveLength(10);
    expect(centres.every((c) => c.email === null && c.isActive)).toBe(true);
    /* Pune was created by this file with the site's code; the migration found it by name. */
    expect(centres.find((c) => c.name.en === 'Haveli Skill Development Centre')?.district.id).toBe(pune);
    expect((await request(app).get(ADMIN_URL).set(auth(admin.token))).body.data.showTrainingCentres).toBe(true);
  });

  it('lets a viewer read but not change, and keeps outsiders out', async () => {
    const viewer = await actorWith(['cms-contact.view']);
    expect((await request(app).get(CENTRES_URL).set(auth(viewer.token))).status).toBe(200);
    expect((await create({ districtId: pune, name: pair('अ', 'A') }, viewer.token)).status).toBe(403);
    expect((await request(app).patch(SECTION_URL).set(auth(viewer.token)).send({ show: false })).status).toBe(403);

    const outsider = await actorWith(['users.view']);
    expect((await request(app).get(CENTRES_URL).set(auth(outsider.token))).status).toBe(403);
  });
});
