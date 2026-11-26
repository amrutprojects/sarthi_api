import type { Express } from 'express';
import { AppDataSource } from '../../../src/config/database.config';
import { PRESCRIBED_MODULES } from '../../../src/lms/course-module/course-module.constants';
import { COURSE_MODULE_REFERENCES, checkModuleHours } from '../../../src/lms/course-module/course-module.service';
import { API, actorWith, auth, request, setupTestApp, superAdmin, teardownTestApp, type TestActor } from '../../helpers/test-app';

/*
 * Module Master (AMRUT_KALASH_03 L-06 / F-LMS-07, section 2.1) — /api/v1/lms/course-modules.
 * Fixtures: an entity and courses created through the Entity and Course Master APIs.
 */
const BASE = `${API}/lms/course-modules`;
const COURSES = `${API}/lms/courses`;
const MISSING_ID = '00000000-0000-4000-8000-000000000000';

let app: Express;
let admin: TestActor;
let viewer: TestActor;
let nobody: TestActor;
let variantViewer: TestActor;
let entityId: string;
/* full: the four prescribed modules; custom: modules created one by one. */
let full: string;
let custom: string;

async function makeCourse(code: string, title = `Course ${code}`): Promise<string> {
  const res = await request(app).post(COURSES).set(auth(admin.token)).send({ entityId, code, title });
  if (res.status !== 201) throw new Error(`makeCourse failed (${res.status}): ${JSON.stringify(res.body)}`);
  return res.body.data.id as string;
}

type Body = Record<string, unknown>;
const create = (body: Body, token = admin.token) => request(app).post(BASE).set(auth(token)).send(body);

async function makeModule(body: Body): Promise<{ id: string }> {
  const res = await create({ title: 'Module Title', ...body });
  if (res.status !== 201) throw new Error(`makeModule failed (${res.status}): ${JSON.stringify(res.body)}`);
  return res.body.data;
}

const moduleOf = async (courseId: string, moduleNumber: number): Promise<string> => {
  const rows: { id: string }[] = await AppDataSource.query(
    `SELECT "id" FROM "lms_course_modules" WHERE "courseId" = $1 AND "moduleNumber" = $2 AND "isDelete" = false`,
    [courseId, moduleNumber],
  );
  return rows[0].id;
};

beforeAll(async () => {
  app = await setupTestApp();
  admin = await superAdmin();
  viewer = await actorWith(['lms-course-modules.view']);
  nobody = await actorWith(['lms-courses.view']);
  variantViewer = await actorWith(['lms-track-variants.view']);
  const entity = await request(app).post(`${API}/lms/entities`).set(auth(admin.token)).send({ name: 'Sarthi', code: 'AMK', defaultLanguage: 'en' });
  entityId = entity.body.data.id;
  full = await makeCourse('FULL', 'Alpha Course');
  custom = await makeCourse('CUSTOM', 'Bravo Course');
});
afterAll(teardownTestApp);

describe('Module Master — prescribed modules (section 2.1)', () => {
  it('serves the four prescribed modules of the final syllabus documents, marked not yet approved (OQ-012)', async () => {
    const res = await request(app).get(`${BASE}/prescribed`).set(auth(viewer.token));
    expect(res.status).toBe(200);
    expect(res.body.data.confirmedByCompetentAuthority).toBe(false);
    const rows = res.body.data.modules.map((m: Body) => [m.moduleNumber, m.coreHours, m.oftHoursMin, m.oftHoursMax, m.syllabusRef, m.description]);
    expect(rows).toEqual([
      [1, 60, 42, 48, null, null],
      [2, 60, 42, 48, null, null],
      [3, 300, 210, 240, null, null],
      [4, 80, 56, 64, null, null],
    ]);
    expect(res.body.data.modules[0]).toMatchObject({ sessions: 30, sessionHours: 2, lectureHours: 22, practicalHours: 38 });
    expect(res.body.data.modules[2]).toMatchObject({ title: 'Domain-Specific Basic Digital Skills', sessions: null, lectureHours: 150, practicalHours: 150 });
    expect(res.body.data.modules[3]).toMatchObject({ title: 'Domain-Specific Advanced Digital Skills', sessions: 40, sessionHours: 2 });
    /* The defaults satisfy the module's own consistency rules. */
    for (const p of PRESCRIBED_MODULES) expect(checkModuleHours({ ...p, syllabusRef: 'Final syllabus documents' })).toEqual([]);
  });

  it('creates the missing prescribed modules of a course in one call, then nothing more', async () => {
    const res = await request(app).post(`${BASE}/prescribed`).set(auth(admin.token)).send({ courseId: full, syllabusRef: ' Final syllabus documents ' });
    expect(res.status).toBe(201);
    expect(res.body.data.created).toEqual([1, 2, 3, 4]);
    expect(res.body.data.modules.map((m: { moduleNumber: number }) => m.moduleNumber)).toEqual([1, 2, 3, 4]);
    expect(res.body.data.modules[0]).toMatchObject({
      title: 'Personality Development, Communication, Programme Orientation & Entrepreneurship Foundation',
      coreHours: 60,
      sessions: 30,
      sessionHours: 2,
      lectureHours: 22,
      practicalHours: 38,
      oftHoursMin: 42,
      oftHoursMax: 48,
      syllabusRef: 'Final syllabus documents',
      description: null,
      status: 'DRAFT',
      isActive: true,
      course: { id: full, code: 'FULL' },
      /* F-LMS-07-05: the syllabus reference comes with the core hours, so nothing is left before release. */
      missingForRelease: [],
    });

    const again = await request(app).post(`${BASE}/prescribed`).set(auth(admin.token)).send({ courseId: full, syllabusRef: 'Final syllabus documents' });
    expect(again.status).toBe(200);
    expect(again.body.data.created).toEqual([]);

    const audit: { n: string }[] = await AppDataSource.query(
      `SELECT count(*) AS n FROM "audit_logs" WHERE "action" = 'lms.course-module.create' AND "details"->'after'->>'courseId' = $1`,
      [full],
    );
    expect(Number(audit[0].n)).toBe(4);
  });

  it('fills only the numbers a course is missing, and refuses an unusable course', async () => {
    const c = await makeCourse('PART');
    await makeModule({ courseId: c, moduleNumber: 2, title: 'Own Module Two' });
    const res = await request(app).post(`${BASE}/prescribed`).set(auth(admin.token)).send({ courseId: c, syllabusRef: 'Final syllabus documents' });
    expect(res.status).toBe(201);
    expect(res.body.data.created).toEqual([1, 3, 4]);
    expect(res.body.data.modules.find((m: { moduleNumber: number }) => m.moduleNumber === 2).title).toBe('Own Module Two');

    const unknown = await request(app).post(`${BASE}/prescribed`).set(auth(admin.token)).send({ courseId: MISSING_ID, syllabusRef: 'Final syllabus documents' });
    expect(unknown.status).toBe(400);
    expect(unknown.body.error.details[0]).toMatchObject({ field: 'courseId' });
  });
});

describe('Module Master — create', () => {
  it('creates a module with its hours and records the audit', async () => {
    const res = await create({
      courseId: custom,
      moduleNumber: 1,
      title: '  Module   One ',
      description: 'Outcomes',
      coreHours: 60,
      syllabusRef: 'Module 1 syllabus v1.0',
      sessions: 30,
      sessionHours: 2,
      oftHoursMin: 42.5,
      oftHoursMax: 48,
    });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      courseId: custom,
      moduleNumber: 1,
      title: 'Module One',
      coreHours: 60,
      oftHoursMin: 42.5,
      lectureHours: null,
      status: 'DRAFT',
      missingForRelease: [],
      references: [],
    });
    const audit: { action: string }[] = await AppDataSource.query(`SELECT "action" FROM "audit_logs" WHERE "resourceId" = $1`, [res.body.data.id]);
    expect(audit).toEqual([{ action: 'lms.course-module.create' }]);
  });

  it('accepts a module with no hours yet (required only before release)', async () => {
    const res = await create({ courseId: custom, moduleNumber: 4, title: 'Module Four' });
    expect(res.status).toBe(201);
    expect(res.body.data.missingForRelease).toEqual(['coreHours', 'syllabusRef', 'deliveryPattern', 'oftHours']);
  });

  it('refuses a duplicate module number (409) and a fifth module (422)', async () => {
    const dup = await create({ courseId: custom, moduleNumber: 1, title: 'Again One' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.details).toEqual([{ field: 'moduleNumber', message: 'This module already exists for the course.' }]);
    expect((await create({ courseId: custom, moduleNumber: 5, title: 'Fifth' })).status).toBe(422);
    expect((await create({ courseId: custom, moduleNumber: 0, title: 'Zeroth' })).status).toBe(422);
  });

  it('refuses invalid fields with 422 and the field name', async () => {
    const bad = async (body: Body, field: string) => {
      const res = await create({ courseId: custom, moduleNumber: 3, title: 'Valid Title', ...body });
      expect(res.status).toBe(422);
      expect(res.body.error.details.map((d: { field: string }) => d.field)).toContain(field);
    };
    await bad({ title: 'Ab' }, 'body.title');
    await bad({ title: 'x'.repeat(161) }, 'body.title');
    await bad({ description: 'x'.repeat(3001) }, 'body.description');
    await bad({ description: '<img src=x onerror=alert(1)>' }, 'body.description');
    await bad({ coreHours: 0 }, 'body.coreHours');
    await bad({ coreHours: -5 }, 'body.coreHours');
    await bad({ coreHours: 60.123 }, 'body.coreHours');
    await bad({ coreHours: '60' }, 'body.coreHours');
    await bad({ sessions: 2.5 }, 'body.sessions');
    await bad({ oftHoursMin: 0 }, 'body.oftHoursMin');
    await bad({ syllabusRef: 'x'.repeat(121) }, 'body.syllabusRef');
    await bad({ status: 'PUBLISHED' }, 'body');
    await bad({ trackId: MISSING_ID }, 'body');
    const missing = await create({});
    expect(missing.body.error.details.map((d: { field: string }) => d.field)).toEqual(
      expect.arrayContaining(['body.courseId', 'body.moduleNumber', 'body.title']),
    );
  });

  it('checks the delivery pattern and the OFT range against the core hours (400 with the field)', async () => {
    const bad = async (body: Body, field: string, message: string) => {
      const res = await create({ courseId: custom, moduleNumber: 3, title: 'Module Three', ...body });
      expect(res.status).toBe(400);
      expect(res.body.error.details).toContainEqual({ field, message });
    };
    const ADD_UP = 'The delivery pattern does not add up to the core hours.';
    await bad({ coreHours: 300, sessions: 30 }, 'sessionHours', 'Enter both the number of sessions and the session hours.');
    await bad({ coreHours: 300, practicalHours: 150 }, 'lectureHours', 'Enter both the lecture and the practical hours.');
    await bad({ sessions: 30, sessionHours: 2 }, 'coreHours', 'Enter the core hours of the module.');
    await bad({ coreHours: 300, sessions: 30, sessionHours: 2 }, 'sessions', ADD_UP);
    await bad({ coreHours: 300, lectureHours: 150, practicalHours: 149.5 }, 'lectureHours', ADD_UP);
    await bad({ oftHoursMin: 240, oftHoursMax: 210 }, 'oftHoursMin', 'Enter a valid OFT hours range.');
    await bad({ oftHoursMin: 210 }, 'oftHoursMax', 'Enter a valid OFT hours range.');

    const ok = await create({ courseId: custom, moduleNumber: 3, title: 'Module Three', coreHours: 300, syllabusRef: 'Module 3 syllabus v1', lectureHours: 150.25, practicalHours: 149.75, oftHoursMin: 210, oftHoursMax: 210 });
    expect(ok.status).toBe(201);
  });

  /* F-LMS-07-02: 3–160 characters — the spec's own default and Table 7's Module 3 title carry ':' and '—'. */
  it('accepts the module titles of the final syllabus documents, punctuation included; the title stays plain text', async () => {
    const c = await makeCourse('TITLES');
    const two = await create({ courseId: c, moduleNumber: 2, title: ' Module 2:  Basic Information Technology Skills ' });
    expect(two.status).toBe(201);
    expect(two.body.data.title).toBe('Module 2: Basic Information Technology Skills');
    const three = "Domain-Specific Basic Digital Skills — the candidate's one selected technology track";
    const patched = await request(app).patch(`${BASE}/${two.body.data.id}`).set(auth(admin.token)).send({ title: three });
    expect(patched.status).toBe(200);
    expect(patched.body.data.title).toBe(three);

    const missing = await create({ courseId: c, moduleNumber: 1 });
    expect(missing.status).toBe(422);
    expect(missing.body.error.details).toContainEqual({ field: 'body.title', message: 'Enter a module title.' });
    expect((await create({ courseId: c, moduleNumber: 1, title: '<b>Bold</b> title' })).status).toBe(422);
  });

  /* F-LMS-07-05: the syllabus reference is "Required with core hours" — on create, on update and for the prescribed modules. */
  it('requires the syllabus reference whenever the module has core hours', async () => {
    const REF = { field: 'syllabusRef', message: 'Enter the syllabus reference.' };
    const c = await makeCourse('SYLREF');
    const noRef = await create({ courseId: c, moduleNumber: 1, title: 'Module One', coreHours: 60 });
    expect(noRef.status).toBe(400);
    expect(noRef.body.error.details).toEqual([REF]);

    const m = await makeModule({ courseId: c, moduleNumber: 1, coreHours: 60, syllabusRef: 'Module 1 syllabus v1' });
    for (const syllabusRef of [null, '']) {
      const cleared = await request(app).patch(`${BASE}/${m.id}`).set(auth(admin.token)).send({ syllabusRef });
      expect(cleared.status).toBe(400);
      expect(cleared.body.error.details).toEqual([REF]);
    }
    /* Without core hours the reference may be empty (both are then "required before release"). */
    const both = await request(app).patch(`${BASE}/${m.id}`).set(auth(admin.token)).send({ coreHours: null, syllabusRef: null, reason: 'Hours withdrawn' });
    expect(both.status).toBe(200);
    expect(both.body.data).toMatchObject({ coreHours: null, syllabusRef: null });

    const noDoc = await request(app).post(`${BASE}/prescribed`).set(auth(admin.token)).send({ courseId: c });
    expect(noDoc.status).toBe(422);
    expect(noDoc.body.error.details).toContainEqual({ field: 'body.syllabusRef', message: 'Enter the syllabus reference.' });
    const prescribed = await request(app).post(`${BASE}/prescribed`).set(auth(admin.token)).send({ courseId: c, syllabusRef: 'Final syllabus documents v1' });
    expect(prescribed.status).toBe(201);
    expect(prescribed.body.data.created).toEqual([2, 3, 4]);
    for (const x of prescribed.body.data.modules.filter((y: { moduleNumber: number }) => y.moduleNumber > 1)) {
      expect(x).toMatchObject({ syllabusRef: 'Final syllabus documents v1', missingForRelease: [] });
    }

    const raw = await makeCourse('SYLREF-DB');
    await expect(
      AppDataSource.query(`INSERT INTO "lms_course_modules" ("courseId", "moduleNumber", "title", "coreHours") VALUES ($1, 1, 'Raw One', 60)`, [raw]),
    ).rejects.toThrow(/CHK_lms_course_modules_syllabus_ref_required/);
  });

  it('requires a usable course: unknown, inactive or retired is refused with 400 on courseId', async () => {
    const unknown = await create({ courseId: MISSING_ID, moduleNumber: 1, title: 'Orphan' });
    expect(unknown.status).toBe(400);
    expect(unknown.body.error.details[0]).toMatchObject({ field: 'courseId' });

    const dormant = await makeCourse('DORMANT');
    await request(app).patch(`${COURSES}/${dormant}/status`).set(auth(admin.token)).send({ isActive: false }).expect(200);
    const inactive = await create({ courseId: dormant, moduleNumber: 1, title: 'Sleepy' });
    expect(inactive.status).toBe(400);
    expect(inactive.body.message).toMatch(/inactive/i);

    const retired = await makeCourse('RETIRED');
    await AppDataSource.query(
      `UPDATE "lms_courses" SET "status" = 'RETIRED', "publishedReleaseId" = gen_random_uuid(), "publishedReleaseNo" = 1 WHERE "id" = $1`,
      [retired],
    );
    const res = await create({ courseId: retired, moduleNumber: 1, title: 'Too Late' });
    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual([{ field: 'courseId', message: 'Choose a course that is not retired' }]);
  });

  it('enforces one module per number and the hour rules in the database', async () => {
    await expect(
      AppDataSource.query(`INSERT INTO "lms_course_modules" ("courseId", "moduleNumber", "title") VALUES ($1, 1, 'Dup One')`, [full]),
    ).rejects.toThrow(/UQ_lms_course_modules_number_active/);
    await expect(
      AppDataSource.query(`INSERT INTO "lms_course_modules" ("courseId", "moduleNumber", "title") VALUES ($1, 5, 'Five')`, [custom]),
    ).rejects.toThrow(/CHK_lms_course_modules_number/);
    await expect(
      AppDataSource.query(`INSERT INTO "lms_course_modules" ("courseId", "moduleNumber", "title", "coreHours", "sessions", "sessionHours") VALUES ($1, 2, 'Two', 60, 30, 3)`, [custom]),
    ).rejects.toThrow(/CHK_lms_course_modules_sessions/);
    await expect(
      AppDataSource.query(`INSERT INTO "lms_course_modules" ("courseId", "moduleNumber", "title", "oftHoursMin", "oftHoursMax") VALUES ($1, 2, 'Two', 50, 40)`, [custom]),
    ).rejects.toThrow(/CHK_lms_course_modules_oft_range/);
  });
});

describe('Module Master — update and status', () => {
  it('edits title and description freely; course and number are fixed', async () => {
    const id = await moduleOf(full, 2);
    const res = await request(app).patch(`${BASE}/${id}`).set(auth(admin.token)).send({ title: 'Basic IT Skills', description: 'What the module covers' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ title: 'Basic IT Skills', description: 'What the module covers', coreHours: 60 });
    expect((await request(app).patch(`${BASE}/${id}`).set(auth(admin.token)).send({ moduleNumber: 3 })).status).toBe(422);
    expect((await request(app).patch(`${BASE}/${id}`).set(auth(admin.token)).send({ courseId: custom })).status).toBe(422);
    expect((await request(app).patch(`${BASE}/${id}`).set(auth(admin.token)).send({})).status).toBe(422);
    expect((await request(app).patch(`${BASE}/${id}`).set(auth(admin.token)).send({ reason: 'Nothing else' })).status).toBe(422);
    expect((await request(app).patch(`${BASE}/${MISSING_ID}`).set(auth(admin.token)).send({ title: 'Ghost Module' })).status).toBe(404);
  });

  it('a change of the core hours needs the syllabus reference and a reason, and is audited with before / after', async () => {
    const id = await moduleOf(full, 4);
    const noRef = await request(app).patch(`${BASE}/${id}`).set(auth(admin.token)).send({ coreHours: 90, sessions: 45, syllabusRef: null, reason: 'Approved' });
    expect(noRef.status).toBe(400);
    expect(noRef.body.error.details).toEqual([{ field: 'syllabusRef', message: 'Enter the syllabus reference.' }]);

    const noReason = await request(app).patch(`${BASE}/${id}`).set(auth(admin.token)).send({ coreHours: 90, sessions: 45, syllabusRef: 'Module 4 syllabus v2' });
    expect(noReason.status).toBe(400);
    expect(noReason.body.error.details).toEqual([{ field: 'reason', message: 'Enter a reason.' }]);

    /* The delivery pattern must still add up (40 × 2 ≠ 90). */
    const notAdding = await request(app).patch(`${BASE}/${id}`).set(auth(admin.token)).send({ coreHours: 90, syllabusRef: 'Module 4 syllabus v2', reason: 'Approved' });
    expect(notAdding.status).toBe(400);
    expect(notAdding.body.error.details[0]).toMatchObject({ field: 'sessions' });

    const ok = await request(app)
      .put(`${BASE}/${id}`)
      .set(auth(admin.token))
      .send({ coreHours: 90, sessions: 45, oftHoursMin: 63, oftHoursMax: 72, syllabusRef: 'Module 4 syllabus v2', reason: 'Approved by the competent authority' });
    expect(ok.status).toBe(200);
    expect(ok.body.data).toMatchObject({ coreHours: 90, sessions: 45, sessionHours: 2, oftHoursMin: 63, oftHoursMax: 72, missingForRelease: [] });

    const audit: { details: { fields: string[]; before: Body; after: Body; reason: string } }[] = await AppDataSource.query(
      `SELECT "details" FROM "audit_logs" WHERE "action" = 'lms.course-module.update' AND "resourceId" = $1`,
      [id],
    );
    expect(audit).toHaveLength(1);
    expect(audit[0].details.before).toEqual({ coreHours: 80, sessions: 40, oftHoursMin: 56, oftHoursMax: 64, syllabusRef: 'Final syllabus documents' });
    expect(audit[0].details.after).toMatchObject({ coreHours: 90, sessions: 45 });
    expect(audit[0].details.reason).toBe('Approved by the competent authority');

    /* Other hour fields change without a reason; clearing the OFT range is allowed (both together). */
    const oft = await request(app).patch(`${BASE}/${id}`).set(auth(admin.token)).send({ oftHoursMin: null, oftHoursMax: null });
    expect(oft.status).toBe(200);
    expect(oft.body.data.missingForRelease).toEqual(['oftHours']);
    const half = await request(app).patch(`${BASE}/${id}`).set(auth(admin.token)).send({ oftHoursMin: 60 });
    expect(half.status).toBe(400);
  });

  it('activates and deactivates; the options feed lists active modules, by course and number', async () => {
    const id = await moduleOf(full, 3);
    let options = await request(app).get(`${BASE}/options`).query({ courseId: full, moduleNumber: 3 }).set(auth(variantViewer.token));
    expect(options.status).toBe(200);
    expect(options.body.data).toEqual([{ id, courseId: full, moduleNumber: 3, title: 'Domain-Specific Basic Digital Skills' }]);

    const off = await request(app).patch(`${BASE}/${id}/status`).set(auth(admin.token)).send({ isActive: false });
    expect(off.status).toBe(200);
    expect(off.body.message).toBe('Module deactivated');
    options = await request(app).get(`${BASE}/options`).query({ courseId: full }).set(auth(variantViewer.token));
    expect(options.body.data.map((o: { moduleNumber: number }) => o.moduleNumber)).toEqual([1, 2, 4]);
    await request(app).patch(`${BASE}/${id}/status`).set(auth(admin.token)).send({ isActive: true }).expect(200);
    expect((await request(app).get(`${BASE}/options`).query({ moduleNumber: 7 }).set(auth(admin.token))).status).toBe(422);
  });
});

describe('Module Master — listing', () => {
  it('filters by course, number, status and active, searches the title, sorts and pages', async () => {
    const byCourse = await request(app).get(BASE).query({ courseId: full }).set(auth(viewer.token));
    expect(byCourse.status).toBe(200);
    expect(byCourse.body.data.map((m: { moduleNumber: number }) => m.moduleNumber)).toEqual([1, 2, 3, 4]);

    const threes = await request(app).get(BASE).query({ moduleNumber: 3, limit: 100 }).set(auth(viewer.token));
    expect(threes.body.data.every((m: { moduleNumber: number }) => m.moduleNumber === 3)).toBe(true);
    expect(threes.body.data.length).toBeGreaterThanOrEqual(3);

    const search = await request(app).get(BASE).query({ search: 'basic it' }).set(auth(viewer.token));
    expect(search.body.data.map((m: { title: string }) => m.title)).toEqual(['Basic IT Skills']);

    const drafts = await request(app).get(BASE).query({ status: 'DRAFT', limit: 100 }).set(auth(viewer.token));
    expect(drafts.body.meta.total).toBe(drafts.body.data.length);

    const sorted = await request(app).get(BASE).query({ sortBy: 'moduleNumber', sortOrder: 'desc', limit: 100 }).set(auth(viewer.token));
    const numbers: number[] = sorted.body.data.map((m: { moduleNumber: number }) => m.moduleNumber);
    expect([...numbers].sort((a, b) => b - a)).toEqual(numbers);
    expect((await request(app).get(BASE).query({ sortBy: 'title' }).set(auth(viewer.token))).status).toBe(200);

    const paged = await request(app).get(BASE).query({ limit: 3, page: 2 }).set(auth(viewer.token));
    expect(paged.body.data).toHaveLength(3);
    expect(paged.body.meta).toMatchObject({ page: 2, limit: 3 });

    expect((await request(app).get(BASE).query({ sortBy: 'coreHours' }).set(auth(viewer.token))).status).toBe(422);
  });
});

describe('Module Master — delete and restore', () => {
  it('soft-deletes, restores inactive, and refuses a restore onto a retaken number', async () => {
    const c = await makeCourse('DELMOD');
    const m = await makeModule({ courseId: c, moduleNumber: 1 });
    const del = await request(app).delete(`${BASE}/${m.id}`).set(auth(admin.token));
    expect(del.status).toBe(200);
    expect((await request(app).get(`${BASE}/${m.id}`).set(auth(admin.token))).status).toBe(404);

    const restored = await request(app).post(`${BASE}/${m.id}/restore`).set(auth(admin.token));
    expect(restored.status).toBe(200);
    expect(restored.body.data).toMatchObject({ isActive: false, moduleNumber: 1 });
    expect((await request(app).post(`${BASE}/${m.id}/restore`).set(auth(admin.token))).status).toBe(409);

    await request(app).delete(`${BASE}/${m.id}`).set(auth(admin.token)).expect(200);
    await makeModule({ courseId: c, moduleNumber: 1, title: 'Replacement' });
    const clash = await request(app).post(`${BASE}/${m.id}/restore`).set(auth(admin.token));
    expect(clash.status).toBe(409);
    expect(clash.body.error.details[0]).toMatchObject({ field: 'moduleNumber' });
  });

  it('lets the course be deleted once its modules are gone, and refuses a module restore under a deleted course', async () => {
    const c = await makeCourse('GONE');
    const m = await makeModule({ courseId: c, moduleNumber: 2 });
    expect((await request(app).delete(`${COURSES}/${c}`).set(auth(admin.token))).status).toBe(409);
    await request(app).delete(`${BASE}/${m.id}`).set(auth(admin.token)).expect(200);
    await request(app).delete(`${COURSES}/${c}`).set(auth(admin.token)).expect(200);
    const res = await request(app).post(`${BASE}/${m.id}/restore`).set(auth(admin.token));
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/Restore the course first/);
  });

  it('refuses to delete a released module or one a track variant references (guard list)', async () => {
    const c = await makeCourse('GUARD');
    const m = await makeModule({ courseId: c, moduleNumber: 3 });

    /* lms_track_variants is built by the Track Variant master, which appends to COURSE_MODULE_REFERENCES. */
    const stub = { one: 'track variant', count: async (_m: unknown, id: string) => (id === m.id ? 2 : 0) };
    COURSE_MODULE_REFERENCES.push(stub);
    try {
      const detail = await request(app).get(`${BASE}/${m.id}`).set(auth(admin.token));
      expect(detail.body.data.references).toEqual([{ label: '2 track variants', count: 2 }]);
      const del = await request(app).delete(`${BASE}/${m.id}`).set(auth(admin.token));
      expect(del.status).toBe(409);
      expect(del.body.message).toMatch(/associated with existing track variants \(2\)/);
    } finally {
      COURSE_MODULE_REFERENCES.splice(COURSE_MODULE_REFERENCES.indexOf(stub), 1);
    }

    await AppDataSource.query(`UPDATE "lms_course_modules" SET "status" = 'PUBLISHED' WHERE "id" = $1`, [m.id]);
    const released = await request(app).delete(`${BASE}/${m.id}`).set(auth(admin.token));
    expect(released.status).toBe(409);
    expect(released.body.message).toMatch(/retired, never deleted/);
  });

  it('lists only the deleted modules with deleted=true (same search, filters and paging, view permission); a restore moves one back', async () => {
    const c = await makeCourse('RCYMOD', 'Recycle Course');
    const gone = await makeModule({ courseId: c, moduleNumber: 1, title: 'Recycle Gone Module' });
    await makeModule({ courseId: c, moduleNumber: 2, title: 'Recycle Kept Module' });
    await request(app).delete(`${BASE}/${gone.id}`).set(auth(admin.token)).expect(200);
    const list = (query: Record<string, string | number>) => request(app).get(BASE).query({ courseId: c, ...query }).set(auth(viewer.token));
    const numbers = (res: { body: { data: { moduleNumber: number }[] } }) => res.body.data.map((m) => m.moduleNumber);

    const deleted = await list({ deleted: 'true' });
    expect(deleted.status).toBe(200);
    expect(numbers(deleted)).toEqual([1]);
    expect(deleted.body.data[0]).toMatchObject({ id: gone.id, isActive: false, title: 'Recycle Gone Module', course: { code: 'RCYMOD' } });
    expect(deleted.body.meta).toMatchObject({ total: 1 });
    expect(numbers(await list({}))).toEqual([2]);
    expect(numbers(await list({ deleted: 'false' }))).toEqual([2]);
    expect(numbers(await list({ deleted: 'true', moduleNumber: 1, status: 'DRAFT', search: 'gone' }))).toEqual([1]);
    expect(numbers(await list({ deleted: 'true', search: 'kept' }))).toEqual([]);
    expect(numbers(await list({ deleted: 'true', moduleNumber: 2 }))).toEqual([]);
    expect((await list({ deleted: 'true', limit: 1, page: 2 })).body.meta).toEqual({ page: 2, limit: 1, total: 1, totalPages: 1 });
    expect((await list({ deleted: 'yes' })).status).toBe(422);

    expect((await request(app).post(`${BASE}/${gone.id}/restore`).set(auth(admin.token))).status).toBe(200);
    expect(numbers(await list({ deleted: 'true' }))).toEqual([]);
    expect(numbers(await list({}))).toEqual([1, 2]);
  });
});

describe('Module Master — permissions', () => {
  it('requires a session', async () => {
    expect((await request(app).get(BASE)).status).toBe(401);
  });

  it('lets a viewer read but not write', async () => {
    const id = await moduleOf(full, 1);
    expect((await request(app).get(BASE).set(auth(viewer.token))).status).toBe(200);
    expect((await request(app).get(`${BASE}/${id}`).set(auth(viewer.token))).status).toBe(200);
    expect((await create({ courseId: custom, moduleNumber: 2, title: 'Viewer Made' }, viewer.token)).status).toBe(403);
    expect((await request(app).post(`${BASE}/prescribed`).set(auth(viewer.token)).send({ courseId: custom })).status).toBe(403);
    expect((await request(app).patch(`${BASE}/${id}`).set(auth(viewer.token)).send({ title: 'Viewer Edit' })).status).toBe(403);
    expect((await request(app).patch(`${BASE}/${id}/status`).set(auth(viewer.token)).send({ isActive: false })).status).toBe(403);
    expect((await request(app).delete(`${BASE}/${id}`).set(auth(viewer.token))).status).toBe(403);
    expect((await request(app).post(`${BASE}/${id}/restore`).set(auth(viewer.token))).status).toBe(403);
  });

  it('refuses module routes without a module permission; the options feed follows the Track Variant master', async () => {
    expect((await request(app).get(BASE).set(auth(nobody.token))).status).toBe(403);
    expect((await request(app).get(`${BASE}/prescribed`).set(auth(nobody.token))).status).toBe(403);
    expect((await request(app).get(`${BASE}/options`).set(auth(nobody.token))).status).toBe(403);
    expect((await request(app).get(`${BASE}/options`).set(auth(variantViewer.token))).status).toBe(200);
    expect((await request(app).get(BASE).set(auth(variantViewer.token))).status).toBe(403);
  });
});
