import type { Express } from 'express';
import {
  AppDataSource,
  API,
  actorWith,
  auth,
  createUser,
  login,
  request,
  setupTestApp,
  superAdmin,
  teardownTestApp,
  type TestActor,
} from '../../helpers/test-app';
import { seedBrandBar } from '../../../src/database/seeds/seed-brand-bar';
import { auditService } from '../../../src/modules/audit/audit.service';
import { ROLE_CODES } from '../../../src/modules/roles-permissions';

const ADMIN_URL = `${API}/cms/brand-bar`;
const PUBLIC_URL = `${API}/public/brand-bar`;

let app: Express;
let admin: TestActor;

interface Pair {
  mr: string;
  en: string;
}
interface AdminBrandBar {
  id: string;
  title: string;
  fullName: Pair;
  partnerLabel: Pair;
  partnerName: string;
  showPartner: boolean;
  showSection: boolean;
  updatedAt: string;
}
interface Detail {
  field: string;
  message: string;
}

const pair = (mr: string, en: string): Pair => ({ mr, en });
const BLANK = pair('', '');
/* What the website's brand bar carried before it was managed, word for word. */
const TITLE = 'AMRUT KALASH';
const FULL_NAME = pair('अमृत - महाराष्ट्र संशोधन, उन्नती व प्रशिक्षण प्रबोधिनी', 'Academy of Maharashtra Research, Upliftment and Training');
const PARTNER_LABEL = pair('अंमलबजावणी भागीदार', 'Implementation Partner');
const PARTNER_NAME = 'SUMAGO INFOTECH PVT LTD';
const SEEDED = { title: TITLE, fullName: FULL_NAME, partnerLabel: PARTNER_LABEL, partnerName: PARTNER_NAME };

const details = (res: { body: { error: { details: Detail[] } } }) => res.body.error.details;
const publicFeed = async () => (await request(app).get(PUBLIC_URL).expect(200)).body.data;
const put = (payload: unknown, token = admin.token) =>
  request(app)
    .put(ADMIN_URL)
    .set(auth(token))
    .send(payload as object);
const getBar = async (): Promise<AdminBrandBar> => (await request(app).get(ADMIN_URL).set(auth(admin.token)).expect(200)).body.data;
const lastAuditDetails = async () =>
  (
    await AppDataSource.query(
      `SELECT "details" FROM "audit_logs" WHERE "action" = 'cms.brand-bar.update' ORDER BY "createdAt" DESC LIMIT 1`,
    )
  )[0].details as Record<string, unknown>;

beforeAll(async () => {
  app = await setupTestApp();
  admin = await superAdmin();
});
afterAll(teardownTestApp);
afterEach(() => jest.restoreAllMocks());

describe('Brand Bar — before the seed', () => {
  it('the public feed is null while the Brand Bar is not configured, so the website keeps its bundled bar', async () => {
    expect(await publicFeed()).toBeNull();
    expect((await request(app).get(ADMIN_URL).set(auth(admin.token))).status).toBe(404);
    expect((await put(SEEDED)).status).toBe(404);
  });
});

describe('Brand Bar seed', () => {
  it('seeds exactly what the bar showed', async () => {
    expect(await seedBrandBar(AppDataSource)).toEqual({ created: true });
    expect(await getBar()).toMatchObject({ ...SEEDED, showSection: true, showPartner: true });
    expect(await publicFeed()).toEqual({
      showSection: true,
      title: TITLE,
      fullName: FULL_NAME,
      partner: { label: PARTNER_LABEL, name: PARTNER_NAME },
    });
  });

  it('is idempotent and never undoes an edit', async () => {
    await put({ ...SEEDED, title: 'Edited title' }).expect(200);
    expect(await seedBrandBar(AppDataSource)).toEqual({ created: false });
    expect((await getBar()).title).toBe('Edited title');
    await put(SEEDED).expect(200);
  });
});

describe('Editing the Brand Bar', () => {
  it('saves every field, collapsing stray whitespace, and the website reads it', async () => {
    const current = await getBar();
    const res = await put({
      title: '  AMRUT   KALASH 2.0 ',
      fullName: pair(' नवीन   नाव ', 'New  name'),
      partnerLabel: pair('भागीदार', 'Partner'),
      partnerName: ' Example Partner Ltd ',
      expectedUpdatedAt: current.updatedAt,
    });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      title: 'AMRUT KALASH 2.0',
      fullName: pair('नवीन नाव', 'New name'),
      partnerLabel: pair('भागीदार', 'Partner'),
      partnerName: 'Example Partner Ltd',
    });
    expect(await publicFeed()).toEqual({
      showSection: true,
      title: 'AMRUT KALASH 2.0',
      fullName: pair('नवीन नाव', 'New name'),
      partner: { label: pair('भागीदार', 'Partner'), name: 'Example Partner Ltd' },
    });
    await put(SEEDED).expect(200);
  });

  it('either full-name line may be blank on its own', async () => {
    await put({ ...SEEDED, fullName: pair(FULL_NAME.mr, '') }).expect(200);
    expect((await publicFeed()).fullName).toEqual(pair(FULL_NAME.mr, ''));
    await put({ ...SEEDED, fullName: BLANK }).expect(200);
    expect((await publicFeed()).fullName).toEqual(BLANK);
    await put(SEEDED).expect(200);
  });

  it('a blank partner label leaves the name alone; a blank partner name removes the partner block', async () => {
    await put({ ...SEEDED, partnerLabel: BLANK }).expect(200);
    expect((await publicFeed()).partner).toEqual({ label: null, name: PARTNER_NAME });
    const noPartner = await put({ ...SEEDED, partnerName: '   ' });
    expect(noPartner.status).toBe(200);
    expect(noPartner.body.data.partnerName).toBe('');
    expect((await publicFeed()).partner).toBeNull();
    await put(SEEDED).expect(200);
  });

  it('refuses a blank title, a half-filled partner label, over-long text, missing keys and stale saves', async () => {
    const blankTitle = await put({ ...SEEDED, title: '   ' });
    expect(blankTitle.status).toBe(422);
    expect(details(blankTitle)).toEqual([{ field: 'body.title', message: 'Title is required' }]);

    const half = await put({ ...SEEDED, partnerLabel: pair('फक्त मराठी', '') });
    expect(details(half)).toEqual([
      { field: 'body.partnerLabel.en', message: 'Partner label (English) is required when the Marathi text is filled in' },
    ]);

    const long = await put({
      title: 'T'.repeat(61),
      fullName: pair('म'.repeat(161), 'e'.repeat(161)),
      partnerLabel: pair('म'.repeat(61), 'e'.repeat(61)),
      partnerName: 'P'.repeat(101),
    });
    expect(long.status).toBe(422);
    expect(details(long)).toEqual(
      expect.arrayContaining([
        { field: 'body.title', message: 'Title must be at most 60 characters' },
        { field: 'body.fullName.mr', message: 'Full name (Marathi) must be at most 160 characters' },
        { field: 'body.fullName.en', message: 'Full name (English) must be at most 160 characters' },
        { field: 'body.partnerLabel.mr', message: 'Partner label (Marathi) must be at most 60 characters' },
        { field: 'body.partnerName', message: 'Partner name must be at most 100 characters' },
      ]),
    );

    /* A missing key is refused, never read as "blank": a stale client cannot wipe a line by leaving it out. */
    const missing = await put({});
    expect(missing.status).toBe(422);
    expect(
      details(missing)
        .map((d) => d.field)
        .sort(),
    ).toEqual(['body.fullName', 'body.partnerLabel', 'body.partnerName', 'body.title']);

    expect((await put({ ...SEEDED, extra: 'x' })).status).toBe(422);
    expect((await put({ ...SEEDED, expectedUpdatedAt: '2020-01-01T00:00:00.000Z' })).status).toBe(409);
    expect(await getBar()).toMatchObject(SEEDED);
  });

  it('the database refuses a blank title or a half-filled partner label even past the API', async () => {
    await expect(AppDataSource.query(`UPDATE "brand_bar_settings" SET "title" = '  '`)).rejects.toThrow(/CHK_brand_bar_settings_title/);
    await expect(AppDataSource.query(`UPDATE "brand_bar_settings" SET "partnerLabelMr" = ''`)).rejects.toThrow(
      /CHK_brand_bar_settings_partnerLabel_pair/,
    );
  });

  it('keeps the saved Brand Bar when the database save fails', async () => {
    const before = await getBar();
    jest.spyOn(auditService, 'recordInTx').mockRejectedValueOnce(new Error('simulated database failure'));
    expect((await put({ ...SEEDED, title: 'Never saved' })).status).toBe(500);
    expect(await getBar()).toEqual(before);
  });
});

describe('The implementation partner box switch', () => {
  const PARTNER = { label: PARTNER_LABEL, name: PARTNER_NAME };

  it('hiding the box sends no partner to the website but keeps its label and name; showing it brings them back', async () => {
    const current = await getBar();
    const hidden = await put({ ...SEEDED, showPartner: false, expectedUpdatedAt: current.updatedAt });
    expect(hidden.status).toBe(200);
    expect(hidden.body.data).toMatchObject({ ...SEEDED, showPartner: false, showSection: true });
    expect(await lastAuditDetails()).toEqual({ title: TITLE, partnerName: PARTNER_NAME, showPartner: false });
    /* Only the partner box goes: the rest of the bar is still shown. */
    expect(await publicFeed()).toEqual({ showSection: true, title: TITLE, fullName: FULL_NAME, partner: null });

    const shown = await put({ ...SEEDED, showPartner: true, expectedUpdatedAt: hidden.body.data.updatedAt });
    expect(shown.status).toBe(200);
    expect(shown.body.data.showPartner).toBe(true);
    expect(await lastAuditDetails()).toEqual({ title: TITLE, partnerName: PARTNER_NAME, showPartner: true });
    expect((await publicFeed()).partner).toEqual(PARTNER);
  });

  it('a save without showPartner leaves the switch as it is, either way', async () => {
    await put({ ...SEEDED, showPartner: false }).expect(200);
    /* An edit from a client that does not send the switch: the box stays hidden, and the new name is kept for later. */
    const edited = await put({ ...SEEDED, partnerName: 'Example Partner Ltd' });
    expect(edited.status).toBe(200);
    expect(edited.body.data).toMatchObject({ partnerName: 'Example Partner Ltd', showPartner: false });
    expect(await lastAuditDetails()).toEqual({ title: TITLE, partnerName: 'Example Partner Ltd', showPartner: false });
    expect((await publicFeed()).partner).toBeNull();

    await put({ ...SEEDED, showPartner: true }).expect(200);
    expect((await put(SEEDED).expect(200)).body.data.showPartner).toBe(true);
    expect((await publicFeed()).partner).toEqual(PARTNER);
  });

  it('a blank partner name sends no partner even while the box is switched on', async () => {
    await put({ ...SEEDED, partnerName: '', showPartner: true }).expect(200);
    expect((await publicFeed()).partner).toBeNull();
    await put(SEEDED).expect(200);
  });

  it('is independent of the whole-bar switch, which a save never changes', async () => {
    /* The "Show on website" switch (src/cms/visibility) is the whole bar's one writer. */
    await AppDataSource.query(`UPDATE "brand_bar_settings" SET "showSection" = false`);
    const res = await put({ ...SEEDED, showPartner: false });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ showSection: false, showPartner: false });
    expect(await publicFeed()).toMatchObject({ showSection: false, partner: null });

    await put({ ...SEEDED, showPartner: true }).expect(200);
    expect(await publicFeed()).toMatchObject({ showSection: false, partner: PARTNER });

    await AppDataSource.query(`UPDATE "brand_bar_settings" SET "showSection" = true`);
    expect(await publicFeed()).toMatchObject({ showSection: true, partner: PARTNER });
  });

  it('refuses a showPartner that is not true or false', async () => {
    for (const value of ['yes', 1, null]) {
      const res = await put({ ...SEEDED, showPartner: value });
      expect(res.status).toBe(422);
      expect(details(res)).toEqual([{ field: 'body.showPartner', message: 'showPartner must be true or false' }]);
    }
    expect((await getBar()).showPartner).toBe(true);
  });

  it('a view-only administrator cannot switch it', async () => {
    const viewer = await actorWith(['cms-brandbar.view']);
    expect((await put({ ...SEEDED, showPartner: false }, viewer.token)).status).toBe(403);
    expect((await getBar()).showPartner).toBe(true);
  });
});

describe('Access control', () => {
  it('the public feed needs no session', async () => {
    expect((await request(app).get(PUBLIC_URL)).status).toBe(200);
  });

  it('refuses the admin routes without a session', async () => {
    expect((await request(app).get(ADMIN_URL)).status).toBe(401);
    expect((await request(app).put(ADMIN_URL).send(SEEDED)).status).toBe(401);
  });

  it('a view-only administrator can read but not save', async () => {
    const viewer = await actorWith(['cms-brandbar.view']);
    expect((await request(app).get(ADMIN_URL).set(auth(viewer.token))).status).toBe(200);
    expect((await put(SEEDED, viewer.token)).status).toBe(403);
  });

  it('another CMS permission does not open this section', async () => {
    const topBar = await actorWith(['cms-topbar.view', 'cms-topbar.update']);
    expect((await request(app).get(ADMIN_URL).set(auth(topBar.token))).status).toBe(403);
    expect((await put(SEEDED, topBar.token)).status).toBe(403);
  });

  it('a Website Admin reads and saves it', async () => {
    const user = await createUser({ roleCodes: [ROLE_CODES.WEBSITE_ADMIN] });
    const token = await login(user.email);
    expect((await request(app).get(ADMIN_URL).set(auth(token))).status).toBe(200);
    expect((await put(SEEDED, token)).status).toBe(200);
  });
});
