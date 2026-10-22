import type { Express } from 'express';
import { AppDataSource } from '../../../src/config/database.config';
import { API, actorWith, auth, request, setupTestApp, superAdmin, teardownTestApp, type TestActor } from '../../helpers/test-app';

/*
 * Academic Calendar and learning configuration (AMRUT_KALASH_03 L-05 / F-LMS-05) — /api/v1/lms/calendars.
 * Fixtures: a state, a district and training centres created through the CMS API; LMS entities through the
 * Entity Master API (centres A and B enabled for the main entity, C is not).
 */
const BASE = `${API}/lms/calendars`;
const MISSING_ID = '00000000-0000-4000-8000-000000000000';

let app: Express;
let admin: TestActor;
let viewer: TestActor;
let nobody: TestActor;
const centres: Record<string, string> = {};
let entityId: string;
let otherEntityId: string;
let inactiveEntityId: string;

interface CalendarBody {
  entityId?: string;
  centreId?: string | null;
  name?: string;
  validFrom?: string;
  validTo?: string;
  workingDays?: string[];
  holidays?: { date: string; name: string }[];
  isActive?: boolean;
  [k: string]: unknown;
}

const create = (body: CalendarBody, token = admin.token) => request(app).post(BASE).set(auth(token)).send(body);
const patch = (id: string, body: CalendarBody, token = admin.token) => request(app).patch(`${BASE}/${id}`).set(auth(token)).send(body);

async function makeCalendar(body: CalendarBody): Promise<{ id: string; name: string }> {
  const res = await create({ entityId, workingDays: ['MON', 'TUE', 'WED', 'THU', 'FRI'], ...body });
  if (res.status !== 201) throw new Error(`makeCalendar failed (${res.status}): ${JSON.stringify(res.body)}`);
  return res.body.data;
}

async function makeCentre(districtId: string, name: string): Promise<string> {
  const res = await request(app).post(`${API}/cms/training-centres`).set(auth(admin.token)).send({ districtId, name });
  if (res.status !== 201) throw new Error(`makeCentre(${name}) failed (${res.status}): ${JSON.stringify(res.body)}`);
  return res.body.data.id as string;
}

async function makeEntity(body: Record<string, unknown>): Promise<string> {
  const res = await request(app).post(`${API}/lms/entities`).set(auth(admin.token)).send({ defaultLanguage: 'en', ...body });
  if (res.status !== 201) throw new Error(`makeEntity failed (${res.status}): ${JSON.stringify(res.body)}`);
  return res.body.data.id as string;
}

const fields = (res: { body: { error: { details?: { field: string }[] } } }) => (res.body.error.details ?? []).map((d) => d.field);

const auditActions = async (resource: string, resourceId?: string): Promise<string[]> => {
  const rows: { action: string }[] = await AppDataSource.query(
    `SELECT "action" FROM "audit_logs" WHERE "resource" = $1 ${resourceId ? 'AND "resourceId" = $2' : ''} ORDER BY "createdAt", "id"`,
    resourceId ? [resource, resourceId] : [resource],
  );
  return rows.map((r) => r.action);
};

beforeAll(async () => {
  app = await setupTestApp();
  admin = await superAdmin();
  viewer = await actorWith(['lms-calendars.view']);
  nobody = await actorWith(['lms-entities.view']);

  const state = await request(app).post(`${API}/cms/states`).set(auth(admin.token)).send({ name: 'Maharashtra', code: 'MH' });
  const district = await request(app).post(`${API}/cms/districts`).set(auth(admin.token)).send({ stateId: state.body.data.id, name: 'Nashik', code: 'NAS' });
  const districtId = district.body.data.id as string;
  centres.a = await makeCentre(districtId, 'Alpha Centre');
  centres.b = await makeCentre(districtId, 'Bravo Centre');
  centres.c = await makeCentre(districtId, 'Charlie Centre');

  entityId = await makeEntity({ name: 'Amrut Kalash', code: 'AMK', centreIds: [centres.a, centres.b] });
  otherEntityId = await makeEntity({ name: 'Other Entity', code: 'OTH', centreIds: [centres.c] });
  inactiveEntityId = await makeEntity({ name: 'Dormant Entity', code: 'DOR', isActive: false });
});
afterAll(teardownTestApp);

describe('Academic calendar — create and read', () => {
  let calendarId: string;

  it('creates an entity-wide calendar with normalised values, sorted working days and its holidays', async () => {
    const res = await create({
      entityId,
      name: '  Academic   Year 2026  ',
      validFrom: '2026-01-01',
      validTo: '2026-12-31',
      workingDays: ['SAT', 'MON', 'WED'],
      holidays: [
        { date: '2026-08-15', name: ' Independence   Day ' },
        { date: '2026-01-26', name: 'Republic Day' },
      ],
    });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      name: 'Academic Year 2026',
      entityId,
      entity: { id: entityId, name: 'Amrut Kalash', code: 'AMK', isActive: true },
      centreId: null,
      centre: null,
      type: 'ENTITY',
      validFrom: '2026-01-01',
      validTo: '2026-12-31',
      workingDays: ['MON', 'WED', 'SAT'],
      holidayCount: 2,
      isActive: true,
    });
    /* Holidays by date. */
    expect(res.body.data.holidays.map((h: { date: string; name: string }) => [h.date, h.name])).toEqual([
      ['2026-01-26', 'Republic Day'],
      ['2026-08-15', 'Independence Day'],
    ]);
    calendarId = res.body.data.id;

    expect(await auditActions('lms-calendar', calendarId)).toEqual(['lms.calendar.create']);
    expect(await auditActions('lms-calendar-holiday')).toEqual(['lms.calendar.day.create', 'lms.calendar.day.create']);
  });

  it('creates a centre exception calendar for an enabled centre, even over the entity-wide period', async () => {
    const res = await create({
      entityId,
      centreId: centres.a,
      name: 'Alpha Exceptions 2026',
      validFrom: '2026-03-01',
      validTo: '2026-03-31',
      workingDays: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'],
    });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      type: 'CENTRE',
      centreId: centres.a,
      centre: { id: centres.a, name: 'Alpha Centre', isActive: true },
      holidayCount: 0,
      holidays: [],
    });
  });

  it('refuses invalid fields with 422 and the field name', async () => {
    const valid = { entityId, name: 'Valid Calendar', validFrom: '2030-01-01', validTo: '2030-06-30', workingDays: ['MON'] };
    const bad = async (body: CalendarBody, field: string) => {
      const res = await create({ ...valid, ...body });
      expect(res.status).toBe(422);
      expect(fields(res)).toContain(field);
    };
    await bad({ name: 'Ab' }, 'body.name');
    await bad({ name: 'x'.repeat(81) }, 'body.name');
    await bad({ workingDays: [] }, 'body.workingDays');
    await bad({ workingDays: ['MON', 'MON'] }, 'body.workingDays');
    await bad({ workingDays: ['MONDAY'] }, 'body.workingDays.0');
    await bad({ validFrom: '2030-02-30' }, 'body.validFrom');
    await bad({ validTo: '2030-01-01' }, 'body.validTo');
    await bad({ validTo: '2029-12-31' }, 'body.validTo');
    await bad({ holidays: [{ date: '2030-01-05', name: 'A' }] }, 'body.holidays.0.name');
    await bad({ holidays: [{ date: '2030-01-05', name: 'One' }, { date: '2030-01-05', name: 'Two' }] }, 'body.holidays.1.date');
    await bad({ entityId: 'nope' }, 'body.entityId');
    await bad({ status: 'ACTIVE' }, 'body');

    const missing = await create({ entityId, name: 'No Days', validFrom: '2030-01-01', validTo: '2030-02-01' });
    expect(missing.status).toBe(422);
    expect(missing.body.error.details).toEqual(expect.arrayContaining([{ field: 'body.workingDays', message: 'Select at least one working day.' }]));
  });

  it('refuses a holiday outside the calendar period (400 with the row)', async () => {
    const res = await create({
      entityId,
      name: 'Short Term',
      validFrom: '2031-01-01',
      validTo: '2031-03-31',
      workingDays: ['MON'],
      holidays: [{ date: '2031-02-01', name: 'Inside' }, { date: '2031-04-01', name: 'Outside' }],
    });
    expect(res.status).toBe(400);
    expect(fields(res)).toEqual(['holidays.1.date']);
  });

  it('checks the entity and the centre (unknown / inactive entity, centre not enabled for the entity)', async () => {
    const base = { name: 'Guarded', validFrom: '2032-01-01', validTo: '2032-12-31', workingDays: ['MON'] };
    const unknown = await create({ ...base, entityId: MISSING_ID });
    expect(unknown.status).toBe(400);
    expect(fields(unknown)).toEqual(['entityId']);

    const inactive = await create({ ...base, entityId: inactiveEntityId });
    expect(inactive.status).toBe(400);
    expect(inactive.body.message).toBe('The selected entity is inactive');

    const notEnabled = await create({ ...base, entityId, centreId: centres.c });
    expect(notEnabled.status).toBe(400);
    expect(notEnabled.body.error.details).toEqual([{ field: 'centreId', message: 'Choose a centre enabled for the entity' }]);
  });

  it('keeps the name unique in the entity (case-insensitive) but not across entities', async () => {
    const dup = await create({ entityId, name: 'ACADEMIC YEAR 2026', validFrom: '2033-01-01', validTo: '2033-12-31', workingDays: ['MON'] });
    expect(dup.status).toBe(409);
    expect(dup.body.error.details).toEqual([{ field: 'name', message: 'This name is already used in the entity.' }]);

    const other = await create({ entityId: otherEntityId, name: 'Academic Year 2026', validFrom: '2026-01-01', validTo: '2026-12-31', workingDays: ['MON'] });
    expect(other.status).toBe(201);
  });

  it('refuses overlapping periods for the same entity and centre (409), allows adjacent ones and other centres', async () => {
    const overlap = await create({ entityId, name: 'Overlap', validFrom: '2026-12-31', validTo: '2027-06-30', workingDays: ['MON'] });
    expect(overlap.status).toBe(409);
    expect(overlap.body.error.details).toEqual([{ field: 'validFrom', message: 'The period overlaps another calendar.' }]);
    expect(overlap.body.message).toContain('Academic Year 2026');

    const adjacent = await create({ entityId, name: 'Academic Year 2027', validFrom: '2027-01-01', validTo: '2027-12-31', workingDays: ['MON'] });
    expect(adjacent.status).toBe(201);

    const sameCentre = await create({ entityId, centreId: centres.a, name: 'Alpha Overlap', validFrom: '2026-03-31', validTo: '2026-04-30', workingDays: ['MON'] });
    expect(sameCentre.status).toBe(409);

    const otherCentre = await create({ entityId, centreId: centres.b, name: 'Bravo Exceptions 2026', validFrom: '2026-03-01', validTo: '2026-03-31', workingDays: ['MON'] });
    expect(otherCentre.status).toBe(201);
  });

  it('gets one calendar with its holidays, and 404 for an unknown id', async () => {
    const res = await request(app).get(`${BASE}/${calendarId}`).set(auth(viewer.token));
    expect(res.status).toBe(200);
    expect(res.body.data.holidays).toHaveLength(2);
    expect((await request(app).get(`${BASE}/${MISSING_ID}`).set(auth(admin.token))).status).toBe(404);
    expect((await request(app).get(`${BASE}/not-a-uuid`).set(auth(admin.token))).status).toBe(422);
  });
});

describe('Academic calendar — list, filters and options', () => {
  it('lists with search, entity / centre / type / year filters, sorting and pagination', async () => {
    const list = (qs: string) => request(app).get(`${BASE}?${qs}`).set(auth(viewer.token));

    const all = await list(`entityId=${entityId}`);
    expect(all.status).toBe(200);
    expect(all.body.data.map((c: { name: string }) => c.name)).toEqual([
      'Academic Year 2026', 'Academic Year 2027', 'Alpha Exceptions 2026', 'Bravo Exceptions 2026',
    ]);
    expect(all.body.data[0]).toMatchObject({ holidayCount: 2, type: 'ENTITY' });
    expect(all.body.data[0].holidays).toBeUndefined();

    expect((await list(`entityId=${entityId}&type=CENTRE`)).body.data).toHaveLength(2);
    expect((await list(`entityId=${entityId}&type=ENTITY`)).body.data).toHaveLength(2);
    expect((await list(`centreId=${centres.b}`)).body.data.map((c: { name: string }) => c.name)).toEqual(['Bravo Exceptions 2026']);
    expect((await list(`entityId=${entityId}&year=2027`)).body.data.map((c: { name: string }) => c.name)).toEqual(['Academic Year 2027']);
    expect((await list('search=alpha')).body.data.map((c: { name: string }) => c.name)).toEqual(['Alpha Exceptions 2026']);

    const sorted = await list(`entityId=${entityId}&sortBy=validTo&sortOrder=desc&limit=1&page=2`);
    expect(sorted.body.data.map((c: { name: string }) => c.name)).toEqual(['Academic Year 2026']);
    expect(sorted.body.meta).toEqual({ page: 2, limit: 1, total: 4, totalPages: 4 });

    expect((await list('type=OTHER')).status).toBe(422);
    expect((await list('sortBy=centreId')).status).toBe(422);
  });

  it('serves the dropdown feed (active calendars of an entity, plus the centre\'s exceptions) and the form options', async () => {
    const opts = await request(app).get(`${BASE}/options?entityId=${entityId}&centreId=${centres.a}`).set(auth(viewer.token));
    expect(opts.status).toBe(200);
    expect(opts.body.data.map((c: { name: string }) => c.name)).toEqual(['Academic Year 2026', 'Alpha Exceptions 2026', 'Academic Year 2027']);
    expect((await request(app).get(`${BASE}/options`).set(auth(viewer.token))).status).toBe(422);

    const form = await request(app).get(`${BASE}/form-options`).set(auth(viewer.token));
    expect(form.status).toBe(200);
    expect(form.body.data.weekdays.map((d: { code: string }) => d.code)).toEqual(['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']);
    expect(form.body.data.types).toEqual(['ENTITY', 'CENTRE']);
  });
});

describe('Academic calendar — update, status, delete and restore', () => {
  let id: string;

  beforeAll(async () => {
    ({ id } = await makeCalendar({
      name: 'Term 2040',
      validFrom: '2040-01-01',
      validTo: '2040-06-30',
      holidays: [{ date: '2040-01-26', name: 'Republic Day' }, { date: '2040-03-01', name: 'Spring Break' }],
    }));
  });

  it('updates fields and replaces the holiday set (added, renamed, removed — each audited)', async () => {
    const res = await patch(id, {
      name: 'Term 2040 A',
      workingDays: ['FRI', 'MON'],
      holidays: [{ date: '2040-01-26', name: 'Republic Day Holiday' }, { date: '2040-05-01', name: 'Maharashtra Day' }],
    });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ name: 'Term 2040 A', workingDays: ['MON', 'FRI'], holidayCount: 2 });
    expect(res.body.data.holidays.map((h: { date: string; name: string }) => `${h.date} ${h.name}`)).toEqual([
      '2040-01-26 Republic Day Holiday',
      '2040-05-01 Maharashtra Day',
    ]);

    const rows: { action: string; details: { calendarId: string } }[] = await AppDataSource.query(
      `SELECT "action", "details" FROM "audit_logs" WHERE "resource" = 'lms-calendar-holiday' AND "details"->>'calendarId' = $1 ORDER BY "createdAt", "id"`,
      [id],
    );
    /* One transaction shares one timestamp, so compare as a set. */
    expect(rows.map((r) => r.action).sort()).toEqual([
      'lms.calendar.day.create', 'lms.calendar.day.create', 'lms.calendar.day.create', 'lms.calendar.day.delete', 'lms.calendar.day.update',
    ]);
    const update: { details: { fields: string[]; before: { name: string } } }[] = await AppDataSource.query(
      `SELECT "details" FROM "audit_logs" WHERE "resource" = 'lms-calendar' AND "resourceId" = $1 AND "action" = 'lms.calendar.update'`,
      [id],
    );
    expect(update[0].details.fields).toEqual(['name', 'workingDays']);
    expect(update[0].details.before.name).toBe('Term 2040');

    /* A removed date can be added again (the unique index covers non-deleted rows only). */
    const again = await patch(id, { holidays: [{ date: '2040-01-26', name: 'Republic Day Holiday' }, { date: '2040-03-01', name: 'Spring Break' }] });
    expect(again.status).toBe(200);
    expect(again.body.data.holidays.map((h: { date: string }) => h.date)).toEqual(['2040-01-26', '2040-03-01']);
  });

  it('validates the period against the stored values, the holidays and the other calendars', async () => {
    const reversed = await patch(id, { validTo: '2039-12-31' });
    expect(reversed.status).toBe(400);
    expect(reversed.body.error.details).toEqual([{ field: 'validTo', message: 'The end date must be after the start date.' }]);

    const leavesHoliday = await patch(id, { validFrom: '2040-02-01' });
    expect(leavesHoliday.status).toBe(400);
    expect(fields(leavesHoliday)).toEqual(['validFrom']);
    expect(leavesHoliday.body.error.details[0].message).toContain('2040-01-26');

    /* Moving the period and its holidays together is fine. */
    const moved = await patch(id, { validFrom: '2040-02-01', holidays: [{ date: '2040-03-01', name: 'Spring Break' }] });
    expect(moved.status).toBe(200);
    expect(moved.body.data).toMatchObject({ validFrom: '2040-02-01', holidayCount: 1 });

    const holidayOutside = await patch(id, { holidays: [{ date: '2041-01-01', name: 'Too Late' }] });
    expect(holidayOutside.status).toBe(400);
    expect(fields(holidayOutside)).toEqual(['holidays.0.date']);

    await makeCalendar({ name: 'Term 2040 B', validFrom: '2040-07-01', validTo: '2040-12-31' });
    const overlap = await patch(id, { validTo: '2040-07-01' });
    expect(overlap.status).toBe(409);

    const notEnabled = await patch(id, { centreId: centres.c });
    expect(notEnabled.status).toBe(400);
    expect(fields(notEnabled)).toEqual(['centreId']);

    const toCentre = await patch(id, { centreId: centres.b });
    expect(toCentre.status).toBe(200);
    expect(toCentre.body.data).toMatchObject({ type: 'CENTRE', centreId: centres.b });
    const back = await patch(id, { centreId: null });
    expect(back.body.data).toMatchObject({ type: 'ENTITY', centreId: null });

    expect((await patch(id, { entityId: otherEntityId })).status).toBe(422);
    expect((await patch(id, {})).status).toBe(422);
    expect((await patch(MISSING_ID, { name: 'Ghost Calendar' })).status).toBe(404);
  });

  it('activates and deactivates through the status endpoint', async () => {
    const off = await request(app).patch(`${BASE}/${id}/status`).set(auth(admin.token)).send({ isActive: false });
    expect(off.status).toBe(200);
    expect(off.body.data.isActive).toBe(false);
    const opts = await request(app).get(`${BASE}/options?entityId=${entityId}`).set(auth(admin.token));
    expect(opts.body.data.map((c: { id: string }) => c.id)).not.toContain(id);
    const on = await request(app).patch(`${BASE}/${id}/status`).set(auth(admin.token)).send({ isActive: true });
    expect(on.body.data.isActive).toBe(true);
    expect(await auditActions('lms-calendar', id)).toEqual(expect.arrayContaining(['lms.calendar.status']));
  });

  it('blocks deleting an entity that has calendars (ENTITY_REFERENCES)', async () => {
    const res = await request(app).delete(`${API}/lms/entities/${otherEntityId}`).set(auth(admin.token));
    expect(res.status).toBe(409);
    expect(res.body.message).toContain('1 calendar');
  });

  it('soft-deletes and restores (inactive), refusing a restore whose name or period is taken meanwhile', async () => {
    const del = await request(app).delete(`${BASE}/${id}`).set(auth(admin.token));
    expect(del.status).toBe(200);
    expect((await request(app).get(`${BASE}/${id}`).set(auth(admin.token))).status).toBe(404);
    expect((await request(app).delete(`${BASE}/${id}`).set(auth(admin.token))).status).toBe(404);

    /* The period is free again: a new calendar takes it. */
    const taker = await makeCalendar({ name: 'Term 2040 A', validFrom: '2040-02-01', validTo: '2040-06-30' });
    const blocked = await request(app).post(`${BASE}/${id}/restore`).set(auth(admin.token));
    expect(blocked.status).toBe(409);

    await request(app).delete(`${BASE}/${taker.id}`).set(auth(admin.token));
    const restored = await request(app).post(`${BASE}/${id}/restore`).set(auth(admin.token));
    expect(restored.status).toBe(200);
    expect(restored.body.data).toMatchObject({ isActive: false, holidayCount: 1 });
    expect((await request(app).post(`${BASE}/${id}/restore`).set(auth(admin.token))).status).toBe(409);
    expect(await auditActions('lms-calendar', id)).toEqual(expect.arrayContaining(['lms.calendar.delete', 'lms.calendar.restore']));
  });

  it('keeps a centre enabled for the entity while a calendar of the entity uses it (F-LMS-05-03)', async () => {
    const guarded = await makeEntity({ name: 'Centre Guard Entity', code: 'CGE', centreIds: [centres.a, centres.b] });
    const entityUrl = `${API}/lms/entities/${guarded}`;
    const enabled = async () =>
      ((await request(app).get(entityUrl).set(auth(admin.token))).body.data.enabledCentres as { id: string }[]).map((c) => c.id).sort();
    const calendar = await makeCalendar({ entityId: guarded, centreId: centres.a, name: 'Guarded Alpha 2045', validFrom: '2045-01-01', validTo: '2045-12-31' });

    const refused = await request(app).patch(entityUrl).set(auth(admin.token)).send({ centreIds: [centres.b], description: 'Not saved' });
    expect(refused.status).toBe(409);
    expect(refused.body.message).toContain('1 calendar');
    expect(refused.body.message).toContain('Alpha Centre');
    expect(fields(refused)).toEqual(['centreIds']);
    expect(await enabled()).toEqual([centres.a, centres.b].sort());

    /* Once the calendar is deleted the centre can go (the main entity's Alpha calendar is another entity's). */
    expect((await request(app).delete(`${BASE}/${calendar.id}`).set(auth(admin.token))).status).toBe(200);
    expect((await request(app).patch(entityUrl).set(auth(admin.token)).send({ centreIds: [centres.b] })).status).toBe(200);
    expect(await enabled()).toEqual([centres.b]);

    /* …and the deleted calendar cannot come back for a centre the entity no longer enables. */
    const restore = await request(app).post(`${BASE}/${calendar.id}/restore`).set(auth(admin.token));
    expect(restore.status).toBe(400);
    expect(fields(restore)).toEqual(['centreId']);
  });

  it('lists only the deleted calendars with deleted=true (same search, filters and paging, view permission); a restore moves one back', async () => {
    const owner = await makeEntity({ name: 'Recycle Entity', code: 'RCY' });
    const gone = await makeCalendar({ entityId: owner, name: 'Binned Term 2060', validFrom: '2060-01-01', validTo: '2060-06-30' });
    await makeCalendar({ entityId: owner, name: 'Kept Term 2060', validFrom: '2060-07-01', validTo: '2060-12-31' });
    await request(app).delete(`${BASE}/${gone.id}`).set(auth(admin.token)).expect(200);
    const list = (qs: string) => request(app).get(`${BASE}?entityId=${owner}&${qs}`).set(auth(viewer.token));
    const names = (res: { body: { data: { name: string }[] } }) => res.body.data.map((c) => c.name);

    const deleted = await list('deleted=true');
    expect(deleted.status).toBe(200);
    expect(names(deleted)).toEqual(['Binned Term 2060']);
    expect(deleted.body.data[0]).toMatchObject({ id: gone.id, isActive: false });
    expect(deleted.body.meta).toMatchObject({ total: 1 });
    expect(names(await list(''))).toEqual(['Kept Term 2060']);
    expect(names(await list('deleted=false'))).toEqual(['Kept Term 2060']);
    expect(names(await list('deleted=true&year=2060&type=ENTITY&search=binned'))).toEqual(['Binned Term 2060']);
    expect(names(await list('deleted=true&search=kept'))).toEqual([]);
    expect(names(await list('deleted=true&type=CENTRE'))).toEqual([]);
    expect((await list('deleted=true&limit=1&page=2')).body.meta).toEqual({ page: 2, limit: 1, total: 1, totalPages: 1 });
    expect((await list('deleted=yes')).status).toBe(422);

    expect((await request(app).post(`${BASE}/${gone.id}/restore`).set(auth(admin.token))).status).toBe(200);
    expect(names(await list('deleted=true'))).toEqual([]);
    expect(names(await list(''))).toEqual(['Binned Term 2060', 'Kept Term 2060']);
  });
});

describe('Academic calendar — permissions', () => {
  it('requires lms-calendars.* for every route', async () => {
    const body = { entityId, name: 'Forbidden', validFrom: '2050-01-01', validTo: '2050-12-31', workingDays: ['MON'] };
    expect((await request(app).get(BASE).set(auth(nobody.token))).status).toBe(403);
    expect((await request(app).get(`${BASE}/options?entityId=${entityId}`).set(auth(nobody.token))).status).toBe(403);
    expect((await request(app).get(`${BASE}/learning-config?entityId=${entityId}`).set(auth(nobody.token))).status).toBe(403);
    expect((await create(body, viewer.token)).status).toBe(403);
    expect((await patch(MISSING_ID, { name: 'Nope Calendar' }, viewer.token)).status).toBe(403);
    expect((await request(app).delete(`${BASE}/${MISSING_ID}`).set(auth(viewer.token))).status).toBe(403);
    expect((await request(app).post(`${BASE}/${MISSING_ID}/restore`).set(auth(viewer.token))).status).toBe(403);
    expect((await request(app).get(BASE)).status).toBe(401);

    const creator = await actorWith(['lms-calendars.create']);
    expect((await create(body, creator.token)).status).toBe(201);
  });
});

describe('Learning configuration', () => {
  const URL = `${BASE}/learning-config`;
  const get = (token = admin.token, entity = entityId) => request(app).get(`${URL}?entityId=${entity}`).set(auth(token));
  const put = (key: string, body: Record<string, unknown>, token = admin.token) =>
    request(app).put(`${URL}/${key}`).set(auth(token)).send({ entityId, reason: 'Approved by the programme office', ...body });
  const find = (keys: { key: string; mode: string | null }[], key: string, mode: string | null = null) =>
    keys.find((k) => k.key === key && k.mode === mode);
  /* config.learning.view (L-05): the learning configuration has codes of its own, apart from the calendar's. */
  let configViewer: TestActor;
  beforeAll(async () => {
    configViewer = await actorWith(['lms-learning-config.view']);
  });

  it('shows the syllabus values with their source and every prescribed key as To Be Confirmed', async () => {
    const res = await get(configViewer.token);
    expect(res.status).toBe(200);
    const keys = res.body.data.keys;
    expect(find(keys, 'core_hours.module_3')).toMatchObject({
      kind: 'SYLLABUS', value: 300, valueSource: 'SYLLABUS', toBeConfirmed: false, unit: 'hours', openQuestions: ['OQ-012'],
      sourceNote: 'Final syllabus document, pending approval by the competent authority',
    });
    expect(find(keys, 'oft_hours.module_4')).toMatchObject({ type: 'range', value: { min: 56, max: 64 } });
    expect(find(keys, 'session_length')).toMatchObject({ value: 2, unit: 'hours' });
    expect(find(keys, 'competency_bands')).toMatchObject({ value: ['Beginning', 'Developing', 'Competent', 'Proficient', 'Strong'] });

    /* No threshold, limit or rule has a value nobody entered (L-05 acceptance criteria). */
    const prescribed = keys.filter((k: { kind: string }) => k.kind === 'PRESCRIBED');
    expect(prescribed.length).toBeGreaterThan(0);
    for (const k of prescribed) expect(k).toMatchObject({ value: null, valueSource: null, toBeConfirmed: true });
    expect(find(keys, 'attendance.requirement')).toMatchObject({ type: 'percentage', openQuestions: ['OQ-014'] });
    /* Mode-specific keys: one entry per delivery mode. */
    expect(find(keys, 'attendance.capture_method', 'OFFLINE')).toBeDefined();
    expect(find(keys, 'attendance.capture_method', 'ONLINE')).toBeDefined();
    expect(find(keys, 'attendance.capture_method', null)).toBeUndefined();

    expect((await get(admin.token, MISSING_ID)).status).toBe(400);
    expect((await request(app).get(URL).set(auth(admin.token))).status).toBe(422);
  });

  it('changes a syllabus key with a reason, keeps the history and audits before / after / reason', async () => {
    const res = await put('core_hours.module_1', { value: 64 });
    expect(res.status).toBe(200);
    expect(res.body.data.keys).toEqual([
      expect.objectContaining({ key: 'core_hours.module_1', value: 64, valueSource: 'CONFIGURED', syllabusValue: 60, reason: 'Approved by the programme office' }),
    ]);
    await put('core_hours.module_1', { value: 62, reason: 'Corrected' });
    const history: { value: number; isDelete: boolean }[] = await AppDataSource.query(
      `SELECT "value", "isDelete" FROM "lms_learning_config" WHERE "entityId" = $1 AND "key" = 'core_hours.module_1' ORDER BY "createdAt"`,
      [entityId],
    );
    expect(history).toEqual([{ value: 64, isDelete: true }, { value: 62, isDelete: false }]);

    const audit: { action: string; details: Record<string, unknown> }[] = await AppDataSource.query(
      `SELECT "action", "details" FROM "audit_logs" WHERE "resource" = 'lms-learning-config' ORDER BY "createdAt", "id"`,
    );
    expect(audit.map((a) => a.action)).toEqual(['lms.learning-config.update', 'lms.learning-config.update']);
    expect(audit[0].details).toMatchObject({ key: 'core_hours.module_1', mode: null, before: 60, after: 64, reason: 'Approved by the programme office' });
    expect(audit[1].details).toMatchObject({ before: 64, after: 62, reason: 'Corrected' });

    /* The same value again writes nothing. */
    await put('core_hours.module_1', { value: 62 });
    expect((await AppDataSource.query(`SELECT 1 FROM "audit_logs" WHERE "resource" = 'lms-learning-config'`)).length).toBe(2);
  });

  it('checks the value against the key type and range', async () => {
    const bad = async (key: string, value: unknown, extra: Record<string, unknown> = {}) => {
      const res = await put(key, { value, ...extra });
      expect(res.status).toBe(400);
      return res;
    };
    const range = await bad('oft_hours.module_1', { min: 50, max: 40 });
    expect(range.body.error.details).toEqual([{ field: 'value', message: 'The minimum cannot be greater than the maximum.' }]);
    await bad('oft_hours.module_1', { min: 40 });
    await bad('core_hours.module_2', 12.5);
    await bad('core_hours.module_2', '60');
    await bad('core_hours.module_2', null);
    await bad('attendance.requirement', 101);
    await bad('attendance.capture_method', 'biometric');
    await bad('attendance.counted_statuses', ['PRESENT', 'PRESENT']);
    await bad('attendance.counted_statuses', []);
    await bad('competency_bands', ['One', 'Two']);
    const mode = await bad('attendance.requirement', 75, { mode: 'ONLINE' });
    expect(fields(mode)).toEqual(['mode']);

    expect((await put('no.such_key', { value: 1 })).status).toBe(404);
    expect((await put('attendance.requirement', { value: 75, reason: '   ' })).status).toBe(422);
    const noValue = await request(app).put(`${URL}/attendance.requirement`).set(auth(admin.token)).send({ entityId, reason: 'x' });
    expect(noValue.status).toBe(422);
  });

  it('sets and clears prescribed keys, and keeps both delivery modes alike unless a mode is named', async () => {
    const set = await put('attendance.requirement', { value: 75 });
    expect(set.body.data.keys[0]).toMatchObject({ value: 75, toBeConfirmed: false, valueSource: 'CONFIGURED' });
    const cleared = await put('attendance.requirement', { value: null });
    expect(cleared.body.data.keys[0]).toMatchObject({ value: null, toBeConfirmed: true });

    const both = await put('attendance.counted_statuses', { value: ['LATE', 'PRESENT'] });
    expect(both.body.data.keys.map((k: { mode: string; value: string[] }) => [k.mode, k.value])).toEqual([
      ['OFFLINE', ['PRESENT', 'LATE']],
      ['ONLINE', ['PRESENT', 'LATE']],
    ]);
    const online = await put('attendance.counted_statuses', { value: ['PRESENT'], mode: 'ONLINE' });
    expect(online.body.data.keys.map((k: { mode: string; value: string[] }) => [k.mode, k.value])).toEqual([
      ['OFFLINE', ['PRESENT', 'LATE']],
      ['ONLINE', ['PRESENT']],
    ]);

    /* Per entity: the other entity still shows its own (unset) values. */
    const other = await get(admin.token, otherEntityId);
    expect(find(other.body.data.keys, 'core_hours.module_1')).toMatchObject({ value: 60, valueSource: 'SYLLABUS' });
  });

  it('needs lms-learning-config.update to change a key', async () => {
    expect((await put('attendance.requirement', { value: 80 }, configViewer.token)).status).toBe(403);
    const updater = await actorWith(['lms-learning-config.update']);
    expect((await put('attendance.requirement', { value: 80 }, updater.token)).status).toBe(200);
  });

  it('keeps the learning-configuration and calendar codes apart, both ways', async () => {
    const patchKey = (key: string, body: Record<string, unknown>, token: string) =>
      request(app).patch(`${URL}/${key}`).set(auth(token)).send({ entityId, reason: 'Set by the programme office', ...body });
    const calendarBody = { entityId, name: 'Separate Codes', validFrom: '2051-01-01', validTo: '2051-12-31', workingDays: ['MON'] };

    /* Only lms-learning-config.*: reads and changes the configuration, never a calendar. */
    const configOnly = await actorWith(['lms-learning-config.view', 'lms-learning-config.update']);
    expect((await get(configOnly.token)).status).toBe(200);
    expect((await put('attendance.requirement', { value: 85 }, configOnly.token)).status).toBe(200);
    expect((await patchKey('attendance.requirement', { value: 86 }, configOnly.token)).status).toBe(200);
    expect((await request(app).get(BASE).set(auth(configOnly.token))).status).toBe(403);
    expect((await request(app).get(`${BASE}/options?entityId=${entityId}`).set(auth(configOnly.token))).status).toBe(403);
    expect((await create(calendarBody, configOnly.token)).status).toBe(403);
    expect((await patch(MISSING_ID, { name: 'Config Only' }, configOnly.token)).status).toBe(403);
    /* The screen's entity picker stays open to it. */
    expect((await request(app).get(`${API}/lms/entities/options`).set(auth(configOnly.token))).status).toBe(200);

    /* Only lms-calendars.*: works with calendars, but neither reads nor changes the configuration. */
    const calendarOnly = await actorWith(['lms-calendars.view', 'lms-calendars.create', 'lms-calendars.update', 'lms-calendars.delete']);
    expect((await request(app).get(BASE).set(auth(calendarOnly.token))).status).toBe(200);
    expect((await create(calendarBody, calendarOnly.token)).status).toBe(201);
    expect((await get(calendarOnly.token)).status).toBe(403);
    expect((await put('attendance.requirement', { value: 90 }, calendarOnly.token)).status).toBe(403);
    expect((await patchKey('attendance.requirement', { value: 90 }, calendarOnly.token)).status).toBe(403);
    expect(find((await get()).body.data.keys, 'attendance.requirement')).toMatchObject({ value: 86 });
  });
});
