import type { Express } from 'express';
import { AppDataSource } from '../../../src/config/database.config';
import { API, actorWith, auth, request, setupTestApp, superAdmin, teardownTestApp, type TestActor } from '../../helpers/test-app';

/*
 * Track Variant Master (AMRUT_KALASH_03 L-07 / FR-307, UI-317; F-LMS-29, F-LMS-32) — /api/v1/lms/track-variants.
 * Fixtures: an LMS entity (tracks T01, T03, T07, T12 enabled), a course and its Module 1 / Module 3 created
 * through the Entity, Course and Module APIs. The twelve technology tracks come from the TechnologyTracks
 * migration (kept on reset).
 */
const BASE = `${API}/lms/track-variants`;
const MISSING_ID = '00000000-0000-4000-8000-000000000000';

let app: Express;
let admin: TestActor;
let viewer: TestActor;
let nobody: TestActor;
let entityId: string;
let courseId: string;
let module1: string;
let module3: string;
const tracks: Record<string, string> = {};

type Body = Record<string, unknown>;

const post = (path: string, body: Body, token = admin.token) => request(app).post(path).set(auth(token)).send(body);
const patch = (path: string, body: Body, token = admin.token) => request(app).patch(path).set(auth(token)).send(body);
const get = (path: string, token = admin.token) => request(app).get(path).set(auth(token));
const del = (path: string, token = admin.token) => request(app).delete(path).set(auth(token));

async function ok<T = Body>(res: { status: number; body: { data: T } }, status = 201): Promise<T> {
  if (res.status !== status) throw new Error(`expected ${status}, got ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body.data;
}

const makeVariant = async (trackCode: string, extra: Body = {}) =>
  ok<{ id: string }>(await post(BASE, { courseModuleId: module3, trackId: tracks[trackCode], ...extra }));

const fields = (res: { body: { error: { details: { field: string }[] } } }) => res.body.error.details.map((d) => d.field);

/* Valid item bodies. */
const oftBody = (code: string, extra: Body = {}): Body => ({
  oftCode: code,
  title: `Field task ${code}`,
  instructions: 'Visit a local business and document its digital security practices in detail.',
  hoursMin: 15,
  hoursMax: 20,
  deliverable: 'A short field report with findings',
  evidenceTypes: ['PHOTOGRAPH', 'FIELD_LOG'],
  ...extra,
});

const gateBody = (gateNumber: number, heldAfterTrackModuleId: string, extra: Body = {}): Body => ({
  gateNumber,
  title: `Readiness gate ${gateNumber}`,
  heldAfterTrackModuleId,
  demonstration: 'The learner demonstrates the skills of the phase on a live task.',
  evidenceTypes: ['DOCUMENT'],
  remediationPath: 'Repeat the practical tasks of the phase with the trainer.',
  ...extra,
});

/*
 * Builds the full Module 3 shape on a variant: 7 phases, 22 track modules (in phases 1–6, so phase 7 can be
 * removed for TC-359), 12 OFT cards, 6 gates, 10 assessment components and the five learning components.
 */
async function buildComplete(variantId: string, trackCode: string): Promise<{ phases: string[]; modules: string[]; gates: string[]; cards: string[] }> {
  const v = `${BASE}/${variantId}`;
  const phases: string[] = [];
  for (let n = 1; n <= 7; n++) phases.push((await ok<{ id: string }>(await post(`${v}/phases`, { phaseNumber: n, title: `Phase ${n} title` }))).id);
  const modules: string[] = [];
  for (let n = 1; n <= 22; n++) {
    const body = { phaseId: phases[Math.min(5, Math.floor((n - 1) / 4))], code: `TM-${n}`, title: `Track module ${n}`, sortOrder: n, lectureHours: 7, practicalHours: 6 };
    modules.push((await ok<{ id: string }>(await post(`${v}/track-modules`, body))).id);
  }
  const cards: string[] = [];
  for (let n = 1; n <= 12; n++) {
    cards.push((await ok<{ id: string }>(await post(`${v}/oft-cards`, oftBody(`OFT-M3-${trackCode}-${String(n).padStart(2, '0')}`)))).id);
  }
  const gates: string[] = [];
  for (let n = 1; n <= 6; n++) gates.push((await ok<{ id: string }>(await post(`${v}/readiness-gates`, gateBody(n, modules[n * 3])))).id);
  for (let n = 1; n <= 10; n++) await ok(await post(`${v}/assessment-components`, { componentCode: `C${n}`, label: `Component ${n}`, sortOrder: n }));
  for (const kind of ['MINI_PROJECT', 'INTEGRATION_PROJECT', 'CAPSTONE_PROJECT', 'BUSINESS_SIMULATION', 'PORTFOLIO']) {
    await ok(await post(`${v}/learning-components`, { kind, title: `${kind} item` }));
  }
  return { phases, modules, gates, cards };
}

beforeAll(async () => {
  app = await setupTestApp();
  admin = await superAdmin();
  viewer = await actorWith(['lms-track-variants.view']);
  nobody = await actorWith(['lms-reference.view']);

  const rows: { id: string; code: string }[] = await AppDataSource.query(`SELECT "id", "code" FROM "technology_tracks" WHERE "isDelete" = false`);
  for (const r of rows) tracks[r.code] = r.id;

  const entity = await ok<{ id: string }>(
    await post(`${API}/lms/entities`, { name: 'Sarthi', code: 'AMK', defaultLanguage: 'en', trackIds: [tracks.T01, tracks.T03, tracks.T07, tracks.T12] }),
  );
  entityId = entity.id;
  courseId = (await ok<{ id: string }>(await post(`${API}/lms/courses`, { entityId, code: 'AMK-COURSE', title: 'Sarthi Programme' }))).id;
  module1 = (await ok<{ id: string }>(await post(`${API}/lms/course-modules`, { courseId, moduleNumber: 1, title: 'Personality Development' }))).id;
  module3 = (
    await ok<{ id: string }>(
      await post(`${API}/lms/course-modules`, {
        courseId,
        moduleNumber: 3,
        title: 'Domain-Specific Basic Digital Skills',
        coreHours: 300,
        syllabusRef: 'Module 3 curriculum index',
        lectureHours: 150,
        practicalHours: 150,
        oftHoursMin: 210,
        oftHoursMax: 240,
      }),
    )
  ).id;
});
afterAll(teardownTestApp);

describe('Track Variant Master — create and read', () => {
  it('creates a DRAFT variant for a Module 3 module and an enabled track, reporting it incomplete', async () => {
    const res = await post(BASE, { courseModuleId: module3, trackId: tracks.T07, expectedTrackModules: 23, syllabusReference: '  T07 syllabus v1 ' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      courseModuleId: module3,
      trackId: tracks.T07,
      course: { id: courseId, code: 'AMK-COURSE', title: 'Sarthi Programme', entityId },
      courseModule: { id: module3, moduleNumber: 3, coreHours: 300, oftHoursMin: 210, oftHoursMax: 240 },
      /* L-07: the track name equals the Admin Panel reference record. */
      track: { id: tracks.T07, code: 'T07', name: 'Cyber Security', isActive: true },
      status: 'DRAFT',
      expectedTrackModules: 23,
      expectedOftCards: null,
      syllabusReference: 'T07 syllabus v1',
      description: null,
      publishedAt: null,
      isActive: true,
    });
    const c = res.body.data.completeness;
    expect(c).toMatchObject({
      complete: false,
      phases: { actual: 0, required: 7 },
      trackModules: { actual: 0, required: 23 },
      oftCards: { actual: 0, required: null },
      readinessGates: { actual: 0, required: 6 },
      assessmentComponents: { actual: 0, required: 10, weightTotal: null },
      warnings: [],
    });
    expect(c.missing.map((m: { item: string }) => m.item)).toEqual(
      expect.arrayContaining(['phases', 'trackModules', 'oftCards', 'readinessGates', 'assessmentComponents', 'learningComponents']),
    );
    expect(c.missing).toContainEqual({ item: 'oftCards', message: 'Enter the number of OFT cards from the track syllabus.' });

    const audit: { action: string; details: { trackCode: string } }[] = await AppDataSource.query(
      `SELECT "action", "details" FROM "audit_logs" WHERE "resource" = 'lms-track-variant' AND "resourceId" = $1`,
      [res.body.data.id],
    );
    expect(audit).toEqual([expect.objectContaining({ action: 'lms.track-variant.create', details: expect.objectContaining({ trackCode: 'T07' }) })]);
  });

  it('refuses a second variant for the same module and track (409 with the field)', async () => {
    const res = await post(BASE, { courseModuleId: module3, trackId: tracks.T07 });
    expect(res.status).toBe(409);
    expect(res.body.error.details).toEqual([{ field: 'trackId', message: 'A variant for this track already exists.' }]);
  });

  it('refuses a module other than Module 3, a track not enabled for the entity, and unknown references (400)', async () => {
    const m1 = await post(BASE, { courseModuleId: module1, trackId: tracks.T03 });
    expect(m1.status).toBe(400);
    expect(m1.body.error.details).toEqual([{ field: 'courseModuleId', message: 'Select a Module 3 course module.' }]);

    const notEnabled = await post(BASE, { courseModuleId: module3, trackId: tracks.T08 });
    expect(notEnabled.status).toBe(400);
    expect(notEnabled.body.error.details[0]).toMatchObject({ field: 'trackId', message: 'Choose a track enabled for the entity' });

    expect(fields(await post(BASE, { courseModuleId: MISSING_ID, trackId: tracks.T03 }))).toEqual(['courseModuleId']);
    expect((await post(BASE, { courseModuleId: module3, trackId: MISSING_ID })).status).toBe(400);
  });

  it('refuses invalid fields with 422 and the field name', async () => {
    const bad = async (body: Body, field: string) => {
      const res = await post(BASE, { courseModuleId: module3, trackId: tracks.T01, ...body });
      expect(res.status).toBe(422);
      expect(fields(res)).toContain(field);
    };
    await bad({ expectedTrackModules: 21 }, 'body.expectedTrackModules');
    await bad({ expectedTrackModules: 24 }, 'body.expectedTrackModules');
    await bad({ expectedOftCards: 11 }, 'body.expectedOftCards');
    await bad({ expectedOftCards: 12.5 }, 'body.expectedOftCards');
    await bad({ syllabusReference: 'x'.repeat(121) }, 'body.syllabusReference');
    await bad({ description: '<script>alert(1)</script>' }, 'body.description');
    await bad({ status: 'PUBLISHED' }, 'body');
    await bad({ trackId: 'nope' }, 'body.trackId');
    expect((await get(`${BASE}/not-a-uuid`)).status).toBe(422);
    expect((await get(`${BASE}/${MISSING_ID}`)).status).toBe(404);
  });

  it('serves the form options with the Module 3 shape', async () => {
    const res = await get(`${BASE}/form-options`, viewer.token);
    expect(res.status).toBe(200);
    expect(res.body.data.shape).toEqual({
      phases: 7,
      readinessGates: 6,
      trackModules: { min: 22, max: 23 },
      oftCards: { min: 12, max: 13 },
      assessmentComponents: 10,
    });
    expect(res.body.data.clearanceModes).toEqual(['ASSESSOR_DECIDES', 'MINIMUM_BAND']);
  });
});

describe('Track Variant Master — update and status', () => {
  it('updates the structure counts and text, audits before / after, and refuses an empty update', async () => {
    const v = await makeVariant('T12');
    const res = await request(app).put(`${BASE}/${v.id}`).set(auth(admin.token)).send({ expectedTrackModules: 22, expectedOftCards: 13, description: 'Outcomes' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ expectedTrackModules: 22, expectedOftCards: 13, description: 'Outcomes' });
    expect(res.body.data.completeness.oftCards.required).toBe(13);

    const cleared = await patch(`${BASE}/${v.id}`, { description: '', expectedOftCards: null });
    expect(cleared.body.data).toMatchObject({ description: null, expectedOftCards: null });

    const audit: { details: { fields: string[]; before: Body } }[] = await AppDataSource.query(
      `SELECT "details" FROM "audit_logs" WHERE "action" = 'lms.track-variant.update' AND "resourceId" = $1 ORDER BY "createdAt" LIMIT 1`,
      [v.id],
    );
    expect(audit[0].details.fields).toEqual(expect.arrayContaining(['expectedTrackModules', 'expectedOftCards', 'description']));
    expect(audit[0].details.before).toMatchObject({ expectedTrackModules: null, description: null });

    expect((await patch(`${BASE}/${v.id}`, {})).status).toBe(422);
    /* Module and track are fixed on creation. */
    expect((await patch(`${BASE}/${v.id}`, { trackId: tracks.T01 })).status).toBe(422);
    expect((await patch(`${BASE}/${MISSING_ID}`, { description: 'Ghost' })).status).toBe(404);
  });

  it('activates and deactivates; an inactive variant leaves the options feed', async () => {
    const v = await makeVariant('T01');
    const off = await patch(`${BASE}/${v.id}/status`, { isActive: false });
    expect(off.status).toBe(200);
    expect(off.body.data.isActive).toBe(false);
    expect(off.body.message).toBe('Track variant deactivated');
    let options = await get(`${BASE}/options?courseModuleId=${module3}`, viewer.token);
    expect(options.body.data.map((o: { id: string }) => o.id)).not.toContain(v.id);
    await patch(`${BASE}/${v.id}/status`, { isActive: true }).expect(200);
    options = await get(`${BASE}/options`, viewer.token);
    expect(options.body.data).toContainEqual({ id: v.id, name: 'Data Analytics & Business Intelligence', code: 'T01' });
  });
});

describe('Track Variant Master — curriculum, completeness and publish (TC-359)', () => {
  let variant: string;
  let built: Awaited<ReturnType<typeof buildComplete>>;

  beforeAll(async () => {
    variant = (await makeVariant('T03', { expectedTrackModules: 22, expectedOftCards: 12 })).id;
    built = await buildComplete(variant, 'T03');
  });

  it('reports a variant with the whole shape as complete, with hour totals', async () => {
    const res = await get(`${BASE}/${variant}`);
    expect(res.status).toBe(200);
    expect(res.body.data.completeness).toMatchObject({
      complete: true,
      phases: { actual: 7, required: 7 },
      trackModules: { actual: 22, required: 22 },
      oftCards: { actual: 12, required: 12, hoursMin: 180, hoursMax: 240 },
      readinessGates: { actual: 6, required: 6 },
      assessmentComponents: { actual: 10, required: 10, weightTotal: null },
      learningComponents: { MINI_PROJECT: 1, INTEGRATION_PROJECT: 1, CAPSTONE_PROJECT: 1, BUSINESS_SIMULATION: 1, PORTFOLIO: 1 },
      missing: [],
    });
    /* L-08: 22 × 13 = 286 hours against the module's 300 core hours — a warning, not a block. */
    expect(res.body.data.completeness.warnings).toEqual([expect.objectContaining({ item: 'trackModuleHours' })]);

    const phases = await get(`${BASE}/${variant}/phases`, viewer.token);
    expect(phases.body.data.map((p: { phaseNumber: number }) => p.phaseNumber)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    const gates = await get(`${BASE}/${variant}/readiness-gates/${built.gates[0]}`, viewer.token);
    expect(gates.body.data).toMatchObject({ gateNumber: 1, clearanceMode: 'ASSESSOR_DECIDES', clearanceMinBand: null, evidenceTypes: ['DOCUMENT'] });
  });

  it('reports six phases and five gates as incomplete and refuses to publish (TC-359)', async () => {
    await del(`${BASE}/${variant}/phases/${built.phases[6]}`).expect(200);
    await del(`${BASE}/${variant}/readiness-gates/${built.gates[5]}`).expect(200);

    const res = await get(`${BASE}/${variant}`);
    expect(res.body.data.completeness.complete).toBe(false);
    expect(res.body.data.completeness.missing).toEqual([
      { item: 'phases', message: '6 of 7 phases; missing phase 7.' },
      { item: 'readinessGates', message: '5 of 6 readiness gates; missing gate 6.' },
    ]);

    const publish = await post(`${BASE}/${variant}/publish`, {});
    expect(publish.status).toBe(409);
    expect(publish.body.error.details.map((d: { field: string }) => d.field)).toEqual(['phases', 'readinessGates']);

    /* Listing by completeness agrees with the detail. */
    const incomplete = await get(`${BASE}?completeness=incomplete&limit=100`, viewer.token);
    expect(incomplete.body.data.map((v: { id: string }) => v.id)).toContain(variant);

    await ok(await post(`${BASE}/${variant}/phases`, { phaseNumber: 7, title: 'Phase 7 title' }));
    built.gates[5] = (await ok<{ id: string }>(await post(`${BASE}/${variant}/readiness-gates`, gateBody(6, built.modules[18])))).id;
    const complete = await get(`${BASE}?completeness=complete&limit=100`, viewer.token);
    expect(complete.body.data.map((v: { id: string }) => v.id)).toEqual([variant]);
  });

  it('publishes a complete variant with its OFT cards, then freezes the OFT codes', async () => {
    const res = await post(`${BASE}/${variant}/publish`, {});
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('PUBLISHED');
    expect(res.body.data.publishedAt).toEqual(expect.any(String));

    const card = await get(`${BASE}/${variant}/oft-cards/${built.cards[0]}`);
    expect(card.body.data).toMatchObject({ status: 'PUBLISHED', oftCode: 'OFT-M3-T03-01', hoursMin: 15, hoursMax: 20 });

    /* F-LMS-29-01 immutable once released; other fields stay editable in the draft. */
    const recode = await patch(`${BASE}/${variant}/oft-cards/${built.cards[0]}`, { oftCode: 'OFT-M3-T03-99' });
    expect(recode.status).toBe(409);
    expect(recode.body.error.details[0]).toMatchObject({ field: 'oftCode' });
    expect((await patch(`${BASE}/${variant}/oft-cards/${built.cards[0]}`, { title: 'Renamed field task' })).status).toBe(200);

    /* A published card is retired, never deleted; a retired card no longer counts. */
    expect((await del(`${BASE}/${variant}/oft-cards/${built.cards[11]}`)).status).toBe(409);
    const retired = await post(`${BASE}/${variant}/oft-cards/${built.cards[11]}/retire`, {});
    expect(retired.status).toBe(200);
    expect(retired.body.data.status).toBe('RETIRED');
    expect((await patch(`${BASE}/${variant}/oft-cards/${built.cards[11]}`, { title: 'Too late' })).status).toBe(409);
    const detail = await get(`${BASE}/${variant}`);
    expect(detail.body.data.completeness.oftCards).toMatchObject({ actual: 11, required: 12 });
    expect(detail.body.data.completeness.complete).toBe(false);

    /* A published variant is retired, never deleted. */
    const delPublished = await del(`${BASE}/${variant}`);
    expect(delPublished.status).toBe(409);
  });

  it('keeps the curriculum consistent: references inside the variant, gate order, delete guards', async () => {
    const v = `${BASE}/${variant}`;
    /* A phase with track modules and a track module held by a gate cannot be deleted. */
    const phaseDel = await del(`${v}/phases/${built.phases[0]}`);
    expect(phaseDel.status).toBe(409);
    expect(phaseDel.body.message).toMatch(/associated with existing track modules \(4\)/);
    const moduleDel = await del(`${v}/track-modules/${built.modules[3]}`);
    expect(moduleDel.status).toBe(409);
    expect(moduleDel.body.message).toMatch(/associated with existing readiness gates \(1\)/);

    /* Gate order follows track-module order (F-LMS-32-04). */
    const outOfOrder = await patch(`${v}/readiness-gates/${built.gates[1]}`, { heldAfterTrackModuleId: built.modules[0] });
    expect(outOfOrder.status).toBe(400);
    expect(outOfOrder.body.error.details[0]).toMatchObject({ field: 'heldAfterTrackModuleId' });
    const reorder = await patch(`${v}/track-modules/${built.modules[6]}`, { sortOrder: 99 });
    expect(reorder.status).toBe(409);
    expect(reorder.body.error.details[0]).toMatchObject({ field: 'sortOrder' });

    /* Duplicates per variant. */
    const dupGate = await post(`${v}/readiness-gates`, gateBody(2, built.modules[20]));
    expect(dupGate.status).toBe(409);
    expect(dupGate.body.error.details).toEqual([{ field: 'gateNumber', message: 'This gate already exists for the track.' }]);
    expect((await post(`${v}/readiness-gates`, gateBody(7, built.modules[20]))).status).toBe(422);
    const dupCard = await post(`${v}/oft-cards`, oftBody('OFT-M3-T03-02'));
    expect(dupCard.status).toBe(409);
    expect(dupCard.body.error.details).toEqual([{ field: 'oftCode', message: 'This OFT code is already used in this module.' }]);
    const dupCapstone = await post(`${v}/learning-components`, { kind: 'CAPSTONE_PROJECT', title: 'Second capstone' });
    expect(dupCapstone.status).toBe(409);
    expect(dupCapstone.body.error.details[0]).toMatchObject({ field: 'kind' });
    expect((await post(`${v}/learning-components`, { kind: 'MINI_PROJECT', title: 'Second mini project' })).status).toBe(201);
    expect((await post(`${v}/phases`, { phaseNumber: 3, title: 'Again' })).status).toBe(409);
    expect((await post(`${v}/phases`, { phaseNumber: 8, title: 'Eighth' })).status).toBe(422);
    expect((await post(`${v}/assessment-components`, { componentCode: 'C11', label: 'Eleventh', sortOrder: 11 })).status).toBe(422);
    const dupModule = await post(`${v}/track-modules`, { phaseId: built.phases[0], code: 'tm-1', title: 'Duplicate code', sortOrder: 50 });
    expect(dupModule.status).toBe(409);
    expect(dupModule.body.error.details[0]).toMatchObject({ field: 'code' });

    /* Items of another variant are refused (400 with the field). */
    const [other] = (await get(`${BASE}?trackId=${tracks.T07}`)).body.data;
    const otherPhase = await ok<{ id: string }>(await post(`${BASE}/${other.id}/phases`, { phaseNumber: 1, title: 'Other phase' }));
    const foreign = await post(`${v}/track-modules`, { phaseId: otherPhase.id, code: 'TM-X', title: 'Foreign phase', sortOrder: 60 });
    expect(foreign.status).toBe(400);
    expect(foreign.body.error.details).toEqual([{ field: 'phaseId', message: 'Select a phase of this variant.' }]);
    expect((await get(`${BASE}/${other.id}/phases/${built.phases[0]}`)).status).toBe(404);
  });

  it('applies the OFT card field rules (F-LMS-29)', async () => {
    const v = `${BASE}/${variant}`;
    const otherTrack = await post(`${v}/oft-cards`, oftBody('OFT-M3-T07-13'));
    expect(otherTrack.status).toBe(400);
    expect(otherTrack.body.error.details[0]).toMatchObject({ field: 'oftCode', message: 'Use the pattern OFT-M3-T03-{nn}, for example OFT-M3-T03-01.' });

    const bad = async (body: Body, field: string) => {
      const res = await post(`${v}/oft-cards`, oftBody('OFT-M3-T03-13', body));
      expect(res.status).toBe(422);
      expect(fields(res)).toContain(field);
    };
    await bad({ oftCode: 'OFT-M1-01' }, 'body.oftCode');
    await bad({ title: 'Ab' }, 'body.title');
    await bad({ instructions: 'Too short' }, 'body.instructions');
    await bad({ instructions: 'Long enough text but <script>alert(1)</script>' }, 'body.instructions');
    /* Allow-list, not a pattern of known attacks: markup the old script check let through is refused too. */
    await bad({ instructions: 'Long enough text <iframe src="https://example.org/x"></iframe>' }, 'body.instructions');
    await bad({ instructions: 'Long enough text <a href="jav&#x61;script:alert(1)">open</a>' }, 'body.instructions');
    await bad({ instructions: 'Long enough text <img src="https://example.org/x.png">' }, 'body.instructions');
    await bad({ hoursMin: 0 }, 'body.hoursMin');
    await bad({ hoursMin: 25, hoursMax: 20 }, 'body.hoursMax');
    await bad({ deliverable: 'Short' }, 'body.deliverable');
    await bad({ evidenceTypes: [] }, 'body.evidenceTypes');
    await bad({ evidenceTypes: ['SELFIE'] }, 'body.evidenceTypes.0');
    await bad({ stage: 'x'.repeat(61) }, 'body.stage');

    /* Lower case is upper-cased; host verification defaults off; the linked module must be of this variant. */
    const res = await post(
      `${v}/oft-cards`,
      oftBody('oft-m3-t03-13', {
        linkedTrackModuleId: built.modules[2],
        stage: 'Stage A',
        /* Allow-listed rich text is accepted as sent. */
        instructions: '<p>Visit a <strong>local</strong> business; see <a href="https://example.org/guide">the guide</a>.</p>',
      }),
    );
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ oftCode: 'OFT-M3-T03-13', hostVerificationRequired: false, status: 'DRAFT', linkedTrackModuleId: built.modules[2] });
    /* Update merges the hours with the stored range. */
    const range = await patch(`${v}/oft-cards/${res.body.data.id}`, { hoursMin: 30 });
    expect(range.status).toBe(400);
    expect(range.body.error.details[0]).toMatchObject({ field: 'hoursMax' });
    /* A draft card may be deleted. */
    expect((await del(`${v}/oft-cards/${res.body.data.id}`)).status).toBe(200);
  });

  it('applies the readiness gate clearance rule and the assessment weights rule', async () => {
    const v = `${BASE}/${variant}`;
    const noBand = await patch(`${v}/readiness-gates/${built.gates[2]}`, { clearanceMode: 'MINIMUM_BAND' });
    expect(noBand.status).toBe(400);
    expect(noBand.body.error.details[0]).toMatchObject({ field: 'clearanceMinBand' });
    const band = await patch(`${v}/readiness-gates/${built.gates[2]}`, { clearanceMode: 'MINIMUM_BAND', clearanceMinBand: 3 });
    expect(band.body.data).toMatchObject({ clearanceMode: 'MINIMUM_BAND', clearanceMinBand: 3 });
    const back = await patch(`${v}/readiness-gates/${built.gates[2]}`, { clearanceMode: 'ASSESSOR_DECIDES' });
    expect(back.body.data).toMatchObject({ clearanceMode: 'ASSESSOR_DECIDES', clearanceMinBand: null });
    expect((await patch(`${v}/readiness-gates/${built.gates[2]}`, { clearanceMinBand: 6 })).status).toBe(422);
    /* The gate number is fixed on creation. */
    expect((await patch(`${v}/readiness-gates/${built.gates[2]}`, { gateNumber: 4 })).status).toBe(422);

    /* Weights are To Be Confirmed: once one is entered, all must be and they must total 100. */
    const comps = await get(`${v}/assessment-components`);
    const ids: string[] = comps.body.data.map((c: { id: string }) => c.id);
    await patch(`${v}/assessment-components/${ids[0]}`, { weight: 40, source: 'Syllabus (indicative)' }).expect(200);
    let detail = await get(`${BASE}/${variant}`);
    expect(detail.body.data.completeness.missing).toContainEqual(expect.objectContaining({ item: 'assessmentWeights' }));
    expect(detail.body.data.completeness.assessmentComponents.weightTotal).toBe(40);
    for (const id of ids.slice(1)) await patch(`${v}/assessment-components/${id}`, { weight: 6.67 }).expect(200);
    detail = await get(`${BASE}/${variant}`);
    expect(detail.body.data.completeness.assessmentComponents.weightTotal).toBe(100.03);
    /* Changing an entered weight needs the reference of the prescribing decision (F-LMS-18-10). */
    const noRef = await patch(`${v}/assessment-components/${ids[1]}`, { weight: 6.64 });
    expect(noRef.status).toBe(400);
    expect(noRef.body.error.details).toEqual([{ field: 'source', message: 'Enter the reference for this change.' }]);
    await patch(`${v}/assessment-components/${ids[1]}`, { weight: 6.64, source: 'Decision ref 12' }).expect(200);
    detail = await get(`${BASE}/${variant}`);
    expect(detail.body.data.completeness.assessmentComponents.weightTotal).toBe(100);
    expect(detail.body.data.completeness.missing.map((m: { item: string }) => m.item)).not.toContain('assessmentWeights');
  });

  it('accepts two-decimal hours and weights that are inexact in binary (2.3, 8.2, 1.15, 0.29), refuses a third decimal', async () => {
    const v = `${BASE}/${variant}`;
    /* 2.3 * 100 = 229.99999999999997 and 8.2 * 100 = 819.9999999999999 in floating point; both are valid numeric(6,2). */
    const tm = await post(`${v}/track-modules`, { phaseId: built.phases[0], code: 'TM-DEC', title: 'Decimal hours', sortOrder: 40, lectureHours: 8.2, practicalHours: 1.15 });
    expect(tm.status).toBe(201);
    expect(tm.body.data).toMatchObject({ lectureHours: 8.2, practicalHours: 1.15 });
    const tmPatch = await patch(`${v}/track-modules/${tm.body.data.id}`, { lectureHours: 0.29, practicalHours: 2.3 });
    expect(tmPatch.status).toBe(200);
    expect(tmPatch.body.data).toMatchObject({ lectureHours: 0.29, practicalHours: 2.3 });
    const tmBad = await patch(`${v}/track-modules/${tm.body.data.id}`, { lectureHours: 2.345 });
    expect(tmBad.status).toBe(422);
    expect(fields(tmBad)).toContain('body.lectureHours');
    expect((await del(`${v}/track-modules/${tm.body.data.id}`)).status).toBe(200);

    const card = await post(`${v}/oft-cards`, oftBody('OFT-M3-T03-14', { hoursMin: 2.3, hoursMax: 8.2 }));
    expect(card.status).toBe(201);
    expect(card.body.data).toMatchObject({ hoursMin: 2.3, hoursMax: 8.2 });
    const cardPatch = await patch(`${v}/oft-cards/${card.body.data.id}`, { hoursMin: 1.15 });
    expect(cardPatch.status).toBe(200);
    expect(cardPatch.body.data).toMatchObject({ hoursMin: 1.15, hoursMax: 8.2 });
    const cardBad = await post(`${v}/oft-cards`, oftBody('OFT-M3-T03-15', { hoursMin: 2.3, hoursMax: 2.300000001 }));
    expect(cardBad.status).toBe(422);
    expect(fields(cardBad)).toContain('body.hoursMax');
    expect((await del(`${v}/oft-cards/${card.body.data.id}`)).status).toBe(200);

    const ids: string[] = (await get(`${v}/assessment-components`)).body.data.map((c: { id: string }) => c.id);
    const weight = await patch(`${v}/assessment-components/${ids[2]}`, { weight: 8.2, source: 'Decision ref 13' });
    expect(weight.status).toBe(200);
    expect(weight.body.data.weight).toBe(8.2);
    expect((await patch(`${v}/assessment-components/${ids[2]}`, { weight: 0.29, source: 'Decision ref 14' })).body.data.weight).toBe(0.29);
    const weightBad = await patch(`${v}/assessment-components/${ids[2]}`, { weight: 6.675, source: 'Decision ref 15' });
    expect(weightBad.status).toBe(422);
    expect(fields(weightBad)).toContain('body.weight');
    await patch(`${v}/assessment-components/${ids[2]}`, { weight: 6.67, source: 'Decision ref 16' }).expect(200);
    expect((await get(v)).body.data.completeness.assessmentComponents.weightTotal).toBe(100);
  });
});

describe('Track Variant Master — listing', () => {
  it('searches, filters by track / status / course, sorts by track order and pages', async () => {
    const byName = await get(`${BASE}?search=cyber`, viewer.token);
    expect(byName.status).toBe(200);
    expect(byName.body.data.map((v: { track: { code: string } }) => v.track.code)).toEqual(['T07']);
    expect(byName.body.data[0].completeness).toBeDefined();

    const byTrack = await get(`${BASE}?trackId=${tracks.T03}`, viewer.token);
    expect(byTrack.body.data.map((v: { status: string }) => v.status)).toEqual(['PUBLISHED']);
    const drafts = await get(`${BASE}?status=DRAFT&limit=100`, viewer.token);
    expect(drafts.body.data.every((v: { status: string }) => v.status === 'DRAFT')).toBe(true);
    const byCourse = await get(`${BASE}?courseId=${courseId}&limit=100`, viewer.token);
    expect(byCourse.body.meta.total).toBe(4);

    const sorted = await get(`${BASE}?sortBy=track&limit=100`, viewer.token);
    expect(sorted.body.data.map((v: { track: { code: string } }) => v.track.code)).toEqual(['T01', 'T03', 'T07', 'T12']);
    const desc = await get(`${BASE}?sortBy=track&sortOrder=desc&limit=100`, viewer.token);
    expect(desc.body.data.map((v: { track: { code: string } }) => v.track.code)).toEqual(['T12', 'T07', 'T03', 'T01']);

    const paged = await get(`${BASE}?sortBy=track&limit=2&page=2`, viewer.token);
    expect(paged.body.data.map((v: { track: { code: string } }) => v.track.code)).toEqual(['T07', 'T12']);
    expect(paged.body.meta).toMatchObject({ page: 2, limit: 2, total: 4 });

    expect((await get(`${BASE}?sortBy=description`, viewer.token)).status).toBe(422);
    expect((await get(`${BASE}?completeness=maybe`, viewer.token)).status).toBe(422);
    const unknownTrack = await get(`${BASE}?trackId=${MISSING_ID}`, viewer.token);
    expect(unknownTrack.status).toBe(400);
    expect(unknownTrack.body.error.details[0]).toMatchObject({ field: 'trackId' });
  });

  it('keeps a variant whose track the Admin Panel deactivated, but refuses a new one for that track', async () => {
    await AppDataSource.query(`UPDATE "technology_tracks" SET "isActive" = false WHERE "code" = 'T12'`);
    try {
      const list = await get(`${BASE}?trackId=${tracks.T12}`, viewer.token);
      expect(list.body.data[0].track).toMatchObject({ code: 'T12', isActive: false });
      const other = await ok<{ id: string }>(await post(`${API}/lms/courses`, { entityId, code: 'SECOND', title: 'Second course' }));
      const m3 = await ok<{ id: string }>(await post(`${API}/lms/course-modules`, { courseId: other.id, moduleNumber: 3, title: 'Module three' }));
      const res = await post(BASE, { courseModuleId: m3.id, trackId: tracks.T12 });
      expect(res.status).toBe(400);
      expect(res.body.error.details[0]).toMatchObject({ field: 'trackId' });
    } finally {
      await AppDataSource.query(`UPDATE "technology_tracks" SET "isActive" = true WHERE "code" = 'T12'`);
    }
  });
});

describe('Track Variant Master — retire, delete and restore', () => {
  it('retires a published variant, which is then read-only', async () => {
    const [published] = (await get(`${BASE}?trackId=${tracks.T03}`)).body.data;
    /* Only a published variant can be retired; a draft is deleted instead. */
    const [draft] = (await get(`${BASE}?trackId=${tracks.T01}`)).body.data;
    const draftRetire = await post(`${BASE}/${draft.id}/retire`, {});
    expect(draftRetire.status).toBe(409);
    expect(draftRetire.body.error.details).toEqual([{ field: 'status', message: 'Delete a draft variant instead.' }]);
    const res = await post(`${BASE}/${published.id}/retire`, {});
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('RETIRED');
    expect((await patch(`${BASE}/${published.id}`, { description: 'Edit' })).status).toBe(409);
    expect((await post(`${BASE}/${published.id}/phases`, { phaseNumber: 1, title: 'Late phase' })).status).toBe(409);
    expect((await post(`${BASE}/${published.id}/publish`, {})).status).toBe(409);
    expect((await post(`${BASE}/${published.id}/retire`, {})).status).toBe(409);
    const options = await get(`${BASE}/options`, viewer.token);
    expect(options.body.data.map((o: { id: string }) => o.id)).not.toContain(published.id);
  });

  it('soft-deletes a draft variant, guards the course module, and restores it inactive', async () => {
    const [draft] = (await get(`${BASE}?trackId=${tracks.T07}`)).body.data;
    /* The Module master refuses to delete a module a variant uses (COURSE_MODULE_REFERENCES). */
    const moduleDel = await del(`${API}/lms/course-modules/${module3}`);
    expect(moduleDel.status).toBe(409);
    expect(moduleDel.body.message).toMatch(/track variant/);

    expect((await del(`${BASE}/${draft.id}`)).status).toBe(200);
    expect((await get(`${BASE}/${draft.id}`)).status).toBe(404);
    expect((await del(`${BASE}/${draft.id}`)).status).toBe(404);
    expect((await get(`${BASE}/${draft.id}/phases`)).status).toBe(404);

    const restored = await post(`${BASE}/${draft.id}/restore`, {});
    expect(restored.status).toBe(200);
    expect(restored.body.data).toMatchObject({ isActive: false, status: 'DRAFT', track: { code: 'T07' } });
    /* The curriculum survives the archive. */
    expect(restored.body.data.completeness.phases.actual).toBe(1);
    expect((await post(`${BASE}/${draft.id}/restore`, {})).status).toBe(409);
    expect((await post(`${BASE}/${MISSING_ID}/restore`, {})).status).toBe(404);

    /* A restore is refused once the (module, track) pair has been taken again. */
    await del(`${BASE}/${draft.id}`).expect(200);
    await makeVariant('T07');
    const taken = await post(`${BASE}/${draft.id}/restore`, {});
    expect(taken.status).toBe(409);
    expect(taken.body.error.details[0]).toMatchObject({ field: 'trackId' });
  });

  it('lists only the deleted variants with deleted=true (same search, filters and paging, view permission); a restore moves one back', async () => {
    const course = await ok<{ id: string }>(await post(`${API}/lms/courses`, { entityId, code: 'RECYCLE', title: 'Recycle Programme' }));
    const m3 = await ok<{ id: string }>(await post(`${API}/lms/course-modules`, { courseId: course.id, moduleNumber: 3, title: 'Recycle module three' }));
    const gone = await ok<{ id: string }>(await post(BASE, { courseModuleId: m3.id, trackId: tracks.T01 }));
    await ok(await post(BASE, { courseModuleId: m3.id, trackId: tracks.T12 }));
    expect((await del(`${BASE}/${gone.id}`)).status).toBe(200);
    const list = (qs: string) => get(`${BASE}?courseId=${course.id}&${qs}`, viewer.token);
    const trackCodes = (res: { body: { data: { track: { code: string } }[] } }) => res.body.data.map((v) => v.track.code);

    const deleted = await list('deleted=true');
    expect(deleted.status).toBe(200);
    expect(trackCodes(deleted)).toEqual(['T01']);
    expect(deleted.body.data[0]).toMatchObject({ id: gone.id, isActive: false, status: 'DRAFT', course: { code: 'RECYCLE' } });
    expect(deleted.body.data[0].completeness).toBeDefined();
    expect(deleted.body.meta).toMatchObject({ total: 1 });
    expect(trackCodes(await list(''))).toEqual(['T12']);
    expect(trackCodes(await list('deleted=false'))).toEqual(['T12']);
    expect(trackCodes(await list(`deleted=true&trackId=${tracks.T01}&status=DRAFT&completeness=incomplete&search=recycle`))).toEqual(['T01']);
    expect(trackCodes(await list(`deleted=true&trackId=${tracks.T12}`))).toEqual([]);
    expect(trackCodes(await list('deleted=true&completeness=complete'))).toEqual([]);
    expect((await list('deleted=true&limit=1&page=2')).body.meta).toEqual({ page: 2, limit: 1, total: 1, totalPages: 1 });
    expect((await list('deleted=yes')).status).toBe(422);

    expect((await post(`${BASE}/${gone.id}/restore`, {})).status).toBe(200);
    expect(trackCodes(await list('deleted=true'))).toEqual([]);
    expect(trackCodes(await list(''))).toEqual(['T01', 'T12']);
  });
});

describe('Track Variant Master — permissions', () => {
  it('requires a session', async () => {
    expect((await request(app).get(BASE)).status).toBe(401);
  });

  it('lets a viewer read the variants and their curriculum but not write', async () => {
    const [v] = (await get(`${BASE}?trackId=${tracks.T12}`)).body.data;
    expect((await get(BASE, viewer.token)).status).toBe(200);
    expect((await get(`${BASE}/${v.id}`, viewer.token)).status).toBe(200);
    expect((await get(`${BASE}/${v.id}/oft-cards`, viewer.token)).status).toBe(200);
    expect((await post(BASE, { courseModuleId: module3, trackId: tracks.T01 }, viewer.token)).status).toBe(403);
    expect((await patch(`${BASE}/${v.id}`, { description: 'Viewer' }, viewer.token)).status).toBe(403);
    expect((await patch(`${BASE}/${v.id}/status`, { isActive: false }, viewer.token)).status).toBe(403);
    expect((await post(`${BASE}/${v.id}/publish`, {}, viewer.token)).status).toBe(403);
    expect((await post(`${BASE}/${v.id}/phases`, { phaseNumber: 1, title: 'Viewer phase' }, viewer.token)).status).toBe(403);
    expect((await del(`${BASE}/${v.id}`, viewer.token)).status).toBe(403);
    expect((await post(`${BASE}/${v.id}/restore`, {}, viewer.token)).status).toBe(403);
  });

  it('refuses every route to a user without a track-variant permission; a creator cannot update', async () => {
    const [v] = (await get(`${BASE}?trackId=${tracks.T12}`)).body.data;
    expect((await get(BASE, nobody.token)).status).toBe(403);
    expect((await get(`${BASE}/options`, nobody.token)).status).toBe(403);
    expect((await get(`${BASE}/form-options`, nobody.token)).status).toBe(403);
    expect((await get(`${BASE}/${v.id}/phases`, nobody.token)).status).toBe(403);

    const creator = await actorWith(['lms-track-variants.view', 'lms-track-variants.create']);
    const phase = await post(`${BASE}/${v.id}/phases`, { phaseNumber: 1, title: 'Creator phase' }, creator.token);
    expect(phase.status).toBe(201);
    expect((await patch(`${BASE}/${v.id}/phases/${phase.body.data.id}`, { title: 'Creator edit' }, creator.token)).status).toBe(403);
    expect((await del(`${BASE}/${v.id}/phases/${phase.body.data.id}`, creator.token)).status).toBe(403);
  });
});
