import type { Express } from 'express';
import { AppDataSource } from '../../../src/config/database.config';
import { API, actorWith, auth, request, setupTestApp, superAdmin, teardownTestApp, type TestActor } from '../../helpers/test-app';

/*
 * Course Master (AMRUT_KALASH_03 L-06 / F-LMS-06) — /api/v1/lms/courses.
 * Fixtures: LMS entities created through the Entity Master API. PUBLISHED is set by a content release
 * (L-30), which is not built: the tests that need it set the status in SQL.
 */
const BASE = `${API}/lms/courses`;
const ENTITIES = `${API}/lms/entities`;
const MODULES = `${API}/lms/course-modules`;
const MISSING_ID = '00000000-0000-4000-8000-000000000000';
const RELEASE_ID = '11111111-1111-4111-8111-111111111111';

let app: Express;
let admin: TestActor;
let viewer: TestActor;
let nobody: TestActor;
let moduleViewer: TestActor;
let entityA: { id: string; code: string };
let entityB: { id: string; code: string };

interface CourseBody {
  entityId?: string;
  code?: string;
  title?: string;
  description?: string | null;
  languages?: string[];
  isActive?: boolean;
}

const create = (body: CourseBody & Record<string, unknown>, token = admin.token) => request(app).post(BASE).set(auth(token)).send(body);

async function makeCourse(body: CourseBody): Promise<{ id: string; code: string }> {
  const res = await create({ entityId: entityA.id, title: 'Course Title', ...body });
  if (res.status !== 201) throw new Error(`makeCourse failed (${res.status}): ${JSON.stringify(res.body)}`);
  return res.body.data;
}

async function makeEntity(name: string, code: string, defaultLanguage = 'en'): Promise<{ id: string; code: string }> {
  const res = await request(app).post(ENTITIES).set(auth(admin.token)).send({ name, code, defaultLanguage });
  if (res.status !== 201) throw new Error(`makeEntity failed (${res.status}): ${JSON.stringify(res.body)}`);
  return res.body.data;
}

/* Stands in for the content release (L-30, not built): the first published release sets PUBLISHED. */
const publish = (id: string) =>
  AppDataSource.query(`UPDATE "lms_courses" SET "status" = 'PUBLISHED', "publishedReleaseId" = $2, "publishedReleaseNo" = 1 WHERE "id" = $1`, [id, RELEASE_ID]);

beforeAll(async () => {
  app = await setupTestApp();
  admin = await superAdmin();
  viewer = await actorWith(['lms-courses.view']);
  nobody = await actorWith(['lms-entities.view']);
  moduleViewer = await actorWith(['lms-course-modules.view']);
  entityA = await makeEntity('Sarthi', 'AMK', 'mr');
  entityB = await makeEntity('Second Entity', 'SEC');
});
afterAll(teardownTestApp);

describe('Course Master — create and read', () => {
  it('creates a DRAFT course with normalised values, the entity default language and an empty module summary', async () => {
    const res = await create({ entityId: entityA.id, code: 'amk-course', title: '  SARTHI   Programme ', description: '  Four-module journey ' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      entityId: entityA.id,
      entity: { id: entityA.id, name: 'Sarthi', code: 'AMK' },
      code: 'AMK-COURSE',
      title: 'SARTHI Programme',
      description: 'Four-module journey',
      languages: ['mr'],
      status: 'DRAFT',
      publishedReleaseId: null,
      publishedReleaseNo: null,
      isActive: true,
      modules: [],
      missingModuleNumbers: [1, 2, 3, 4],
      hasAllModules: false,
      references: [],
    });

    const audit: { action: string; actorUserId: string }[] = await AppDataSource.query(
      `SELECT "action", "actorUserId" FROM "audit_logs" WHERE "resource" = 'lms-course' AND "resourceId" = $1`,
      [res.body.data.id],
    );
    expect(audit).toEqual([{ action: 'lms.course.create', actorUserId: admin.user.id }]);
  });

  it('accepts chosen languages and an inactive course', async () => {
    /* F-LMS-06-05: the languages must be enabled for the entity (Branding F-LMS-04-07). */
    await request(app).patch(`${API}/lms/branding/${entityB.id}`).set(auth(admin.token)).send({ languages: ['en', 'mr'] }).expect(200);
    const res = await create({ entityId: entityB.id, code: 'SEC-1', title: 'Second Course', languages: ['en', 'mr'], isActive: false });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ languages: ['en', 'mr'], isActive: false, description: null });
  });

  it('refuses invalid fields with 422 and the field name', async () => {
    const bad = async (body: CourseBody & Record<string, unknown>, field: string) => {
      const res = await create({ entityId: entityA.id, code: 'VALID', title: 'Valid Title', ...body });
      expect(res.status).toBe(422);
      expect(res.body.error.details.map((d: { field: string }) => d.field)).toContain(field);
    };
    await bad({ code: 'A' }, 'body.code');
    await bad({ code: 'A'.repeat(21) }, 'body.code');
    await bad({ code: 'AB_C' }, 'body.code');
    await bad({ title: 'Ab' }, 'body.title');
    await bad({ title: 'x'.repeat(121) }, 'body.title');
    await bad({ description: 'x'.repeat(2001) }, 'body.description');
    await bad({ description: 'Hello <script>alert(1)</script>' }, 'body.description');
    await bad({ description: '<a href="javascript:alert(1)">x</a>' }, 'body.description');
    await bad({ languages: [] }, 'body.languages');
    await bad({ languages: ['fr'] }, 'body.languages.0');
    await bad({ languages: ['en', 'en'] }, 'body.languages');
    await bad({ entityId: 'nope' }, 'body.entityId');
    await bad({ status: 'PUBLISHED' }, 'body');
    await bad({ publishedReleaseNo: 1 }, 'body');

    const missing = await create({ code: 'NOTHING' });
    expect(missing.status).toBe(422);
    expect(missing.body.error.details.map((d: { field: string }) => d.field)).toEqual(expect.arrayContaining(['body.entityId', 'body.title']));
  });

  /* F-LMS-06-04 "sanitised; no scripts": an allow-list of editor markup, not a pattern of known attacks. */
  it('keeps the description to allow-listed rich text: other markup and non-https links are refused, plain prose is not', async () => {
    const refused = [
      '<a href="javascript&colon;alert(document.cookie)">x</a>',
      '<a href="&#106;avascript:alert(1)">x</a>',
      '<a href="java\tscript:alert(1)">x</a>',
      '<a href="http://example.org">plain http</a>',
      '<a href="https://example.org" onclick="alert(1)">x</a>',
      '<iframe src="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=="></iframe>',
      '<iframe srcdoc="&lt;script&gt;alert(1)&lt;/script&gt;"></iframe>',
      '<p style="background:url(x)">x</p>',
      '<img src=x>',
      '<!-- note -->',
    ];
    const e = await makeEntity('Rich Text Entity', 'RTE');
    for (const description of refused) {
      const res = await create({ entityId: e.id, code: 'RICH', title: 'Rich Text', description });
      expect({ description, status: res.status }).toEqual({ description, status: 422 });
      expect(res.body.error.details.map((d: { field: string }) => d.field)).toContain('body.description');
    }

    const prose = await create({ entityId: e.id, code: 'RICH-1', title: 'Rich Text', description: 'Split: online = 40%, offline < 60%' });
    expect(prose.status).toBe(201);
    expect(prose.body.data.description).toBe('Split: online = 40%, offline < 60%');

    const html =
      '<p><strong>Four</strong> <em>modules</em><br>See <a href="https://example.org/syllabus?v=1&amp;lang=en" target="_blank" rel="noopener noreferrer">the syllabus</a>.</p><ul><li>One</li></ul>';
    const rich = await create({ entityId: e.id, code: 'RICH-2', title: 'Rich Text', description: html });
    expect(rich.status).toBe(201);
    expect(rich.body.data.description).toBe(html);

    const patched = await request(app).patch(`${BASE}/${rich.body.data.id}`).set(auth(admin.token)).send({ description: '<a href="&#106;avascript:alert(1)">x</a>' });
    expect(patched.status).toBe(422);
  });

  /* F-LMS-06-05: a subset of the entity's enabled languages (Branding F-LMS-04-07; unset = [default language]). */
  it("refuses languages the entity has not enabled, on create and on update", async () => {
    const e = await makeEntity('Language Entity', 'LANG', 'en');
    const off = await create({ entityId: e.id, code: 'LANG-1', title: 'Language Course', languages: ['en', 'mr'] });
    expect(off.status).toBe(400);
    expect(off.body.error.details).toEqual([{ field: 'languages', message: 'Marathi is not enabled for this entity.' }]);

    const c = await makeCourse({ entityId: e.id, code: 'LANG-2' });
    const patchOff = await request(app).patch(`${BASE}/${c.id}`).set(auth(admin.token)).send({ languages: ['mr'] });
    expect(patchOff.status).toBe(400);
    expect(patchOff.body.error.details).toEqual([{ field: 'languages', message: 'Marathi is not enabled for this entity.' }]);

    await request(app).patch(`${API}/lms/branding/${e.id}`).set(auth(admin.token)).send({ languages: ['en', 'mr'] }).expect(200);
    expect((await create({ entityId: e.id, code: 'LANG-1', title: 'Language Course', languages: ['en', 'mr'] })).status).toBe(201);
    const patchOn = await request(app).patch(`${BASE}/${c.id}`).set(auth(admin.token)).send({ languages: ['mr', 'en'] });
    expect(patchOn.status).toBe(200);
    expect(patchOn.body.data.languages).toEqual(['mr', 'en']);

    /* Narrowing the entity later does not block an edit that leaves the languages as they are. */
    await request(app).patch(`${API}/lms/branding/${e.id}`).set(auth(admin.token)).send({ languages: null }).expect(200);
    const same = await request(app).patch(`${BASE}/${c.id}`).set(auth(admin.token)).send({ title: 'Renamed Course', languages: ['mr', 'en'] });
    expect(same.status).toBe(200);
  });

  it('GET /languages?entityId= offers exactly the entity languages the server accepts, with course permissions only', async () => {
    const e = await makeEntity('Feed Language Entity', 'FLANG', 'en');
    const languages = (token = viewer.token) => request(app).get(`${BASE}/languages?entityId=${e.id}`).set(auth(token));
    const onlyDefault = await languages();
    expect(onlyDefault.status).toBe(200);
    expect(onlyDefault.body.data).toEqual({ defaultLanguage: 'en', languages: [{ code: 'en', label: 'English' }] });

    await request(app).patch(`${API}/lms/branding/${e.id}`).set(auth(admin.token)).send({ languages: ['en', 'mr'] }).expect(200);
    expect((await languages()).body.data.languages.map((l: { code: string }) => l.code)).toEqual(['en', 'mr']);

    /* Not readable without a course permission; unknown entity 404; entityId required. */
    expect((await languages(nobody.token)).status).toBe(403);
    expect((await request(app).get(`${BASE}/languages?entityId=${MISSING_ID}`).set(auth(viewer.token))).status).toBe(404);
    expect((await request(app).get(`${BASE}/languages`).set(auth(viewer.token))).status).toBe(422);
  });

  it('refuses an unknown or inactive entity with 400 and the field', async () => {
    const unknown = await create({ entityId: MISSING_ID, code: 'REF', title: 'Ref Check' });
    expect(unknown.status).toBe(400);
    expect(unknown.body.error.details[0]).toMatchObject({ field: 'entityId' });

    const dormant = await makeEntity('Dormant Entity', 'DORM');
    await request(app).patch(`${ENTITIES}/${dormant.id}/status`).set(auth(admin.token)).send({ isActive: false }).expect(200);
    const inactive = await create({ entityId: dormant.id, code: 'REF', title: 'Ref Check' });
    expect(inactive.status).toBe(400);
    expect(inactive.body.message).toMatch(/inactive/i);
  });

  it('refuses a course code already used (409 with the field)', async () => {
    const res = await create({ entityId: entityB.id, code: 'amk-course', title: 'Clash' });
    expect(res.status).toBe(409);
    expect(res.body.error.details).toEqual([{ field: 'code', message: 'This course code is already used.' }]);
  });

  it('returns 404 for an unknown id and 422 for a malformed one', async () => {
    expect((await request(app).get(`${BASE}/${MISSING_ID}`).set(auth(admin.token))).status).toBe(404);
    expect((await request(app).get(`${BASE}/not-a-uuid`).set(auth(admin.token))).status).toBe(422);
  });

  it('freezes the entity code and blocks the entity delete once a course uses it', async () => {
    const detail = await request(app).get(`${ENTITIES}/${entityA.id}`).set(auth(admin.token));
    expect(detail.body.data.related.codeLocked).toBe(true);
    expect(detail.body.data.related.references).toContainEqual({ label: '1 course', count: 1, locksCode: true });
    const code = await request(app).patch(`${ENTITIES}/${entityA.id}`).set(auth(admin.token)).send({ code: 'AMK-2' });
    expect(code.status).toBe(409);
    const del = await request(app).delete(`${ENTITIES}/${entityA.id}`).set(auth(admin.token));
    expect(del.status).toBe(409);
    expect(del.body.message).toMatch(/1 course references it/);
  });
});

describe('Course Master — update, status and retire', () => {
  it('updates title, description and languages, and changes the code while DRAFT', async () => {
    const c = await makeCourse({ code: 'UPD', description: 'Old text' });
    await request(app).patch(`${API}/lms/branding/${entityA.id}`).set(auth(admin.token)).send({ languages: ['mr', 'en'] }).expect(200);
    const res = await request(app).patch(`${BASE}/${c.id}`).set(auth(admin.token)).send({ code: 'upd-2', title: 'Updated Course', description: '', languages: ['en'] });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ code: 'UPD-2', title: 'Updated Course', description: null, languages: ['en'] });

    const audit: { details: { fields: string[]; before: Record<string, unknown> } }[] = await AppDataSource.query(
      `SELECT "details" FROM "audit_logs" WHERE "action" = 'lms.course.update' AND "resourceId" = $1`,
      [c.id],
    );
    expect(audit[0].details.fields).toEqual(expect.arrayContaining(['code', 'title', 'description', 'languages']));
    expect(audit[0].details.before).toMatchObject({ code: 'UPD', description: 'Old text' });

    expect((await request(app).put(`${BASE}/${c.id}`).set(auth(admin.token)).send({ title: 'Put Title' })).status).toBe(200);
  });

  it('keeps the entity immutable, refuses an empty update, a code clash and an unknown id', async () => {
    const c = await makeCourse({ code: 'IMM' });
    expect((await request(app).patch(`${BASE}/${c.id}`).set(auth(admin.token)).send({ entityId: entityB.id })).status).toBe(422);
    expect((await request(app).patch(`${BASE}/${c.id}`).set(auth(admin.token)).send({ status: 'RETIRED' })).status).toBe(422);
    expect((await request(app).patch(`${BASE}/${c.id}`).set(auth(admin.token)).send({})).status).toBe(422);
    const clash = await request(app).patch(`${BASE}/${c.id}`).set(auth(admin.token)).send({ code: 'SEC-1' });
    expect(clash.status).toBe(409);
    expect(clash.body.error.details[0]).toMatchObject({ field: 'code' });
    expect((await request(app).patch(`${BASE}/${MISSING_ID}`).set(auth(admin.token)).send({ title: 'Ghost' })).status).toBe(404);
  });

  it('freezes the code once the course is in a published release; other fields stay editable', async () => {
    const c = await makeCourse({ code: 'PUB' });
    await publish(c.id);
    const locked = await request(app).patch(`${BASE}/${c.id}`).set(auth(admin.token)).send({ code: 'PUB-2' });
    expect(locked.status).toBe(409);
    expect(locked.body.error.details).toEqual([{ field: 'code', message: 'The code cannot be changed.' }]);
    const same = await request(app).patch(`${BASE}/${c.id}`).set(auth(admin.token)).send({ code: 'PUB', title: 'Still Editable' });
    expect(same.status).toBe(200);
    expect(same.body.data).toMatchObject({ status: 'PUBLISHED', publishedReleaseId: RELEASE_ID, publishedReleaseNo: 1 });
  });

  it('retires a PUBLISHED course only', async () => {
    const draft = await makeCourse({ code: 'RET-D' });
    const refused = await request(app).post(`${BASE}/${draft.id}/retire`).set(auth(admin.token));
    expect(refused.status).toBe(409);
    expect(refused.body.message).toMatch(/Only a published course/);

    const c = await makeCourse({ code: 'RET-P' });
    await publish(c.id);
    const res = await request(app).post(`${BASE}/${c.id}/retire`).set(auth(admin.token));
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('RETIRED');
    expect((await request(app).post(`${BASE}/${c.id}/retire`).set(auth(admin.token))).status).toBe(409);

    const audit: { details: { after: { status: string } } }[] = await AppDataSource.query(
      `SELECT "details" FROM "audit_logs" WHERE "action" = 'lms.course.status' AND "resourceId" = $1`,
      [c.id],
    );
    expect(audit[0].details.after).toEqual({ status: 'RETIRED' });
    /* A retired course leaves the dropdown feed. */
    const options = await request(app).get(`${BASE}/options`).set(auth(admin.token));
    expect(options.body.data.map((o: { id: string }) => o.id)).not.toContain(c.id);
  });

  it('activates and deactivates; the options feed lists active courses A to Z, by entity', async () => {
    const c = await makeCourse({ code: 'TOG', title: 'Zulu Toggle' });
    const off = await request(app).patch(`${BASE}/${c.id}/status`).set(auth(admin.token)).send({ isActive: false });
    expect(off.status).toBe(200);
    expect(off.body.message).toBe('Course deactivated');
    let options = await request(app).get(`${BASE}/options`).set(auth(moduleViewer.token));
    expect(options.status).toBe(200);
    expect(options.body.data.map((o: { id: string }) => o.id)).not.toContain(c.id);

    await request(app).patch(`${BASE}/${c.id}/status`).set(auth(admin.token)).send({ isActive: true }).expect(200);
    options = await request(app).get(`${BASE}/options`).set(auth(moduleViewer.token));
    expect(options.body.data).toContainEqual({ id: c.id, code: 'TOG', title: 'Zulu Toggle', entityId: entityA.id });
    const titles = options.body.data.map((o: { title: string }) => o.title);
    expect([...titles].sort((a: string, b: string) => a.localeCompare(b))).toEqual(titles);

    const byEntity = await request(app).get(`${BASE}/options`).query({ entityId: entityB.id }).set(auth(admin.token));
    expect(byEntity.body.data.every((o: { entityId: string }) => o.entityId === entityB.id)).toBe(true);
    expect((await request(app).patch(`${BASE}/${c.id}/status`).set(auth(admin.token)).send({ isActive: 'no' })).status).toBe(422);
  });
});

describe('Course Master — modules summary', () => {
  it('shows its modules 1 to 4 once the prescribed modules exist', async () => {
    const c = await makeCourse({ code: 'MODS' });
    await request(app).post(`${MODULES}/prescribed`).set(auth(admin.token)).send({ courseId: c.id, syllabusRef: 'Final syllabus documents' }).expect(201);
    const res = await request(app).get(`${BASE}/${c.id}`).set(auth(viewer.token));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ hasAllModules: true, missingModuleNumbers: [], references: [{ label: '4 programme modules', count: 4 }] });
    expect(res.body.data.modules.map((m: { moduleNumber: number; coreHours: number }) => [m.moduleNumber, m.coreHours])).toEqual([
      [1, 60],
      [2, 60],
      [3, 300],
      [4, 80],
    ]);
    expect(res.body.data.modules[2]).toMatchObject({ oftHoursMin: 210, oftHoursMax: 240, syllabusRef: 'Final syllabus documents', status: 'DRAFT' });

    /* Delete refused while modules exist. */
    const del = await request(app).delete(`${BASE}/${c.id}`).set(auth(admin.token));
    expect(del.status).toBe(409);
    expect(del.body.message).toMatch(/4 programme modules reference it/);
  });
});

describe('Course Master — listing', () => {
  it('searches code and title, filters by status, entity and active, sorts and pages', async () => {
    const byCode = await request(app).get(BASE).query({ search: 'amk-c' }).set(auth(viewer.token));
    expect(byCode.status).toBe(200);
    expect(byCode.body.data.map((c: { code: string }) => c.code)).toEqual(['AMK-COURSE']);
    expect(byCode.body.data[0].entity).toMatchObject({ code: 'AMK' });

    const byTitle = await request(app).get(BASE).query({ search: 'second course' }).set(auth(viewer.token));
    expect(byTitle.body.data.map((c: { code: string }) => c.code)).toEqual(['SEC-1']);

    const published = await request(app).get(BASE).query({ status: 'PUBLISHED', limit: 100 }).set(auth(viewer.token));
    expect(published.body.data.map((c: { code: string }) => c.code)).toEqual(['PUB']);

    const byEntity = await request(app).get(BASE).query({ entityId: entityB.id, limit: 100 }).set(auth(viewer.token));
    expect(byEntity.body.data.map((c: { code: string }) => c.code)).toEqual(['SEC-1']);

    const inactive = await request(app).get(BASE).query({ isActive: 'false', limit: 100 }).set(auth(viewer.token));
    expect(inactive.body.data.every((c: { isActive: boolean }) => !c.isActive)).toBe(true);

    const sorted = await request(app).get(BASE).query({ sortBy: 'code', sortOrder: 'desc', limit: 100 }).set(auth(viewer.token));
    const codes = sorted.body.data.map((c: { code: string }) => c.code);
    expect([...codes].sort().reverse()).toEqual(codes);

    const paged = await request(app).get(BASE).query({ limit: 2, page: 2 }).set(auth(viewer.token));
    expect(paged.body.data).toHaveLength(2);
    expect(paged.body.meta).toMatchObject({ page: 2, limit: 2 });
    expect(paged.body.meta.total).toBeGreaterThanOrEqual(5);

    expect((await request(app).get(BASE).query({ sortBy: 'description' }).set(auth(viewer.token))).status).toBe(422);
    expect((await request(app).get(BASE).query({ status: 'ACTIVE' }).set(auth(viewer.token))).status).toBe(422);
  });
});

describe('Course Master — delete and restore', () => {
  it('soft-deletes a DRAFT course and restores it inactive', async () => {
    const c = await makeCourse({ code: 'DEL' });
    const del = await request(app).delete(`${BASE}/${c.id}`).set(auth(admin.token));
    expect(del.status).toBe(200);
    expect(del.body.data).toBeNull();
    expect((await request(app).get(`${BASE}/${c.id}`).set(auth(admin.token))).status).toBe(404);
    expect((await request(app).delete(`${BASE}/${c.id}`).set(auth(admin.token))).status).toBe(404);

    const restored = await request(app).post(`${BASE}/${c.id}/restore`).set(auth(admin.token));
    expect(restored.status).toBe(200);
    expect(restored.body.data).toMatchObject({ isActive: false, code: 'DEL', status: 'DRAFT' });
    expect((await request(app).post(`${BASE}/${c.id}/restore`).set(auth(admin.token))).status).toBe(409);
    expect((await request(app).post(`${BASE}/${MISSING_ID}/restore`).set(auth(admin.token))).status).toBe(404);
  });

  it('never deletes a course that reached a release (retire instead)', async () => {
    const c = await makeCourse({ code: 'KEEP' });
    await publish(c.id);
    const del = await request(app).delete(`${BASE}/${c.id}`).set(auth(admin.token));
    expect(del.status).toBe(409);
    expect(del.body.message).toMatch(/retired, never deleted/);
  });

  it('refuses to restore a course whose code was taken or whose entity was deleted meanwhile', async () => {
    const c = await makeCourse({ code: 'TAKEN' });
    await request(app).delete(`${BASE}/${c.id}`).set(auth(admin.token)).expect(200);
    await makeCourse({ code: 'TAKEN' });
    const res = await request(app).post(`${BASE}/${c.id}/restore`).set(auth(admin.token));
    expect(res.status).toBe(409);
    expect(res.body.error.details[0]).toMatchObject({ field: 'code' });

    const e = await makeEntity('Short Lived', 'SHORT');
    const orphan = await makeCourse({ entityId: e.id, code: 'ORPHAN' });
    await request(app).delete(`${BASE}/${orphan.id}`).set(auth(admin.token)).expect(200);
    await request(app).delete(`${ENTITIES}/${e.id}`).set(auth(admin.token)).expect(200);
    const blocked = await request(app).post(`${BASE}/${orphan.id}/restore`).set(auth(admin.token));
    expect(blocked.status).toBe(409);
    expect(blocked.body.message).toMatch(/Restore the entity first/);
  });

  it('lists only the deleted courses with deleted=true (same search, filters and paging, view permission); a restore moves one back', async () => {
    const owner = await makeEntity('Recycle Entity', 'RCY');
    const gone = await makeCourse({ entityId: owner.id, code: 'RCY-GONE', title: 'Recycle Gone' });
    await makeCourse({ entityId: owner.id, code: 'RCY-KEPT', title: 'Recycle Kept' });
    await request(app).delete(`${BASE}/${gone.id}`).set(auth(admin.token)).expect(200);
    const list = (query: Record<string, string | number>) => request(app).get(BASE).query({ entityId: owner.id, ...query }).set(auth(viewer.token));
    const codes = (res: { body: { data: { code: string }[] } }) => res.body.data.map((c) => c.code);

    const deleted = await list({ deleted: 'true' });
    expect(deleted.status).toBe(200);
    expect(codes(deleted)).toEqual(['RCY-GONE']);
    expect(deleted.body.data[0]).toMatchObject({ id: gone.id, isActive: false, status: 'DRAFT', entity: { code: 'RCY' } });
    expect(deleted.body.meta).toMatchObject({ total: 1 });
    expect(codes(await list({}))).toEqual(['RCY-KEPT']);
    expect(codes(await list({ deleted: 'false' }))).toEqual(['RCY-KEPT']);
    expect(codes(await list({ deleted: 'true', status: 'DRAFT', search: 'recycle gone' }))).toEqual(['RCY-GONE']);
    expect(codes(await list({ deleted: 'true', search: 'kept' }))).toEqual([]);
    expect(codes(await list({ deleted: 'true', status: 'PUBLISHED' }))).toEqual([]);
    expect((await list({ deleted: 'true', limit: 1, page: 2 })).body.meta).toEqual({ page: 2, limit: 1, total: 1, totalPages: 1 });
    expect((await list({ deleted: 'yes' })).status).toBe(422);

    expect((await request(app).post(`${BASE}/${gone.id}/restore`).set(auth(admin.token))).status).toBe(200);
    expect(codes(await list({ deleted: 'true' }))).toEqual([]);
    expect(codes(await list({}))).toEqual(['RCY-GONE', 'RCY-KEPT']);
  });

  it('enforces the code and lifecycle rules in the database', async () => {
    await expect(
      AppDataSource.query(`INSERT INTO "lms_courses" ("entityId", "code", "title", "languages") VALUES ($1, 'AMK-COURSE', 'Dup Title', '{en}')`, [entityA.id]),
    ).rejects.toThrow(/UQ_lms_courses_code_active/);
    await expect(
      AppDataSource.query(`INSERT INTO "lms_courses" ("entityId", "code", "title", "languages", "status") VALUES ($1, 'DB-1', 'Db Title', '{en}', 'PUBLISHED')`, [entityA.id]),
    ).rejects.toThrow(/CHK_lms_courses_draft_release/);
    await expect(
      AppDataSource.query(`INSERT INTO "lms_courses" ("entityId", "code", "title", "languages") VALUES ($1, 'DB-2', 'Db Title', '{}')`, [entityA.id]),
    ).rejects.toThrow(/CHK_lms_courses_languages/);
  });
});

describe('Course Master — permissions', () => {
  it('requires a session', async () => {
    expect((await request(app).get(BASE)).status).toBe(401);
  });

  it('lets a viewer read but not write', async () => {
    const c = await makeCourse({ code: 'PERM' });
    expect((await request(app).get(BASE).set(auth(viewer.token))).status).toBe(200);
    expect((await request(app).get(`${BASE}/${c.id}`).set(auth(viewer.token))).status).toBe(200);
    expect((await create({ entityId: entityA.id, code: 'VIEW', title: 'Viewer Made' }, viewer.token)).status).toBe(403);
    expect((await request(app).patch(`${BASE}/${c.id}`).set(auth(viewer.token)).send({ title: 'Viewer Edit' })).status).toBe(403);
    expect((await request(app).patch(`${BASE}/${c.id}/status`).set(auth(viewer.token)).send({ isActive: false })).status).toBe(403);
    expect((await request(app).post(`${BASE}/${c.id}/retire`).set(auth(viewer.token))).status).toBe(403);
    expect((await request(app).delete(`${BASE}/${c.id}`).set(auth(viewer.token))).status).toBe(403);
    expect((await request(app).post(`${BASE}/${c.id}/restore`).set(auth(viewer.token))).status).toBe(403);
  });

  it('refuses every course route to a user without a curriculum permission; the options feed follows the dependent masters', async () => {
    expect((await request(app).get(BASE).set(auth(nobody.token))).status).toBe(403);
    expect((await request(app).get(`${BASE}/options`).set(auth(nobody.token))).status).toBe(403);
    expect((await request(app).get(`${BASE}/options`).set(auth(moduleViewer.token))).status).toBe(200);
    expect((await request(app).get(BASE).set(auth(moduleViewer.token))).status).toBe(403);
  });
});
