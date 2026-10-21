import type { Express } from 'express';
import type { EntityManager } from 'typeorm';
import { AppDataSource } from '../../../src/config/database.config';
import { assertCentreEnabled, assertTrackEnabled } from '../../../src/lms/entity/entity.refs';
import { ENTITY_REFERENCES } from '../../../src/lms/entity/entity.service';
import { AppError } from '../../../src/shared/errors/app-error';
import { API, actorWith, auth, request, setupTestApp, superAdmin, teardownTestApp, type TestActor } from '../../helpers/test-app';

/*
 * Entity Master (AMRUT_KALASH_03 L-03 / F-LMS-03) — /api/v1/lms/entities.
 * Fixtures: a state, a district and training centres created through the CMS API; the twelve technology
 * tracks come from the TechnologyTracks migration (kept on reset).
 */
const BASE = `${API}/lms/entities`;
const MISSING_ID = '00000000-0000-4000-8000-000000000000';

let app: Express;
let admin: TestActor;
let viewer: TestActor;
let nobody: TestActor;
let calendarViewer: TestActor;
let districtId: string;
const centres: Record<string, string> = {};
const tracks: Record<string, string> = {};

async function makeCentre(name: string): Promise<string> {
  const res = await request(app).post(`${API}/cms/training-centres`).set(auth(admin.token)).send({ districtId, name });
  if (res.status !== 201) throw new Error(`makeCentre(${name}) failed (${res.status}): ${JSON.stringify(res.body)}`);
  return res.body.data.id as string;
}

interface EntityBody {
  name?: string;
  code?: string;
  description?: string | null;
  defaultLanguage?: string;
  timeZone?: string;
  centreIds?: string[];
  trackIds?: string[];
  isActive?: boolean;
}

const create = (body: EntityBody, token = admin.token) => request(app).post(BASE).set(auth(token)).send(body);

async function makeEntity(body: EntityBody): Promise<{ id: string; code: string; name: string }> {
  const res = await create({ defaultLanguage: 'en', ...body });
  if (res.status !== 201) throw new Error(`makeEntity failed (${res.status}): ${JSON.stringify(res.body)}`);
  return res.body.data;
}

beforeAll(async () => {
  app = await setupTestApp();
  admin = await superAdmin();
  viewer = await actorWith(['lms-entities.view']);
  nobody = await actorWith(['lms-reference.view']);
  calendarViewer = await actorWith(['lms-calendars.view']);

  const state = await request(app).post(`${API}/cms/states`).set(auth(admin.token)).send({ name: 'Maharashtra', code: 'MH' });
  const district = await request(app).post(`${API}/cms/districts`).set(auth(admin.token)).send({ stateId: state.body.data.id, name: 'Nashik', code: 'NAS' });
  districtId = district.body.data.id;
  centres.a = await makeCentre('Alpha Centre');
  centres.b = await makeCentre('Bravo Centre');
  centres.c = await makeCentre('Charlie Centre');

  const rows: { id: string; code: string }[] = await AppDataSource.query(`SELECT "id", "code" FROM "technology_tracks" WHERE "isDelete" = false`);
  for (const r of rows) tracks[r.code] = r.id;
});
afterAll(teardownTestApp);

describe('Entity Master — create and read', () => {
  it('creates an entity with normalised values, defaults and the enabled centres / tracks resolved', async () => {
    const res = await create({
      name: '  Amrut   Kalash  ',
      code: 'amk-01',
      description: '  Operational boundary of the programme  ',
      defaultLanguage: 'mr',
      centreIds: [centres.b, centres.a],
      trackIds: [tracks.T03, tracks.T01],
    });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      name: 'Amrut Kalash',
      code: 'AMK-01',
      description: 'Operational boundary of the programme',
      defaultLanguage: 'mr',
      timeZone: 'Asia/Kolkata',
      isActive: true,
      related: { codeLocked: false, references: [] },
    });
    /* Centres A to Z, with the district; tracks in T01…T12 order. */
    expect(res.body.data.enabledCentres).toEqual([
      { id: centres.a, name: 'Alpha Centre', code: expect.any(String), districtName: 'Nashik', isActive: true },
      { id: centres.b, name: 'Bravo Centre', code: expect.any(String), districtName: 'Nashik', isActive: true },
    ]);
    expect(res.body.data.enabledTracks.map((t: { code: string }) => t.code)).toEqual(['T01', 'T03']);
    expect(res.body.data.enabledTracks[0]).toEqual({ id: tracks.T01, code: 'T01', name: 'Data Analytics & Business Intelligence', isActive: true });

    const audit: { action: string; actorUserId: string }[] = await AppDataSource.query(
      `SELECT "action", "actorUserId" FROM "audit_logs" WHERE "resource" = 'lms-entity' AND "resourceId" = $1`,
      [res.body.data.id],
    );
    expect(audit).toEqual([{ action: 'lms.entity.create', actorUserId: admin.user.id }]);
  });

  it('accepts an entity with no centre or track yet (≥ 1 is required only before a batch) and a chosen time zone', async () => {
    const res = await create({ name: 'Second Entity', code: 'SE2', defaultLanguage: 'en', timeZone: 'Europe/London', isActive: false });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ enabledCentres: [], enabledTracks: [], timeZone: 'Europe/London', isActive: false, description: null });
  });

  it('refuses invalid fields with 422 and the field name', async () => {
    const bad = async (body: EntityBody & Record<string, unknown>, field: string) => {
      const res = await create({ name: 'Valid Name', code: 'VALID', defaultLanguage: 'en', ...body });
      expect(res.status).toBe(422);
      expect(res.body.error.details.map((d: { field: string }) => d.field)).toContain(field);
    };
    await bad({ name: 'Ab' }, 'body.name');
    await bad({ name: 'x'.repeat(121) }, 'body.name');
    await bad({ code: 'A' }, 'body.code');
    await bad({ code: 'A'.repeat(21) }, 'body.code');
    await bad({ code: 'AB_C' }, 'body.code');
    await bad({ description: 'x'.repeat(501) }, 'body.description');
    await bad({ defaultLanguage: 'fr' }, 'body.defaultLanguage');
    await bad({ timeZone: 'Mars/Phobos' }, 'body.timeZone');
    await bad({ timeZone: '+05:30' }, 'body.timeZone');
    await bad({ timeZone: 'IST' }, 'body.timeZone');
    await bad({ centreIds: [centres.a, centres.a] }, 'body.centreIds');
    await bad({ trackIds: ['nope'] }, 'body.trackIds.0');
    await bad({ status: 'ACTIVE' }, 'body');

    const missing = await create({ code: 'NONAME' });
    expect(missing.status).toBe(422);
    const fields = missing.body.error.details.map((d: { field: string }) => d.field);
    expect(fields).toEqual(expect.arrayContaining(['body.name', 'body.defaultLanguage']));
  });

  it('enforces unique name (case-insensitive) and code, answering 409 with the field', async () => {
    const name = await create({ name: 'AMRUT KALASH', code: 'OTHER', defaultLanguage: 'en' });
    expect(name.status).toBe(409);
    expect(name.body.error.details).toEqual([{ field: 'name', message: 'This name is already used.' }]);

    const code = await create({ name: 'Another Entity', code: 'amk-01', defaultLanguage: 'en' });
    expect(code.status).toBe(409);
    expect(code.body.error.details).toEqual([{ field: 'code', message: 'This code is already used.' }]);
  });

  it('refuses an unknown or inactive centre / track with 400 and the field', async () => {
    const unknown = await create({ name: 'Ref Check', code: 'REF', defaultLanguage: 'en', centreIds: [MISSING_ID] });
    expect(unknown.status).toBe(400);
    expect(unknown.body.error.details[0]).toMatchObject({ field: 'centreIds' });

    const dormant = await makeCentre('Dormant Centre');
    await request(app).patch(`${API}/cms/training-centres/${dormant}/status`).set(auth(admin.token)).send({ isActive: false }).expect(200);
    const inactiveCentre = await create({ name: 'Ref Check', code: 'REF', defaultLanguage: 'en', centreIds: [dormant] });
    expect(inactiveCentre.status).toBe(400);
    expect(inactiveCentre.body.message).toMatch(/inactive/i);

    /* The tracks are Admin Panel data with no write API: toggled in SQL for this test only, then restored. */
    await AppDataSource.query(`UPDATE "technology_tracks" SET "isActive" = false WHERE "code" = 'T12'`);
    try {
      const inactiveTrack = await create({ name: 'Ref Check', code: 'REF', defaultLanguage: 'en', trackIds: [tracks.T12] });
      expect(inactiveTrack.status).toBe(400);
      expect(inactiveTrack.body.error.details[0]).toMatchObject({ field: 'trackIds' });
    } finally {
      await AppDataSource.query(`UPDATE "technology_tracks" SET "isActive" = true WHERE "code" = 'T12'`);
    }
  });

  it('returns 404 for an unknown id and 422 for a malformed one', async () => {
    expect((await request(app).get(`${BASE}/${MISSING_ID}`).set(auth(admin.token))).status).toBe(404);
    expect((await request(app).get(`${BASE}/not-a-uuid`).set(auth(admin.token))).status).toBe(422);
  });

  it('serves the form options: the To Be Confirmed language list and IANA time zones', async () => {
    const res = await request(app).get(`${BASE}/form-options`).set(auth(viewer.token));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      languages: [{ code: 'en', label: 'English' }, { code: 'mr', label: 'Marathi' }],
      languagesConfirmed: false,
      defaultTimeZone: 'Asia/Kolkata',
    });
    expect(res.body.data.timeZones).toContain('Asia/Kolkata');
    expect(res.body.data.timeZones).not.toContain('Asia/Calcutta');
    expect(res.body.data.timeZones).toContain('Europe/London');
  });
});

describe('Entity Master — update, selections and status', () => {
  it('updates fields, clears the description and replaces the centre / track selections', async () => {
    const e = await makeEntity({ name: 'Update Me', code: 'UPD', description: 'Old text', centreIds: [centres.a, centres.b], trackIds: [tracks.T01] });

    const res = await request(app)
      .patch(`${BASE}/${e.id}`)
      .set(auth(admin.token))
      .send({ name: 'Updated Entity', description: '', defaultLanguage: 'mr', timeZone: 'Asia/Dubai', centreIds: [centres.b, centres.c], trackIds: [] });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ name: 'Updated Entity', description: null, defaultLanguage: 'mr', timeZone: 'Asia/Dubai', enabledTracks: [] });
    expect(res.body.data.enabledCentres.map((c: { id: string }) => c.id)).toEqual([centres.b, centres.c]);

    /* The removed selection rows are soft-deleted, not erased; re-enabling inserts a new row. */
    const put = await request(app).put(`${BASE}/${e.id}`).set(auth(admin.token)).send({ centreIds: [centres.a, centres.b, centres.c] });
    expect(put.status).toBe(200);
    const rows: { centreId: string; isDelete: boolean }[] = await AppDataSource.query(
      `SELECT "centreId", "isDelete" FROM "lms_entity_centres" WHERE "entityId" = $1 ORDER BY "createdAt"`,
      [e.id],
    );
    expect(rows.filter((r) => r.centreId === centres.a).map((r) => r.isDelete)).toEqual([true, false]);
    expect(rows.filter((r) => !r.isDelete)).toHaveLength(3);

    const audit: { details: { fields: string[]; before: Record<string, unknown> } }[] = await AppDataSource.query(
      `SELECT "details" FROM "audit_logs" WHERE "action" = 'lms.entity.update' AND "resourceId" = $1 ORDER BY "createdAt" LIMIT 1`,
      [e.id],
    );
    expect(audit[0].details.fields).toEqual(expect.arrayContaining(['name', 'description', 'defaultLanguage', 'timeZone']));
    expect(audit[0].details.before).toMatchObject({ name: 'Update Me', description: 'Old text' });
  });

  it('keeps an enabled centre that the Admin Panel deactivated later, reporting it inactive, but refuses to add one', async () => {
    const later = await makeCentre('Later Dormant Centre');
    const e = await makeEntity({ name: 'Keeps Inactive', code: 'KEEP', centreIds: [later, centres.a] });
    await request(app).patch(`${API}/cms/training-centres/${later}/status`).set(auth(admin.token)).send({ isActive: false }).expect(200);

    const detail = await request(app).get(`${BASE}/${e.id}`).set(auth(admin.token));
    expect(detail.body.data.enabledCentres.find((c: { id: string }) => c.id === later)).toMatchObject({ isActive: false });

    /* Saving the same selection (the inactive centre kept) is allowed... */
    const keep = await request(app).patch(`${BASE}/${e.id}`).set(auth(admin.token)).send({ centreIds: [later, centres.a, centres.b] });
    expect(keep.status).toBe(200);
    /* ...removing it works, and adding it back is refused while it is inactive. */
    await request(app).patch(`${BASE}/${e.id}`).set(auth(admin.token)).send({ centreIds: [centres.a] }).expect(200);
    const readd = await request(app).patch(`${BASE}/${e.id}`).set(auth(admin.token)).send({ centreIds: [centres.a, later] });
    expect(readd.status).toBe(400);
    expect(readd.body.error.details[0]).toMatchObject({ field: 'centreIds' });
  });

  it('enforces one live selection row per (entity, centre) and (entity, track) in the database', async () => {
    const e = await makeEntity({ name: 'Pair Check', code: 'PAIR', centreIds: [centres.a], trackIds: [tracks.T02] });
    await expect(
      AppDataSource.query(`INSERT INTO "lms_entity_centres" ("entityId", "centreId") VALUES ($1, $2)`, [e.id, centres.a]),
    ).rejects.toThrow(/UQ_lms_entity_centres_pair_active/);
    await expect(
      AppDataSource.query(`INSERT INTO "lms_entity_tracks" ("entityId", "trackId") VALUES ($1, $2)`, [e.id, tracks.T02]),
    ).rejects.toThrow(/UQ_lms_entity_tracks_pair_active/);
  });

  it('refuses a rename onto another entity name, an empty update and an unknown id', async () => {
    const e = await makeEntity({ name: 'Rename Me', code: 'REN' });
    const clash = await request(app).patch(`${BASE}/${e.id}`).set(auth(admin.token)).send({ name: 'second entity' });
    expect(clash.status).toBe(409);
    expect(clash.body.error.details[0]).toMatchObject({ field: 'name' });
    expect((await request(app).patch(`${BASE}/${e.id}`).set(auth(admin.token)).send({})).status).toBe(422);
    expect((await request(app).patch(`${BASE}/${MISSING_ID}`).set(auth(admin.token)).send({ name: 'Ghost Entity' })).status).toBe(404);
    /* Changing only the case of its own name is not a clash. */
    expect((await request(app).patch(`${BASE}/${e.id}`).set(auth(admin.token)).send({ name: 'RENAME ME' })).status).toBe(200);
  });

  it('lets the code change until a course uses the entity, then freezes it and blocks delete (guard list)', async () => {
    const e = await makeEntity({ name: 'Code Lock', code: 'LOCK-1' });
    const changed = await request(app).patch(`${BASE}/${e.id}`).set(auth(admin.token)).send({ code: 'lock-2' });
    expect(changed.status).toBe(200);
    expect(changed.body.data.code).toBe('LOCK-2');

    /*
     * lms_courses is built by the Course master, which adds itself to ENTITY_REFERENCES with locksCode.
     * The rule is exercised here through that guard list with a stubbed count for this entity.
     */
    const stub = { one: 'course', locksCode: true, count: async (_m: unknown, id: string) => (id === e.id ? 2 : 0) };
    ENTITY_REFERENCES.push(stub);
    try {
      const detail = await request(app).get(`${BASE}/${e.id}`).set(auth(admin.token));
      expect(detail.body.data.related).toEqual({ codeLocked: true, references: [{ label: '2 courses', count: 2, locksCode: true }] });

      const locked = await request(app).patch(`${BASE}/${e.id}`).set(auth(admin.token)).send({ code: 'LOCK-3' });
      expect(locked.status).toBe(409);
      expect(locked.body.error.details).toEqual([{ field: 'code', message: 'The code cannot be changed.' }]);

      /* Sending the unchanged code with other fields is fine. */
      const same = await request(app).patch(`${BASE}/${e.id}`).set(auth(admin.token)).send({ code: 'LOCK-2', description: 'Still editable' });
      expect(same.status).toBe(200);

      const del = await request(app).delete(`${BASE}/${e.id}`).set(auth(admin.token));
      expect(del.status).toBe(409);
      expect(del.body.message).toMatch(/2 courses reference it/);
    } finally {
      ENTITY_REFERENCES.splice(ENTITY_REFERENCES.indexOf(stub), 1);
    }
  });

  it('activates and deactivates; an inactive entity leaves the options feed', async () => {
    const e = await makeEntity({ name: 'Zulu Toggle', code: 'TOG' });
    const off = await request(app).patch(`${BASE}/${e.id}/status`).set(auth(admin.token)).send({ isActive: false });
    expect(off.status).toBe(200);
    expect(off.body.data.isActive).toBe(false);
    expect(off.body.message).toBe('Entity deactivated');

    let options = await request(app).get(`${BASE}/options`).set(auth(calendarViewer.token));
    expect(options.status).toBe(200);
    expect(options.body.data.map((o: { id: string }) => o.id)).not.toContain(e.id);

    await request(app).patch(`${BASE}/${e.id}/status`).set(auth(admin.token)).send({ isActive: true }).expect(200);
    options = await request(app).get(`${BASE}/options`).set(auth(calendarViewer.token));
    expect(options.body.data).toContainEqual({ id: e.id, name: 'Zulu Toggle', code: 'TOG' });
    const names = options.body.data.map((o: { name: string }) => o.name);
    expect([...names].sort((a: string, b: string) => a.localeCompare(b))).toEqual(names);
    expect((await request(app).patch(`${BASE}/${e.id}/status`).set(auth(admin.token)).send({ isActive: 'no' })).status).toBe(422);
  });
});

describe('Entity Master — listing', () => {
  it('searches name and code, filters by status, centre and track, sorts and pages', async () => {
    const byName = await request(app).get(BASE).query({ search: 'amrut' }).set(auth(viewer.token));
    expect(byName.status).toBe(200);
    expect(byName.body.data.map((e: { code: string }) => e.code)).toEqual(['AMK-01']);
    expect(byName.body.data[0].enabledCentres).toHaveLength(2);

    const byCode = await request(app).get(BASE).query({ search: 'se2' }).set(auth(viewer.token));
    expect(byCode.body.data.map((e: { code: string }) => e.code)).toEqual(['SE2']);

    const inactive = await request(app).get(BASE).query({ isActive: 'false', limit: 100 }).set(auth(viewer.token));
    expect(inactive.body.data.every((e: { isActive: boolean }) => !e.isActive)).toBe(true);
    expect(inactive.body.data.map((e: { code: string }) => e.code)).toContain('SE2');

    const byCentre = await request(app).get(BASE).query({ centreId: centres.c, limit: 100 }).set(auth(viewer.token));
    expect(byCentre.body.data.length).toBeGreaterThan(0);
    expect(byCentre.body.data.every((e: { enabledCentres: { id: string }[] }) => e.enabledCentres.some((c) => c.id === centres.c))).toBe(true);

    const byTrack = await request(app).get(BASE).query({ trackId: tracks.T03, limit: 100 }).set(auth(viewer.token));
    expect(byTrack.body.data.map((e: { code: string }) => e.code)).toEqual(['AMK-01']);

    const sorted = await request(app).get(BASE).query({ sortBy: 'code', sortOrder: 'desc', limit: 100 }).set(auth(viewer.token));
    const codes = sorted.body.data.map((e: { code: string }) => e.code);
    expect([...codes].sort().reverse()).toEqual(codes);

    const paged = await request(app).get(BASE).query({ limit: 2, page: 2 }).set(auth(viewer.token));
    expect(paged.body.data).toHaveLength(2);
    expect(paged.body.meta).toMatchObject({ page: 2, limit: 2 });
    expect(paged.body.meta.total).toBeGreaterThanOrEqual(4);

    expect((await request(app).get(BASE).query({ sortBy: 'description' }).set(auth(viewer.token))).status).toBe(422);
    expect((await request(app).get(BASE).query({ limit: 101 }).set(auth(viewer.token))).status).toBe(422);
    const unknownCentre = await request(app).get(BASE).query({ centreId: MISSING_ID }).set(auth(viewer.token));
    expect(unknownCentre.status).toBe(400);
    expect(unknownCentre.body.error.details[0]).toMatchObject({ field: 'centreId' });
  });
});

describe('Entity Master — delete and restore', () => {
  it('soft-deletes, hides the entity, and restores it inactive', async () => {
    const e = await makeEntity({ name: 'Delete Me', code: 'DEL', centreIds: [centres.a], trackIds: [tracks.T05] });
    const del = await request(app).delete(`${BASE}/${e.id}`).set(auth(admin.token));
    expect(del.status).toBe(200);
    expect(del.body.data).toBeNull();
    expect((await request(app).get(`${BASE}/${e.id}`).set(auth(admin.token))).status).toBe(404);
    expect((await request(app).delete(`${BASE}/${e.id}`).set(auth(admin.token))).status).toBe(404);

    const list = await request(app).get(BASE).query({ search: 'Delete Me' }).set(auth(admin.token));
    expect(list.body.data).toHaveLength(0);

    const restored = await request(app).post(`${BASE}/${e.id}/restore`).set(auth(admin.token));
    expect(restored.status).toBe(200);
    expect(restored.body.data).toMatchObject({ isActive: false, code: 'DEL' });
    /* The selection survives the archive. */
    expect(restored.body.data.enabledCentres.map((c: { id: string }) => c.id)).toEqual([centres.a]);
    expect(restored.body.data.enabledTracks.map((t: { code: string }) => t.code)).toEqual(['T05']);

    expect((await request(app).post(`${BASE}/${e.id}/restore`).set(auth(admin.token))).status).toBe(409);
    expect((await request(app).post(`${BASE}/${MISSING_ID}/restore`).set(auth(admin.token))).status).toBe(404);
  });

  it('refuses to restore an entity whose code was taken meanwhile', async () => {
    const e = await makeEntity({ name: 'Old Holder', code: 'TAKEN' });
    await request(app).delete(`${BASE}/${e.id}`).set(auth(admin.token)).expect(200);
    await makeEntity({ name: 'New Holder', code: 'TAKEN' });
    const res = await request(app).post(`${BASE}/${e.id}/restore`).set(auth(admin.token));
    expect(res.status).toBe(409);
    expect(res.body.error.details[0]).toMatchObject({ field: 'code' });
  });

  it('lists only the deleted entities with deleted=true (same search, filters and paging, view permission); a restore moves one back', async () => {
    const gone = await makeEntity({ name: 'Recycle Gone', code: 'RCY-1', centreIds: [centres.b], trackIds: [tracks.T07] });
    await makeEntity({ name: 'Recycle Kept', code: 'RCY-2', centreIds: [centres.b] });
    await request(app).delete(`${BASE}/${gone.id}`).set(auth(admin.token)).expect(200);
    const list = (query: Record<string, string | number>) => request(app).get(BASE).query({ search: 'recycle', ...query }).set(auth(viewer.token));
    const codes = (res: { body: { data: { code: string }[] } }) => res.body.data.map((e) => e.code);

    const deleted = await list({ deleted: 'true' });
    expect(deleted.status).toBe(200);
    expect(codes(deleted)).toEqual(['RCY-1']);
    expect(deleted.body.data[0]).toMatchObject({ id: gone.id, isActive: false });
    /* The selection is kept with the archived entity. */
    expect(deleted.body.data[0].enabledTracks.map((t: { code: string }) => t.code)).toEqual(['T07']);
    expect(deleted.body.meta).toMatchObject({ total: 1 });
    expect(codes(await list({}))).toEqual(['RCY-2']);
    expect(codes(await list({ deleted: 'false' }))).toEqual(['RCY-2']);
    expect(codes(await list({ deleted: 'true', centreId: centres.b, trackId: tracks.T07 }))).toEqual(['RCY-1']);
    expect(codes(await list({ deleted: 'true', trackId: tracks.T01 }))).toEqual([]);
    expect(codes(await list({ deleted: 'true', search: 'kept' }))).toEqual([]);
    expect((await list({ deleted: 'true', limit: 1, page: 2 })).body.meta).toEqual({ page: 2, limit: 1, total: 1, totalPages: 1 });
    expect((await list({ deleted: 'yes' })).status).toBe(422);

    expect((await request(app).post(`${BASE}/${gone.id}/restore`).set(auth(admin.token))).status).toBe(200);
    expect(codes(await list({ deleted: 'true' }))).toEqual([]);
    expect(codes(await list({}))).toEqual(['RCY-1', 'RCY-2']);
  });
});

describe('Entity Master — permissions', () => {
  it('requires a session', async () => {
    expect((await request(app).get(BASE)).status).toBe(401);
    expect((await request(app).get(`${BASE}/options`)).status).toBe(401);
  });

  it('lets a viewer read but not write', async () => {
    const e = await makeEntity({ name: 'Permission Probe', code: 'PERM' });
    expect((await request(app).get(BASE).set(auth(viewer.token))).status).toBe(200);
    expect((await request(app).get(`${BASE}/${e.id}`).set(auth(viewer.token))).status).toBe(200);
    expect((await create({ name: 'Viewer Made', code: 'VIEW', defaultLanguage: 'en' }, viewer.token)).status).toBe(403);
    expect((await request(app).patch(`${BASE}/${e.id}`).set(auth(viewer.token)).send({ name: 'Viewer Edit' })).status).toBe(403);
    expect((await request(app).patch(`${BASE}/${e.id}/status`).set(auth(viewer.token)).send({ isActive: false })).status).toBe(403);
    expect((await request(app).delete(`${BASE}/${e.id}`).set(auth(viewer.token))).status).toBe(403);
    expect((await request(app).post(`${BASE}/${e.id}/restore`).set(auth(viewer.token))).status).toBe(403);
  });

  it('refuses every entity route to a user without an entity permission; the options feed follows the dependent masters', async () => {
    expect((await request(app).get(BASE).set(auth(nobody.token))).status).toBe(403);
    expect((await request(app).get(`${BASE}/options`).set(auth(nobody.token))).status).toBe(403);
    expect((await request(app).get(`${BASE}/form-options`).set(auth(nobody.token))).status).toBe(403);
    expect((await request(app).get(`${BASE}/options`).set(auth(calendarViewer.token))).status).toBe(200);
    expect((await request(app).get(BASE).set(auth(calendarViewer.token))).status).toBe(403);
    /* Learning Configuration picks its entity from the same feed (its own menu since L-05 config.learning.view). */
    const configViewer = await actorWith(['lms-learning-config.view']);
    expect((await request(app).get(`${BASE}/options`).set(auth(configViewer.token))).status).toBe(200);
    expect((await request(app).get(BASE).set(auth(configViewer.token))).status).toBe(403);
    expect((await request(app).get(`${BASE}/form-options`).set(auth(configViewer.token))).status).toBe(403);
  });

  it('a creator without update rights can create but not edit', async () => {
    const creator = await actorWith(['lms-entities.view', 'lms-entities.create']);
    const res = await create({ name: 'Creator Made', code: 'CRT', defaultLanguage: 'en' }, creator.token);
    expect(res.status).toBe(201);
    expect((await request(app).patch(`${BASE}/${res.body.data.id}`).set(auth(creator.token)).send({ name: 'Creator Edit' })).status).toBe(403);
  });
});

describe('entity.refs — checks the other LMS masters run', () => {
  it('passes for an enabled, active centre / track and answers 400 with the field otherwise', async () => {
    const e = await makeEntity({ name: 'Refs Helper', code: 'REFS', centreIds: [centres.a], trackIds: [tracks.T07] });
    const run = <T>(fn: (m: EntityManager) => Promise<T>) => AppDataSource.transaction(fn);

    await expect(run((m) => assertCentreEnabled(m, e.id, centres.a, 'centreId'))).resolves.toMatchObject({ id: centres.a });
    await expect(run((m) => assertTrackEnabled(m, e.id, tracks.T07, 'trackId'))).resolves.toMatchObject({ code: 'T07' });

    const notEnabled = await run((m) => assertCentreEnabled(m, e.id, centres.b, 'centreId')).catch((err: unknown) => err);
    expect(notEnabled).toBeInstanceOf(AppError);
    expect(notEnabled).toMatchObject({ statusCode: 400, details: [{ field: 'centreId', message: 'Choose a centre enabled for the entity' }] });

    const trackNotEnabled = await run((m) => assertTrackEnabled(m, e.id, tracks.T08, 'trackId')).catch((err: unknown) => err);
    expect(trackNotEnabled).toMatchObject({ statusCode: 400, details: [{ field: 'trackId' }] });

    /* Enabled, but deactivated in the Admin Panel afterwards. */
    await request(app).patch(`${API}/cms/training-centres/${centres.a}/status`).set(auth(admin.token)).send({ isActive: false }).expect(200);
    try {
      const inactive = await run((m) => assertCentreEnabled(m, e.id, centres.a, 'centreId')).catch((err: unknown) => err);
      expect(inactive).toMatchObject({ statusCode: 400, details: [{ field: 'centreId', message: 'Choose an active training centre' }] });
    } finally {
      await request(app).patch(`${API}/cms/training-centres/${centres.a}/status`).set(auth(admin.token)).send({ isActive: true }).expect(200);
    }

    /* A centre removed from the selection is no longer enabled. */
    await request(app).patch(`${BASE}/${e.id}`).set(auth(admin.token)).send({ centreIds: [] }).expect(200);
    const removed = await run((m) => assertCentreEnabled(m, e.id, centres.a, 'centreId')).catch((err: unknown) => err);
    expect(removed).toMatchObject({ statusCode: 400 });
  });
});
