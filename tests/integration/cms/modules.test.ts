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
import { seedModulesPage } from '../../../src/database/seeds/seed-modules-page';
import { ModulesLabelAndVisibility1793900000000 } from '../../../src/database/migrations/1793900000000-ModulesLabelAndVisibility';

const ADMIN_URL = `${API}/cms/modules`;
const PUBLIC_URL = `${API}/public/modules`;

let app: Express;
let admin: TestActor;

interface AdminDomain {
  no: number;
  domain: { mr: string; en: string };
  certificate: string;
  displayOrder: number;
  isActive: boolean;
}
interface AdminModule {
  no: number;
  code: string;
  kind: 'MAIN' | 'ELECTIVE';
  showElectiveLabel: boolean;
  name: { mr: string; en: string };
  description: { mr: string; en: string };
  timeSplit: Record<string, number>;
  displayOrder: number;
  isActive: boolean;
  electives: AdminDomain[];
}
interface PublicModule {
  code: string;
  kind: 'MAIN' | 'ELECTIVE';
  showElectiveLabel: boolean;
}

/* The admin read turned back into the PUT body the admin screen submits. */
async function currentPayload() {
  const res = await request(app).get(ADMIN_URL).set(auth(admin.token)).expect(200);
  const d = res.body.data;
  return {
    pageTitle: d.pageTitle,
    pageSubtitle: d.pageSubtitle,
    learningPath: d.learningPath,
    modules: (d.modules as AdminModule[]).map((m) => ({
      no: m.no,
      code: m.code,
      kind: m.kind,
      showElectiveLabel: m.showElectiveLabel,
      name: m.name,
      description: m.description,
      timeSplit: m.timeSplit,
      displayOrder: m.displayOrder,
      isActive: m.isActive,
      electives: m.electives.map((e) => ({
        no: e.no,
        domain: e.domain,
        certificate: e.certificate,
        displayOrder: e.displayOrder,
        isActive: e.isActive,
      })),
    })),
  };
}

type Payload = Awaited<ReturnType<typeof currentPayload>>;
type PayloadModule = Omit<Payload['modules'][number], 'showElectiveLabel'> & { showElectiveLabel?: boolean };

const withModule = (p: Payload, code: string, change: (m: PayloadModule) => PayloadModule) => ({
  ...p,
  modules: p.modules.map((m) => (m.code === code ? change(m) : m)),
});

const byCode = <T extends { code: string }>(list: T[]) => Object.fromEntries(list.map((m) => [m.code, m]));

/* resetData() truncates the programme module tables, so this file seeds the singleton it edits. */
beforeAll(async () => {
  app = await setupTestApp();
  await seedModulesPage(AppDataSource);
  admin = await superAdmin();
});
afterAll(teardownTestApp);

describe('Modules page seed', () => {
  it('shows the "Elective" label on every seeded module, to the admin screen and the website', async () => {
    const res = await request(app).get(ADMIN_URL).set(auth(admin.token));
    expect(res.status).toBe(200);
    const modules = res.body.data.modules as AdminModule[];
    expect(modules.map((m) => [m.code, m.kind])).toEqual([
      ['ECS', 'MAIN'],
      ['ITS', 'MAIN'],
      ['DS-BDS', 'ELECTIVE'],
      ['DS-ADS', 'ELECTIVE'],
    ]);
    expect(modules.every((m) => m.showElectiveLabel === true)).toBe(true);

    const pub = await request(app).get(PUBLIC_URL);
    expect(pub.status).toBe(200);
    expect((pub.body.data.modules as PublicModule[]).map((m) => m.showElectiveLabel)).toEqual([true, true, true, true]);
  });

  it('carries no publish state: the page has no visibility switch', async () => {
    const res = await request(app).get(ADMIN_URL).set(auth(admin.token));
    expect(res.body.data).not.toHaveProperty('isPublished');
    expect((await request(app).get(PUBLIC_URL)).body.data).not.toHaveProperty('isPublished');
  });
});

describe('"Show \'Elective\' label on website"', () => {
  it('can be unticked for an elective module, and the website receives it', async () => {
    const payload = withModule(await currentPayload(), 'DS-BDS', (m) => ({ ...m, showElectiveLabel: false }));
    const res = await request(app).put(ADMIN_URL).set(auth(admin.token)).send(payload);
    expect(res.status).toBe(200);
    expect(byCode(res.body.data.modules as AdminModule[])['DS-BDS'].showElectiveLabel).toBe(false);

    const pub = await request(app).get(PUBLIC_URL);
    const modules = byCode(pub.body.data.modules as PublicModule[]);
    expect(modules['DS-BDS']).toMatchObject({ kind: 'ELECTIVE', showElectiveLabel: false });
    /* Only the label: the module is still an elective, still listed, and the others are untouched. */
    expect(modules['DS-ADS'].showElectiveLabel).toBe(true);
    expect(modules.ECS.showElectiveLabel).toBe(true);
    expect(Object.keys(modules)).toHaveLength(4);
  });

  it('defaults to true when a client omits it', async () => {
    const payload = withModule(await currentPayload(), 'DS-BDS', ({ showElectiveLabel: _omitted, ...m }) => m);
    await request(app).put(ADMIN_URL).set(auth(admin.token)).send(payload).expect(200);
    const pub = await request(app).get(PUBLIC_URL);
    expect(byCode(pub.body.data.modules as PublicModule[])['DS-BDS'].showElectiveLabel).toBe(true);
  });

  it('keeps the setting when the module type is switched', async () => {
    const asMain = withModule(await currentPayload(), 'DS-ADS', (m) => ({ ...m, kind: 'MAIN', showElectiveLabel: false }));
    const res = await request(app).put(ADMIN_URL).set(auth(admin.token)).send(asMain);
    expect(byCode(res.body.data.modules as AdminModule[])['DS-ADS']).toMatchObject({ kind: 'MAIN', showElectiveLabel: false });

    const back = withModule(await currentPayload(), 'DS-ADS', (m) => ({ ...m, kind: 'ELECTIVE' }));
    const again = await request(app).put(ADMIN_URL).set(auth(admin.token)).send(back);
    expect(byCode(again.body.data.modules as AdminModule[])['DS-ADS']).toMatchObject({ kind: 'ELECTIVE', showElectiveLabel: false });

    /* Restore, so later tests start from the seeded labels. */
    const restored = withModule(await currentPayload(), 'DS-ADS', (m) => ({ ...m, showElectiveLabel: true }));
    await request(app).put(ADMIN_URL).set(auth(admin.token)).send(restored).expect(200);
  });

  it('must be a boolean', async () => {
    const payload = withModule(await currentPayload(), 'DS-BDS', (m) => ({ ...m, showElectiveLabel: 'no' as unknown as boolean }));
    const res = await request(app).put(ADMIN_URL).set(auth(admin.token)).send(payload);
    expect(res.status).toBe(422);
    const fields = res.body.error.details.map((d: { field: string }) => d.field);
    expect(fields).toContain('body.modules.2.showElectiveLabel');
  });

  it('records which elective labels are hidden in the audit log', async () => {
    const payload = withModule(await currentPayload(), 'DS-ADS', (m) => ({ ...m, showElectiveLabel: false }));
    await request(app).put(ADMIN_URL).set(auth(admin.token)).send(payload).expect(200);
    const [row] = await AppDataSource.query(
      `SELECT "details" FROM "audit_logs" WHERE "action" = 'cms.modules-page.update' ORDER BY "createdAt" DESC LIMIT 1`,
    );
    expect(row.details.hiddenElectiveLabels).toEqual(['DS-ADS']);
    expect(row.details).not.toHaveProperty('isPublished');

    const restored = withModule(await currentPayload(), 'DS-ADS', (m) => ({ ...m, showElectiveLabel: true }));
    await request(app).put(ADMIN_URL).set(auth(admin.token)).send(restored).expect(200);
  });
});

describe('Modules page visibility', () => {
  it('serves the content publicly even when the stored isPublished flag is false', async () => {
    await AppDataSource.query(`UPDATE "programme_module_settings" SET "isPublished" = false`);
    try {
      const pub = await request(app).get(PUBLIC_URL);
      expect(pub.status).toBe(200);
      expect(pub.body.data).not.toBeNull();
      expect(pub.body.data.modules).toHaveLength(4);

      /* Saving does not touch the flag either: nothing reads or writes it for this page. */
      await request(app)
        .put(ADMIN_URL)
        .set(auth(admin.token))
        .send(await currentPayload())
        .expect(200);
      const [row] = await AppDataSource.query(`SELECT "isPublished" FROM "programme_module_settings"`);
      expect(row.isPublished).toBe(false);
      expect((await request(app).get(PUBLIC_URL)).body.data).not.toBeNull();
    } finally {
      await AppDataSource.query(`UPDATE "programme_module_settings" SET "isPublished" = true`);
    }
  });

  it('still returns no data when the settings row is inactive, whatever isPublished says', async () => {
    await AppDataSource.query(`UPDATE "programme_module_settings" SET "isActive" = false, "isPublished" = true`);
    try {
      const pub = await request(app).get(PUBLIC_URL);
      expect(pub.status).toBe(200);
      expect(pub.body.data).toBeNull();
    } finally {
      await AppDataSource.query(`UPDATE "programme_module_settings" SET "isActive" = true`);
    }
    expect((await request(app).get(PUBLIC_URL)).body.data).not.toBeNull();
  });

  it('has no PATCH /status route any more', async () => {
    const res = await request(app).patch(`${ADMIN_URL}/status`).set(auth(admin.token)).send({ isPublished: false });
    expect(res.status).toBe(404);
    expect((await request(app).get(PUBLIC_URL)).body.data).not.toBeNull();
  });

  it('rejects isPublished in the PUT body', async () => {
    const res = await request(app)
      .put(ADMIN_URL)
      .set(auth(admin.token))
      .send({ ...(await currentPayload()), isPublished: false });
    expect(res.status).toBe(422);
    expect(JSON.stringify(res.body.error.details)).toContain('isPublished');
  });

  it('rejects the programme fact sheet in the PUT body (it belongs to the Programme page)', async () => {
    const facts = { idealMonths: '4-6', validityMonths: '12', securityDeposit: 2000, applyLeadDays: 30, partnerName: 'Partner' };
    const res = await request(app)
      .put(ADMIN_URL)
      .set(auth(admin.token))
      .send({ ...(await currentPayload()), facts });
    expect(res.status).toBe(422);
    expect(JSON.stringify(res.body.error.details)).toContain('facts');
  });
});

describe('migration 1793900000000', () => {
  /*
   * Runs down() then up() inside a transaction that is always rolled back, so the shared test
   * schema is left exactly as the migrations built it whatever happens here.
   */
  it('adds showElectiveLabel defaulting to true and makes unpublished Modules content live', async () => {
    const migration = new ModulesLabelAndVisibility1793900000000();
    const qr = AppDataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();
    try {
      await migration.down(qr);
      const dropped = await qr.query(
        `SELECT 1 FROM information_schema.columns WHERE table_name = 'programme_modules' AND column_name = 'showElectiveLabel'`,
      );
      expect(dropped).toHaveLength(0);

      await qr.query(`UPDATE "programme_module_settings" SET "isPublished" = false`);
      await migration.up(qr);

      const [settings] = await qr.query(`SELECT "isPublished" FROM "programme_module_settings"`);
      expect(settings.isPublished).toBe(true);
      const labels: { showElectiveLabel: boolean }[] = await qr.query(`SELECT "showElectiveLabel" FROM "programme_modules"`);
      expect(labels.length).toBeGreaterThan(0);
      expect(labels.every((l) => l.showElectiveLabel === true)).toBe(true);
    } finally {
      await qr.rollbackTransaction();
      await qr.release();
    }
  });
});

describe('Modules page permissions', () => {
  it('enforces the CMS permissions', async () => {
    const viewer = await actorWith(['cms-modules.view']);
    expect((await request(app).get(ADMIN_URL).set(auth(viewer.token))).status).toBe(200);
    expect(
      (
        await request(app)
          .put(ADMIN_URL)
          .set(auth(viewer.token))
          .send(await currentPayload())
      ).status,
    ).toBe(403);
    expect((await request(app).get(ADMIN_URL)).status).toBe(401);
  });
});
