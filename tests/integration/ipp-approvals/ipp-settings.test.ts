import { randomUUID } from 'crypto';
import type { Express } from 'express';
import {
  IppHeadOfficeChangedDto,
  IppHeadOfficeDto,
  IppOfficerDto,
  IppOfficersDto,
} from '../../../src/modules/ipp-approvals/ipp-approvals.openapi';
import { envelope } from '../../../src/shared/openapi/registry';
import {
  audits,
  decisions,
  divisionalOfficer,
  events,
  NASHIK,
  resetIpp,
  restoreLink,
  seedDistricts,
  signedIn,
  stageOf,
  submit,
  switchLink,
  wireApplication,
  wireBatch,
} from '../../helpers/ipp';
import {
  actorWith,
  API,
  AppDataSource,
  auth,
  createUser,
  request,
  setupTestApp,
  superAdmin,
  teardownTestApp,
  type TestActor,
} from '../../helpers/test-app';

/* The switch "Head Office approval", and the Divisional Officers with their districts. */
const BASE = `${API}/ipp-approvals`;
let app: Express;
let districts: Record<'PUN' | 'NAS' | 'THA', string>;
let pune: TestActor;
let coep: TestActor;
let head: TestActor;
let admin: TestActor;

beforeAll(async () => {
  app = await setupTestApp();
  districts = await seedDistricts();
  pune = await divisionalOfficer([districts.PUN], 'Officer Pune');
  coep = await signedIn(['COEP'], 'Officer COEP');
  head = await signedIn(['HEAD_OFFICER'], 'Officer Head');
  admin = await superAdmin();
  switchLink(true);
});
afterAll(async () => {
  restoreLink();
  await teardownTestApp();
});
beforeEach(resetIpp);

const get = (who: TestActor, path: string) => request(app).get(`${BASE}${path}`).set(auth(who.token));
const put = (who: TestActor, path: string, body: object) => request(app).put(`${BASE}${path}`).set(auth(who.token)).send(body);
const approve = (who: TestActor, id: string) => request(app).post(`${BASE}/applications/${id}/approve`).set(auth(who.token));
const headOffice = (enabled: boolean, who = admin) => put(who, '/head-office', { enabled });

describe('Head Office approval', () => {
  it('is on until somebody switches it off; the change is named and audited', async () => {
    let res = await get(head, '/head-office');
    expect(envelope(IppHeadOfficeDto).safeParse(res.body).success).toBe(true);
    expect(res.body.data).toEqual({ enabled: true, updatedAt: null, updatedBy: null });

    res = await headOffice(false);
    expect(res.status).toBe(200);
    expect(envelope(IppHeadOfficeChangedDto).safeParse(res.body).success).toBe(true);
    expect(res.body.data).toEqual({ enabled: false, updatedAt: expect.any(String), updatedBy: admin.user.name, moved: 0 });
    expect(typeof res.body.data.updatedBy).toBe('string');
    expect((await get(await actorWith(['settings.view']), '/head-office')).body.data).toMatchObject({
      enabled: false,
      updatedBy: admin.user.name,
    });

    /* The same again changes nothing. */
    expect((await headOffice(false)).body.data).toMatchObject({ enabled: false, moved: 0 });
    expect((await audits('ipp.head-office.update')).map((a) => [a.actorUserId, a.resourceId, a.details])).toEqual([
      [admin.user.id, 'ipp.head_office_approval', { from: true, to: false, moved: 0 }],
    ]);
  });

  it('moves everything waiting at the other final stage, both ways, and nothing else', async () => {
    const [waiting, atCoep, atDivision, done] = await submit(
      app,
      wireBatch(),
      Array.from({ length: 4 }, () => wireApplication()),
    );
    for (const id of [waiting, atCoep, done]) await approve(pune, id);
    for (const id of [waiting, done]) await approve(coep, id);
    await approve(head, done);

    const off = await headOffice(false);
    expect(off.body.data).toMatchObject({ enabled: false, moved: 1 });
    expect(await Promise.all([waiting, atCoep, atDivision, done].map(stageOf))).toEqual(['SUPER_ADMIN', 'COEP', 'DIVISION', 'APPROVED']);
    expect((await events(waiting)).at(-1)).toMatchObject({
      event: 'MOVED',
      fromStage: 'HEAD_OFFICE',
      toStage: 'SUPER_ADMIN',
      byName: admin.user.name,
      byRole: 'Super Admin',
    });
    expect((await decisions(waiting)).at(-1)).toMatchObject({
      action: 'MOVE',
      fromStage: 'HEAD_OFFICE',
      toStage: 'SUPER_ADMIN',
      reason: null,
      status: 'PENDING',
    });
    expect((await get(admin, '/summary')).body.data).toMatchObject({ toDecide: 1, sentBack: 0 });
    expect((await get(head, '/summary')).body.data).toMatchObject({ stages: [], toDecide: 0 });

    const manager = await actorWith(['settings.update', 'settings.view']);
    const on = await headOffice(true, manager);
    expect(on.body.data).toMatchObject({ enabled: true, moved: 1, updatedBy: manager.user.name });
    expect(await stageOf(waiting)).toBe('HEAD_OFFICE');
    expect((await events(waiting)).at(-1)).toMatchObject({
      event: 'MOVED',
      fromStage: 'SUPER_ADMIN',
      toStage: 'HEAD_OFFICE',
      byRole: 'Administrator',
    });
    expect((await approve(head, waiting)).body.data.stage).toBe('APPROVED');
    expect((await decisions(waiting)).map((d) => `${d.action} ${d.fromStage}>${d.toStage}`)).toEqual([
      'APPROVE DIVISION>COEP',
      'APPROVE COEP>HEAD_OFFICE',
      'MOVE HEAD_OFFICE>SUPER_ADMIN',
      'MOVE SUPER_ADMIN>HEAD_OFFICE',
      'APPROVE HEAD_OFFICE>APPROVED',
    ]);
  });

  it('switching while officers decide leaves no form at a stage nobody decides', async () => {
    const ids = await submit(
      app,
      wireBatch(),
      Array.from({ length: 12 }, () => wireApplication()),
    );
    await request(app).post(`${BASE}/approve`).set(auth(pune.token)).send({ ids });
    const answers = await Promise.all([...ids.map((id) => approve(coep, id)), headOffice(false)]);
    expect(answers.map((r) => r.status)).toEqual(Array(13).fill(200));
    expect(new Set(await Promise.all(ids.map(stageOf)))).toEqual(new Set(['SUPER_ADMIN']));

    const back = await Promise.all([...ids.map((id) => approve(admin, id)), headOffice(true)]);
    const stages = await Promise.all(ids.map(stageOf));
    expect(new Set(stages)).not.toContain('SUPER_ADMIN');
    /* Every form went one way or the other: approved, or moved before the Super Admin came to it. */
    expect(stages.filter((s) => s === 'APPROVED')).toHaveLength(back.slice(0, 12).filter((r) => r.status === 200).length);
  });

  it('needs settings.update and a boolean', async () => {
    expect((await headOffice(false, await actorWith(['settings.view', 'ipp-approvals.view']))).status).toBe(403);
    for (const body of [{}, { enabled: 'no' }, { enabled: false, x: 1 }]) expect((await put(admin, '/head-office', body)).status).toBe(422);
  });
});

describe('Divisional Officers and their districts', () => {
  const officers = async () =>
    (await get(admin, '/officers')).body.data as { officers: { id: string; districts: { name: string }[] }[]; withoutOfficer: object[] };
  const set = (userId: string, districtIds: unknown, who = admin) => put(who, `/officers/${userId}/districts`, { districtIds });

  it('lists the users whose roles hold the right; never a Super Admin', async () => {
    const custom = await actorWith(['ipp-approvals.view', 'ipp-approvals.division-officer']);
    const inactive = await createUser({ roleCodes: ['DIVISIONAL_OFFICER'], isActive: false });
    const bossToo = await signedIn(['SUPER_ADMIN', 'DIVISIONAL_OFFICER']);
    const deleted = await createUser({ roleCodes: ['DIVISIONAL_OFFICER'] });
    await AppDataSource.query(`UPDATE "users" SET "isDelete" = true, "isActive" = false WHERE "id" = $1`, [deleted.id]);

    const res = await get(admin, '/officers');
    expect(res.status).toBe(200);
    expect(envelope(IppOfficersDto).safeParse(res.body).success).toBe(true);
    const ids = (await officers()).officers.map((o) => o.id);
    expect(ids).toEqual(expect.arrayContaining([pune.user.id, custom.user.id, inactive.id]));
    for (const id of [admin.user.id, bossToo.user.id, coep.user.id, head.user.id, deleted.id]) expect(ids).not.toContain(id);
    expect((await officers()).officers.find((o) => o.id === pune.user.id)).toEqual({
      id: pune.user.id,
      name: 'Officer Pune',
      email: pune.user.email,
      isActive: true,
      districts: [{ id: districts.PUN, name: 'Pune' }],
    });
  });

  it('replaces the districts, which takes effect at once and is audited', async () => {
    const officer = await divisionalOfficer([]);
    const [id] = await submit(app, wireBatch({ district: NASHIK }), [wireApplication()]);
    expect((await get(officer, `/applications/${id}`)).status).toBe(404);

    let res = await set(officer.user.id, [districts.THA, districts.NAS]);
    expect(res.status).toBe(200);
    expect(envelope(IppOfficerDto).safeParse(res.body).success).toBe(true);
    expect(res.body.data.districts).toEqual([
      { id: districts.NAS, name: 'Nashik' },
      { id: districts.THA, name: 'Thane' },
    ]);
    expect((await get(officer, `/applications/${id}`)).body.data.canDecide).toBe(true);

    res = await set(officer.user.id, [districts.PUN, districts.THA]);
    expect((res.body.data.districts as { name: string }[]).map((d) => d.name)).toEqual(['Pune', 'Thane']);
    expect((await get(officer, `/applications/${id}`)).status).toBe(404);
    expect((await set(officer.user.id, [])).body.data.districts).toEqual([]);
    /* And back again: the same pair may be assigned anew. */
    expect((await set(officer.user.id, [districts.NAS])).body.data.districts).toHaveLength(1);
    expect((await set(officer.user.id, [districts.NAS])).status).toBe(200);

    const trail = await audits('ipp.officer.districts');
    expect(trail).toHaveLength(4);
    expect(trail[0]).toMatchObject({ actorUserId: admin.user.id, resource: 'user', resourceId: officer.user.id, details: { removed: [] } });
    expect(trail[1].details).toEqual({ added: [districts.PUN], removed: [districts.NAS] });
  });

  it('two changes of one officer at once: the last one stands, no duplicate rows', async () => {
    const officer = await divisionalOfficer([]);
    const answers = await Promise.all([
      set(officer.user.id, [districts.NAS, districts.PUN]),
      set(officer.user.id, [districts.NAS]),
      set(officer.user.id, [districts.PUN]),
    ]);
    expect(answers.map((r) => r.status)).toEqual([200, 200, 200]);
    const rows: { n: number }[] = await AppDataSource.query(
      `SELECT count(*)::int AS n FROM "user_districts" WHERE "userId" = $1 AND "isDelete" = false GROUP BY "districtId" HAVING count(*) > 1`,
      [officer.user.id],
    );
    expect(rows).toEqual([]);
  });

  it('refuses: unknown user 404, no officer 409, unknown or inactive district 422, malformed 422', async () => {
    expect((await set(randomUUID(), [])).status).toBe(404);
    for (const who of [coep, admin]) {
      const res = await set(who.user.id, [districts.PUN]);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('NOT_A_DIVISIONAL_OFFICER');
    }
    const unknown = randomUUID();
    const res = await set(pune.user.id, [districts.PUN, unknown]);
    expect(res.status).toBe(422);
    expect(res.body.error.details).toEqual([{ field: 'body.districtIds', message: expect.stringContaining(unknown) }]);
    await AppDataSource.query(`UPDATE "districts" SET "isActive" = false WHERE "id" = $1`, [districts.THA]);
    expect((await set(pune.user.id, [districts.THA])).status).toBe(422);
    await AppDataSource.query(`UPDATE "districts" SET "isActive" = true WHERE "id" = $1`, [districts.THA]);
    for (const ids of [undefined, 'x', ['x'], [districts.PUN, districts.PUN], Array.from({ length: 201 }, () => randomUUID())])
      expect((await set(pune.user.id, ids)).status).toBe(422);
    expect((await get(pune, '/summary')).body.data.districts).toEqual([{ id: districts.PUN, name: 'Pune' }]);
  });

  it('keeps a district the officer has, even when it is inactive now; a new one must be active', async () => {
    const off = (active: boolean) => AppDataSource.query(`UPDATE "districts" SET "isActive" = $2 WHERE "id" = $1`, [districts.THA, active]);
    const officer = await divisionalOfficer([districts.THA]);
    const other = await divisionalOfficer([]);
    await off(false);
    try {
      const res = await set(officer.user.id, [districts.THA, districts.NAS]);
      expect(res.status).toBe(200);
      expect((res.body.data.districts as { name: string }[]).map((d) => d.name)).toEqual(['Nashik', 'Thane']);
      expect((await audits('ipp.officer.districts'))[0].details).toEqual({ added: [districts.NAS], removed: [] });
      /* Not for somebody who does not have it, and not again once it was taken away. */
      expect((await set(other.user.id, [districts.THA])).status).toBe(422);
      expect((await set(officer.user.id, [districts.NAS])).status).toBe(200);
      expect((await set(officer.user.id, [districts.NAS, districts.THA])).status).toBe(422);
      expect((await get(officer, '/summary')).body.data.districts).toEqual([{ id: districts.NAS, name: 'Nashik' }]);
    } finally {
      await off(true);
    }
  });

  it('view and update are two rights', async () => {
    const reader = await actorWith(['ipp-officers.view']);
    expect((await get(reader, '/officers')).status).toBe(200);
    /* The page needs the districts, not the forms. */
    expect((await get(reader, '/districts')).status).toBe(200);
    expect((await get(reader, '/applications')).status).toBe(403);
    expect((await set(pune.user.id, [], reader)).status).toBe(403);
    const editor = await actorWith(['ipp-officers.update']);
    expect((await get(editor, '/officers')).status).toBe(403);
    expect((await set(pune.user.id, [districts.PUN], editor)).status).toBe(200);
  });

  it('names the districts with forms waiting and no active officer', async () => {
    const assign = (userId: string, districtId: string) =>
      AppDataSource.query(`INSERT INTO "user_districts" ("userId", "districtId") VALUES ($1, $2)`, [userId, districtId]);
    const unassignAll = () =>
      AppDataSource.query(`UPDATE "user_districts" SET "isDelete" = true, "isActive" = false WHERE "isDelete" = false`);
    await unassignAll();
    await assign(pune.user.id, districts.PUN);
    const [inPune] = await submit(app, wireBatch(), [wireApplication()]);
    await submit(app, wireBatch({ district: NASHIK }), [wireApplication(), wireApplication()]);
    expect((await officers()).withoutOfficer).toEqual([{ id: districts.NAS, name: 'Nashik', waiting: 2 }]);

    /* An inactive officer, or a Super Admin with the role, does not count; an active officer does. */
    const inactive = await createUser({ roleCodes: ['DIVISIONAL_OFFICER'], isActive: false });
    const boss = await createUser({ roleCodes: ['SUPER_ADMIN', 'DIVISIONAL_OFFICER'] });
    for (const u of [inactive, boss]) await assign(u.id, districts.NAS);
    expect((await officers()).withoutOfficer).toHaveLength(1);
    await divisionalOfficer([districts.NAS]);
    expect((await officers()).withoutOfficer).toEqual([]);

    /* Nothing waits where nothing is at DIVISION. */
    expect((await approve(pune, inPune)).status).toBe(200);
    await unassignAll();
    expect((await officers()).withoutOfficer).toEqual([{ id: districts.NAS, name: 'Nashik', waiting: 2 }]);
  });
});
