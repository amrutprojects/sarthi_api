import type { Express } from 'express';
import { AppDataSource, API, request, setupTestApp, superAdmin, teardownTestApp, type TestActor } from '../../helpers/test-app';
import { makeDistrict, makeState } from '../../cms/helpers';
import { seedContactPage } from '../../../src/database/seeds/seed-contact-page';
import { CmsLiveDashboard1797600000000 } from '../../../src/database/migrations/1797600000000-CmsLiveDashboard';
import { RemoveDemoWording1797900000000 } from '../../../src/database/migrations/1797900000000-RemoveDemoWording';
import { ContactTrainingCentres1798300000000 } from '../../../src/database/migrations/1798300000000-ContactTrainingCentres';
import {
  RemoveDemoDataset1798800000000,
  type RemoveDemoDatasetSummary,
} from '../../../src/database/migrations/1798800000000-RemoveDemoDataset';

/*
 * Migration 1798800000000-RemoveDemoDataset: removes the Live Dashboard's demo figures and the ten demo
 * training centres that two applied migrations inserted — only rows still exactly as inserted.
 */
let app: Express;
let admin: TestActor;

const CENTRE_DISTRICTS: [string, string][] = [
  ['Ahilyanagar', 'AHL'],
  ['Beed', 'BEE'],
  ['Chhatrapati Sambhajinagar', 'CSN'],
  ['Jalgaon', 'JAL'],
  ['Kolhapur', 'KOL'],
  ['Nanded', 'NAN'],
  ['Nashik', 'NAS'],
  ['Pune', 'PUN'],
  ['Satara', 'SAT'],
  ['Thane', 'THA'],
];

async function withRunner<T>(fn: (qr: ReturnType<typeof AppDataSource.createQueryRunner>) => Promise<T>): Promise<T> {
  const qr = AppDataSource.createQueryRunner();
  try {
    return await fn(qr);
  } finally {
    await qr.release();
  }
}

/* The state the two demo migrations (and the later wording fix) leave: every demo row, untouched. */
async function rebuildDemoState(): Promise<void> {
  await withRunner(async (qr) => {
    const dashboard = new CmsLiveDashboard1797600000000();
    await dashboard.down(qr);
    await dashboard.up(qr);
    await new RemoveDemoWording1797900000000().up(qr);
    const centres = new ContactTrainingCentres1798300000000();
    await centres.down(qr);
    await centres.up(qr);
  });
}

async function runCleanup(): Promise<RemoveDemoDatasetSummary> {
  const migration = new RemoveDemoDataset1798800000000();
  await withRunner((qr) => migration.up(qr));
  return migration.summary!;
}

/* Every row of the five tables, ordered, with updatedAt — to prove a second run changes nothing. */
async function snapshot(): Promise<unknown[]> {
  const out: unknown[] = [];
  for (const t of [
    'live_dashboard_settings',
    'live_dashboard_cards',
    'live_dashboard_stats',
    'live_dashboard_districts',
    'contact_training_centres',
  ]) {
    out.push(await AppDataSource.query(`SELECT * FROM "${t}" ORDER BY "id"`));
  }
  return out;
}

const liveCards = async () =>
  (await AppDataSource.query(`SELECT "labelEn", "value" FROM "live_dashboard_cards" WHERE "isDelete" = false ORDER BY "labelEn"`)) as {
    labelEn: string;
    value: string;
  }[];
const liveStats = async () =>
  (await AppDataSource.query(`SELECT "labelEn", "value" FROM "live_dashboard_stats" WHERE "isDelete" = false ORDER BY "labelEn"`)) as {
    labelEn: string;
    value: string;
  }[];
const district = async (code: string) =>
  (
    await AppDataSource.query(
      `SELECT "nameEn", "status", "target", "enrolled", "trainingActive", "completed", "certified", "attendancePct", "displayOrder"
       FROM "live_dashboard_districts" WHERE "districtCode" = $1 AND "isDelete" = false`,
      [code],
    )
  )[0];
const settings = async () =>
  (
    await AppDataSource.query(
      `SELECT "headingEn", "mapTitleEn", "offlineCount", "onlineCount", "showSection" FROM "live_dashboard_settings" WHERE "isDelete" = false`,
    )
  )[0];
const liveCentres = async () =>
  (await AppDataSource.query(
    `SELECT c."nameEn", c."phone", c."email", d."code" FROM "contact_training_centres" c JOIN "districts" d ON d."id" = c."districtId"
     WHERE c."isDelete" = false ORDER BY c."nameEn"`,
  )) as { nameEn: string; phone: string | null; email: string | null; code: string }[];

beforeAll(async () => {
  app = await setupTestApp();
  admin = await superAdmin();
  await seedContactPage(AppDataSource);
  const state = await makeState(app, admin.token, 'Demo Clean State', 'DC');
  for (const [name, code] of CENTRE_DISTRICTS) await makeDistrict(app, admin.token, state.id, name, code);
});

/* Leave the Live Dashboard as the migrations make it, for the other test files (its tables survive resetData). */
afterAll(async () => {
  await rebuildDemoState();
  await runCleanup();
  await teardownTestApp();
});

describe('an install nobody has edited', () => {
  beforeAll(rebuildDemoState);

  it('starts from every demo row (the precondition)', async () => {
    expect(await liveCards()).toHaveLength(8);
    expect(await liveStats()).toHaveLength(5);
    expect(await liveCentres()).toHaveLength(10);
    expect(await settings()).toMatchObject({ offlineCount: 800, onlineCount: 200, showSection: true });
  });

  it('removes every demo figure and centre, zeroes the map and hides the empty section', async () => {
    const summary = await runCleanup();
    expect(summary).toEqual({
      cards: { removed: 8, kept: 0 },
      stats: { removed: 5, kept: 0 },
      districts: { zeroed: 36, kept: 0 },
      modesZeroed: true,
      sectionHidden: true,
      centres: { removed: 10, kept: 0 },
    });
    expect(await liveCards()).toEqual([]);
    expect(await liveStats()).toEqual([]);
    expect(await liveCentres()).toEqual([]);
    /* The site's real texts stay; only the figures go. */
    expect(await settings()).toEqual({
      headingEn: 'Programme Progress - Live Dashboard',
      mapTitleEn: 'District-wise progress — Maharashtra',
      offlineCount: 0,
      onlineCount: 0,
      showSection: false,
    });
    /* The 36 map tiles stay, names and order intact, with no figures. */
    expect((await AppDataSource.query(`SELECT count(*)::int AS n FROM "live_dashboard_districts" WHERE "isDelete" = false`))[0].n).toBe(36);
    expect(await district('PUN')).toEqual({
      nameEn: 'Pune',
      status: 'NOT_STARTED',
      target: 0,
      enrolled: 0,
      trainingActive: 0,
      completed: 0,
      certified: 0,
      attendancePct: 0,
      displayOrder: 26,
    });
    /* Soft-deleted, as the admin panel's Delete does: the rows stay for the record. */
    expect(
      (await AppDataSource.query(`SELECT count(*)::int AS n FROM "live_dashboard_cards" WHERE "isDelete" = true AND "isActive" = false`))[0]
        .n,
    ).toBe(8);
    expect((await AppDataSource.query(`SELECT count(*)::int AS n FROM "contact_training_centres" WHERE "isDelete" = true`))[0].n).toBe(10);
  });

  it('feeds the website no invented number', async () => {
    const feed = (await request(app).get(`${API}/public/live-dashboard`).expect(200)).body.data;
    expect(feed).toMatchObject({ showSection: false, cards: [], map: null, modes: null });
  });

  it('changes nothing on a second run', async () => {
    const before = await snapshot();
    expect(await runCleanup()).toEqual({
      cards: { removed: 0, kept: 0 },
      stats: { removed: 0, kept: 0 },
      districts: { zeroed: 0, kept: 0 },
      modesZeroed: false,
      sectionHidden: false,
      centres: { removed: 0, kept: 0 },
    });
    expect(await snapshot()).toEqual(before);
  });

  it('down() is a no-op: no demo row comes back', async () => {
    const before = await snapshot();
    await new RemoveDemoDataset1798800000000().down();
    expect(await snapshot()).toEqual(before);
  });
});

describe('an install an administrator has edited', () => {
  beforeAll(async () => {
    await rebuildDemoState();
    /* Edited demo rows (must stay). */
    await AppDataSource.query(`UPDATE "live_dashboard_cards" SET "value" = '2,100' WHERE "labelEn" = 'Total target'`);
    await AppDataSource.query(
      `UPDATE "live_dashboard_cards" SET "detailEn" = 'registrations', "detailMr" = 'नोंदणी' WHERE "labelEn" = 'Applications'`,
    );
    await AppDataSource.query(`UPDATE "live_dashboard_stats" SET "value" = '13' WHERE "labelEn" = 'Trainers'`);
    await AppDataSource.query(`UPDATE "live_dashboard_districts" SET "target" = 81 WHERE "districtCode" = 'PUN'`);
    await AppDataSource.query(`UPDATE "live_dashboard_districts" SET "status" = 'COMPLETED' WHERE "districtCode" = 'NAS'`);
    await AppDataSource.query(`UPDATE "live_dashboard_settings" SET "offlineCount" = 900`);
    await AppDataSource.query(
      `UPDATE "contact_training_centres" SET "phone" = '+91 20 1234 5678' WHERE "nameEn" = 'Haveli Skill Development Centre'`,
    );
    await AppDataSource.query(
      `UPDATE "contact_training_centres" SET "email" = 'nashik@example.org' WHERE "nameEn" = 'Nashik Institute of Technical Training'`,
    );
    /* Demo rows only reordered or hidden: still invented figures (must go). */
    await AppDataSource.query(`UPDATE "live_dashboard_cards" SET "displayOrder" = 99, "isActive" = false WHERE "labelEn" = 'Certified'`);
    await AppDataSource.query(
      `UPDATE "contact_training_centres" SET "displayOrder" = 5, "isActive" = false WHERE "nameEn" = 'Kalyan Vocational Training Centre'`,
    );
    /* Rows an administrator added (must stay), one of them matching a demo label but not its value. */
    await AppDataSource.query(
      `INSERT INTO "live_dashboard_cards" ("labelMr", "labelEn", "value", "displayOrder") VALUES ('नवीन', 'New card', '5', 9), ('प्रवेशित', 'Enrolled', '42', 10)`,
    );
    const [{ id: settingsId }] = await AppDataSource.query(`SELECT "id" FROM "contact_page_settings" WHERE "isDelete" = false`);
    const [{ id: puneId }] = await AppDataSource.query(`SELECT "id" FROM "districts" WHERE "code" = 'PUN'`);
    await AppDataSource.query(
      `INSERT INTO "contact_training_centres" ("settingsId", "districtId", "nameMr", "nameEn") VALUES ($1, $2, 'नवीन केंद्र', 'New Centre')`,
      [settingsId, puneId],
    );
  });

  it('removes only the untouched demo rows and keeps every edited or added one', async () => {
    expect(await runCleanup()).toEqual({
      cards: { removed: 6, kept: 4 },
      stats: { removed: 4, kept: 1 },
      districts: { zeroed: 34, kept: 2 },
      modesZeroed: false,
      sectionHidden: false,
      centres: { removed: 8, kept: 3 },
    });
    expect(await liveCards()).toEqual([
      { labelEn: 'Applications', value: '1,245' },
      { labelEn: 'Enrolled', value: '42' },
      { labelEn: 'New card', value: '5' },
      { labelEn: 'Total target', value: '2,100' },
    ]);
    expect(await liveStats()).toEqual([{ labelEn: 'Trainers', value: '13' }]);
    expect(await district('PUN')).toMatchObject({ status: 'TRAINING_ACTIVE', target: 81, certified: 56 });
    expect(await district('NAS')).toMatchObject({ status: 'COMPLETED', target: 80, certified: 55 });
    expect(await district('THA')).toMatchObject({ status: 'NOT_STARTED', target: 0, certified: 0 });
    /* Edited counts stay, and the administrator's switch is left as it was. */
    expect(await settings()).toMatchObject({ offlineCount: 900, onlineCount: 200, showSection: true });
    expect(await liveCentres()).toEqual([
      { nameEn: 'Haveli Skill Development Centre', phone: '+91 20 1234 5678', email: null, code: 'PUN' },
      { nameEn: 'Nashik Institute of Technical Training', phone: '+91 98XXX 51201', email: 'nashik@example.org', code: 'NAS' },
      { nameEn: 'New Centre', phone: null, email: null, code: 'PUN' },
    ]);
  });

  it('changes nothing on a second run', async () => {
    const before = await snapshot();
    const summary = await runCleanup();
    expect(summary).toMatchObject({
      cards: { removed: 0 },
      stats: { removed: 0 },
      districts: { zeroed: 0 },
      modesZeroed: false,
      sectionHidden: false,
      centres: { removed: 0 },
    });
    expect(await snapshot()).toEqual(before);
  });
});

describe('transaction', () => {
  it('rolls everything back when a step fails, leaving the demo rows as they were', async () => {
    await rebuildDemoState();
    const before = await snapshot();
    const migration = new RemoveDemoDataset1798800000000();
    await expect(
      withRunner(async (qr) => {
        const query = qr.query.bind(qr);
        /* Fail at the last step (the centres), after every Live Dashboard change has been made. */
        jest.spyOn(qr, 'query').mockImplementation((sql: string, params?: unknown[]) => {
          if (sql.includes('contact_training_centres" c SET')) return Promise.reject(new Error('boom'));
          return query(sql, params);
        });
        await migration.up(qr);
      }),
    ).rejects.toThrow('boom');
    jest.restoreAllMocks();
    expect(await snapshot()).toEqual(before);
  });
});
