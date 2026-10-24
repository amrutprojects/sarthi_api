import crypto from 'crypto';
import type { Express } from 'express';
import { env } from '../../src/config/env.config';
import { documentStorage } from '../../src/modules/students/documents/document-storage';
import {
  API,
  AppDataSource,
  actorWith,
  auth,
  createUser,
  request,
  setupTestApp,
  teardownTestApp,
  type TestActor,
} from '../helpers/test-app';

/*
 * Register buckets (GET /students/summary and GET /students?bucket=…):
 *   applications = not deleted (any status, active or not); pending = REGISTRATION_PENDING;
 *   eligible = RECEIVED, active; enrolled = eligible with a live (active, non-deleted) batch assignment;
 *   awaiting = eligible without one.
 * One fixture set (direct inserts, as import finalisation and registration write them), read by every test.
 */
let app: Express;
const STUDENTS = `${API}/students`;
const ids: Record<string, string> = {};
let batch: { id: string; code: string; name: string };
let docId: string;
const DOC_KEY = 'students/STU-SUM-A/PHOTO.pdf';
const PDF = Buffer.from('%PDF-1.4\n% summary test\n%%EOF\n');

const one = async <T = Record<string, string>>(sql: string, params: unknown[] = []): Promise<T> =>
  ((await AppDataSource.query(sql, params)) as T[])[0];
/* Mid-month, `n` months before the current month in APP_TIMEZONE (never in the future). */
const monthsAgo = (n: number) =>
  `((date_trunc('month', timezone('${env.APP_TIMEZONE}', now())) - interval '${n} months' + interval '14 days') AT TIME ZONE '${env.APP_TIMEZONE}')`;

interface Fixture {
  key: string;
  source: 'IMPORT' | 'PUBLIC_REGISTRATION';
  status: 'RECEIVED' | 'REGISTRATION_PENDING';
  active?: boolean;
  deleted?: boolean;
  centre: 'PUN' | 'NAG';
  track: string | null;
  caste: 'C1' | 'C2' | null;
  education: 'E1' | 'E2' | null;
  /* SQL expression for approvedAt (imports are always approved). */
  approvedAt?: string;
  assignment?: 'live' | 'inactive' | 'deleted';
}

/*
 * A, B, C, D, G, K eligible; A enrolled; E has a live assignment but is inactive (not eligible, not enrolled);
 * C's assignment is inactive and D's deleted (both awaiting); F and I pending; H deleted (counted nowhere);
 * K approved 14 months ago (outside byMonth).
 */
const FIXTURES: Fixture[] = [
  {
    key: 'A',
    source: 'IMPORT',
    status: 'RECEIVED',
    centre: 'PUN',
    track: 'T01',
    caste: 'C1',
    education: 'E1',
    approvedAt: monthsAgo(2),
    assignment: 'live',
  },
  { key: 'B', source: 'IMPORT', status: 'RECEIVED', centre: 'PUN', track: 'T01', caste: 'C1', education: 'E2' },
  { key: 'C', source: 'IMPORT', status: 'RECEIVED', centre: 'NAG', track: 'T02', caste: 'C2', education: 'E1', assignment: 'inactive' },
  { key: 'D', source: 'IMPORT', status: 'RECEIVED', centre: 'NAG', track: null, caste: null, education: null, assignment: 'deleted' },
  {
    key: 'E',
    source: 'IMPORT',
    status: 'RECEIVED',
    active: false,
    centre: 'PUN',
    track: 'T02',
    caste: 'C1',
    education: 'E1',
    assignment: 'live',
  },
  { key: 'F', source: 'PUBLIC_REGISTRATION', status: 'REGISTRATION_PENDING', centre: 'PUN', track: 'T03', caste: 'C2', education: 'E1' },
  {
    key: 'G',
    source: 'PUBLIC_REGISTRATION',
    status: 'RECEIVED',
    centre: 'NAG',
    track: 'T03',
    caste: 'C1',
    education: 'E2',
    approvedAt: 'now()',
  },
  {
    key: 'H',
    source: 'IMPORT',
    status: 'RECEIVED',
    deleted: true,
    centre: 'PUN',
    track: 'T01',
    caste: 'C1',
    education: 'E1',
    assignment: 'live',
  },
  {
    key: 'I',
    source: 'PUBLIC_REGISTRATION',
    status: 'REGISTRATION_PENDING',
    active: false,
    centre: 'PUN',
    track: 'T01',
    caste: 'C2',
    education: 'E1',
  },
  { key: 'K', source: 'IMPORT', status: 'RECEIVED', centre: 'PUN', track: 'T04', caste: 'C1', education: 'E2', approvedAt: monthsAgo(14) },
];
const master: Record<string, string> = {};

beforeAll(async () => {
  app = await setupTestApp();
  const importer = await createUser();
  const imp = await one(
    `INSERT INTO "import_batches" ("code", "status", "fileName", "fileChecksum", "fileSize", "createdById")
     VALUES ('IMP-SUM', 'FINALISED', 'students.xlsx', $1, 1, $2) RETURNING "id"`,
    ['f'.repeat(64), importer.id],
  );
  const castes: { id: string }[] = await AppDataSource.query(`SELECT "id" FROM "castes" WHERE NOT "isDelete" ORDER BY "code" LIMIT 2`);
  [master.C1, master.C2] = castes.map((c) => c.id);
  master.E1 = (await one(`SELECT "id" FROM "educations" WHERE "name" = 'Graduate'`)).id;
  master.E2 = (await one(`SELECT "id" FROM "educations" WHERE "name" = 'B.Com'`)).id;
  master.PUN = (await one(`SELECT "id" FROM "regions" WHERE "code" = 'PUN'`)).id;
  master.NAG = (await one(`SELECT "id" FROM "regions" WHERE "code" = 'NAG'`)).id;

  const state = await one(`INSERT INTO "states" ("name", "code") VALUES ('Maharashtra', 'MH') RETURNING "id"`);
  const district = await one(`INSERT INTO "districts" ("stateId", "name", "code") VALUES ($1, 'Pune', 'PUNE') RETURNING "id"`, [state.id]);
  const centre = await one(
    `INSERT INTO "training_centres" ("name", "code", "districtId") VALUES ('Pune Centre', 'TC0001', $1) RETURNING "id"`,
    [district.id],
  );
  batch = await one(
    `INSERT INTO "batches" ("centreId", "name", "code", "capacity", "startDate", "deliveryMode", "batchStatus")
     VALUES ($1, 'Batch A', 'AMK-B-TC0001-001', 30, '2026-11-01', 'OFFLINE', 'OPEN') RETURNING "id", "code", "name"`,
    [centre.id],
  );

  for (const [i, f] of FIXTURES.entries()) {
    const approvedAt = f.approvedAt ?? (f.source === 'IMPORT' ? 'now()' : 'NULL');
    const row = await one(
      `INSERT INTO "students" ("code", "sourceChecksum", "firstName", "lastName", "fatherName", "motherName", "currentAddress",
         "religion", "caste", "centreCode", "trackCode", "trackSourceValue", "educationQualification", "externalStatus", "approvedAt",
         "importBatchId", "source", "status", "isActive", "isDelete", "regionId", "casteId", "educationId", "email", "mobile")
       VALUES ($1, $2, 'Student', $3, 'Father', 'Mother', 'Pune', 'Hindu', 'Maratha', $4, $5, 'Track', 'Graduate', $6, ${approvedAt},
         $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
       RETURNING "id"`,
      [
        `STU-SUM-${f.key}`,
        String(i).padStart(64, 'c'),
        f.key,
        f.centre,
        f.track,
        f.source === 'IMPORT' ? 'APPROVED' : 'PENDING',
        f.source === 'IMPORT' ? imp.id : null,
        f.source,
        f.status,
        f.active ?? true,
        f.deleted ?? false,
        master[f.centre],
        f.caste && master[f.caste],
        f.education && master[f.education],
        `student.${f.key.toLowerCase()}@example.invalid`,
        `98765432${String(10 + i)}`,
      ],
    );
    ids[f.key] = row.id;
    if (f.assignment)
      await AppDataSource.query(
        `INSERT INTO "batch_assignments" ("batchId", "studentId", "reasonCode", "isActive", "isDelete") VALUES ($1, $2, 'OTHER', $3, $4)`,
        [batch.id, row.id, f.assignment !== 'inactive', f.assignment === 'deleted'],
      );
  }

  /* One stored document of A, for the download permission. */
  await documentStorage.write(DOC_KEY, PDF);
  docId = (
    await one(
      `INSERT INTO "student_documents" ("studentId", "docType", "storageKey", "originalName", "mimeType", "sizeBytes", "sha256", "uploadedById")
       VALUES ($1, 'PHOTO', $2, 'photo.pdf', 'application/pdf', $3, $4, $5) RETURNING "id"`,
      [ids.A, DOC_KEY, PDF.length, crypto.createHash('sha256').update(PDF).digest('hex'), importer.id],
    )
  ).id;
});
afterAll(async () => {
  await documentStorage.remove(DOC_KEY).catch(() => undefined);
  await teardownTestApp();
});

/* Actors are created lazily and reused (one role per permission set). */
const actors = new Map<string, TestActor>();
async function as(...codes: string[]): Promise<string> {
  const k = codes.join(',');
  if (!actors.has(k)) actors.set(k, await actorWith(codes));
  return actors.get(k)!.token;
}

const codesOf = (body: { data: { code: string }[] }) => body.data.map((s) => s.code.replace('STU-SUM-', '')).sort();
async function list(query: Record<string, string>) {
  const res = await request(app)
    .get(STUDENTS)
    .query({ limit: '200', ...query })
    .set(auth(await as('imports.view')));
  expect(res.status).toBe(200);
  return res.body;
}

/* YYYY-MM of the current month in APP_TIMEZONE, minus `n` months. */
function month(n: number): string {
  const [y, m] = new Intl.DateTimeFormat('en-CA', { timeZone: env.APP_TIMEZONE, year: 'numeric', month: '2-digit' })
    .format(new Date())
    .split('-')
    .map(Number);
  const d = new Date(Date.UTC(y, m - 1 - n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

describe('GET /students/summary', () => {
  it('counts every bucket, source, district, track, caste, education and month in the register', async () => {
    const before = Date.now();
    const res = await request(app)
      .get(`${STUDENTS}/summary`)
      .set(auth(await as('imports.view')));
    expect(res.status).toBe(200);
    const s = res.body.data;
    expect(Date.parse(s.asOf)).toBeGreaterThanOrEqual(before - 1000);

    expect(s.totals).toEqual({ applications: 9, pending: 2, eligible: 6, enrolled: 1, awaitingBatch: 5, inactive: 2 });
    expect(s.bySource).toEqual([
      { source: 'IMPORT', count: 6 },
      { source: 'PUBLIC_REGISTRATION', count: 3 },
    ]);

    /* Every active region, zeros included, ordered by name. */
    const regions: { code: string; name: string }[] = await AppDataSource.query(
      `SELECT "code", "name" FROM "regions" WHERE "isActive" AND NOT "isDelete" ORDER BY "name", "code"`,
    );
    expect(regions.length).toBeGreaterThan(2);
    expect(s.byCentre.map((c: { code: string }) => c.code)).toEqual(regions.map((r) => r.code));
    const centre = (code: string) => s.byCentre.find((c: { code: string }) => c.code === code);
    expect(centre('PUN')).toEqual({
      code: 'PUN',
      name: regions.find((r) => r.code === 'PUN')!.name,
      applications: 6,
      eligible: 3,
      enrolled: 1,
    });
    expect(centre('NAG')).toMatchObject({ applications: 3, eligible: 3, enrolled: 0 });
    expect(centre('THA')).toMatchObject({ applications: 0, eligible: 0, enrolled: 0 });

    /* T01..T12 in order, then null (to be confirmed). */
    expect(s.byTrack).toHaveLength(13);
    expect(s.byTrack.map((t: { code: string | null }) => t.code)).toEqual([
      ...Array.from({ length: 12 }, (_, i) => `T${String(i + 1).padStart(2, '0')}`),
      null,
    ]);
    const track = (code: string | null) => s.byTrack.find((t: { code: string | null }) => t.code === code);
    expect(track('T01')).toMatchObject({ name: 'Data Analytics & Business Intelligence', applications: 3, eligible: 2, enrolled: 1 });
    expect(track('T02')).toMatchObject({ applications: 2, eligible: 1, enrolled: 0 });
    expect(track('T03')).toMatchObject({ applications: 2, eligible: 1, enrolled: 0 });
    expect(track('T04')).toMatchObject({ applications: 1, eligible: 1, enrolled: 0 });
    expect(track('T12')).toMatchObject({ applications: 0, eligible: 0, enrolled: 0 });
    expect(track(null)).toEqual({ code: null, name: 'To be confirmed', applications: 1, eligible: 1, enrolled: 0 });

    /* Applications per master value, highest first; null = not recorded. */
    const casteName = async (id: string) => (await one(`SELECT "name" FROM "castes" WHERE "id" = $1`, [id])).name;
    expect(s.byCaste).toEqual([
      { id: master.C1, name: await casteName(master.C1), count: 5 },
      { id: master.C2, name: await casteName(master.C2), count: 3 },
      { id: null, name: 'Not recorded', count: 1 },
    ]);
    expect(s.byEducation).toEqual([
      { id: master.E1, name: 'Graduate', count: 5 },
      { id: master.E2, name: 'B.Com', count: 3 },
      { id: null, name: 'Not recorded', count: 1 },
    ]);

    /* Last 12 months up to now; K (14 months ago) falls outside; enrolled by assignment date. */
    expect(s.byMonth.map((m: { month: string }) => m.month)).toEqual(Array.from({ length: 12 }, (_, i) => month(11 - i)));
    const byMonth = Object.fromEntries(s.byMonth.map((m: { month: string }) => [m.month, m]));
    expect(byMonth[month(0)]).toEqual({ month: month(0), applications: 7, enrolled: 1 });
    expect(byMonth[month(2)]).toEqual({ month: month(2), applications: 1, enrolled: 0 });
    expect(s.byMonth.reduce((n: number, m: { applications: number }) => n + m.applications, 0)).toBe(8);
    expect(s.byMonth.reduce((n: number, m: { enrolled: number }) => n + m.enrolled, 0)).toBe(1);
  });

  it('narrows every figure to one district with ?centre=', async () => {
    const res = await request(app)
      .get(`${STUDENTS}/summary`)
      .query({ centre: 'NAG' })
      .set(auth(await as('dashboard.view')));
    expect(res.status).toBe(200);
    const s = res.body.data;
    expect(s.totals).toEqual({ applications: 3, pending: 0, eligible: 3, enrolled: 0, awaitingBatch: 3, inactive: 0 });
    expect(s.bySource).toEqual([
      { source: 'IMPORT', count: 2 },
      { source: 'PUBLIC_REGISTRATION', count: 1 },
    ]);
    const centre = (code: string) => s.byCentre.find((c: { code: string }) => c.code === code);
    expect(centre('NAG')).toMatchObject({ applications: 3, eligible: 3, enrolled: 0 });
    expect(centre('PUN')).toMatchObject({ applications: 0, eligible: 0, enrolled: 0 });
    expect(s.byTrack.find((t: { code: string | null }) => t.code === null)).toMatchObject({ applications: 1 });
  });

  it('is served by its own route, not read as a student id', async () => {
    const res = await request(app)
      .get(`${STUDENTS}/summary`)
      .set(auth(await as('candidates.view')));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('totals');
    /* A non-uuid id is still a validation error on '/:id'. */
    expect(
      (
        await request(app)
          .get(`${STUDENTS}/not-an-id`)
          .set(auth(await as('candidates.view')))
      ).status,
    ).toBe(422);
  });

  it('needs any of dashboard.view, candidates.view or imports.view', async () => {
    for (const code of ['dashboard.view', 'candidates.view', 'imports.view'])
      expect([
        code,
        (
          await request(app)
            .get(`${STUDENTS}/summary`)
            .set(auth(await as(code)))
        ).status,
      ]).toEqual([code, 200]);
    expect(
      (
        await request(app)
          .get(`${STUDENTS}/summary`)
          .set(auth(await as('users.view')))
      ).status,
    ).toBe(403);
    expect((await request(app).get(`${STUDENTS}/summary`)).status).toBe(401);
  });
});

describe('GET /students bucket and master filters', () => {
  it('filters by bucket with the summary definitions', async () => {
    expect(codesOf(await list({}))).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'I', 'K']);
    expect(codesOf(await list({ bucket: 'applications' }))).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'I', 'K']);
    expect(codesOf(await list({ bucket: 'pending' }))).toEqual(['F', 'I']);
    expect(codesOf(await list({ bucket: 'eligible' }))).toEqual(['A', 'B', 'C', 'D', 'G', 'K']);
    expect(codesOf(await list({ bucket: 'enrolled' }))).toEqual(['A']);
    const awaiting = await list({ bucket: 'awaiting' });
    expect(codesOf(awaiting)).toEqual(['B', 'C', 'D', 'G', 'K']);
    expect(awaiting.meta.total).toBe(5);
    expect(codesOf(await list({ bucket: 'eligible', centre: 'PUN' }))).toEqual(['A', 'B', 'K']);
    expect(
      (
        await request(app)
          .get(STUDENTS)
          .query({ bucket: 'everyone' })
          .set(auth(await as('imports.view')))
      ).status,
    ).toBe(422);
  });

  it('filters by track (none = to be confirmed), source, caste, education and region', async () => {
    expect(codesOf(await list({ track: 'none' }))).toEqual(['D']);
    expect(codesOf(await list({ track: 'TBC' }))).toEqual(['D']);
    expect(codesOf(await list({ track: 'T01' }))).toEqual(['A', 'B', 'I']);
    expect(codesOf(await list({ source: 'PUBLIC_REGISTRATION' }))).toEqual(['F', 'G', 'I']);
    expect(codesOf(await list({ casteId: master.C2 }))).toEqual(['C', 'F', 'I']);
    expect(codesOf(await list({ educationId: master.E2 }))).toEqual(['B', 'G', 'K']);
    expect(codesOf(await list({ regionId: master.NAG }))).toEqual(['C', 'D', 'G']);
    expect(codesOf(await list({ regionId: master.NAG, bucket: 'awaiting', track: 'T03' }))).toEqual(['G']);
    expect(
      (
        await request(app)
          .get(STUDENTS)
          .query({ casteId: 'x' })
          .set(auth(await as('imports.view')))
      ).status,
    ).toBe(422);
  });

  it('gives each row `enrolled` and its live batch', async () => {
    const rows = Object.fromEntries((await list({})).data.map((s: { code: string }) => [s.code.replace('STU-SUM-', ''), s]));
    const ref = { id: batch.id, code: batch.code, name: batch.name };
    expect(rows.A).toMatchObject({ enrolled: true, batch: ref });
    /* E holds a live assignment but is inactive, so it is not enrolled. */
    expect(rows.E).toMatchObject({ enrolled: false, batch: ref });
    expect(rows.C).toMatchObject({ enrolled: false, batch: null });
    expect(rows.D).toMatchObject({ enrolled: false, batch: null });
    expect(rows.B).toMatchObject({ enrolled: false, batch: null });
  });
});

describe('Register permissions (any of)', () => {
  it('lets candidates.view alone read the masked list, detail and documents, but not open a file', async () => {
    const token = await as('candidates.view');
    const listRes = await request(app).get(STUDENTS).query({ bucket: 'enrolled' }).set(auth(token));
    expect(listRes.status).toBe(200);
    const [row] = listRes.body.data;
    expect(row).toMatchObject({ code: 'STU-SUM-A', email: 'st*******@example.invalid', aadhaar: null, enrolled: true });
    expect(row.mobile).toMatch(/^\+91XXXXXX\d{4}$/);
    expect(row).not.toHaveProperty('unmasked');

    const detail = await request(app).get(`${STUDENTS}/${ids.A}`).set(auth(token));
    expect(detail.status).toBe(200);
    expect(detail.body.data).toMatchObject({ id: ids.A, email: 'st*******@example.invalid' });
    expect(JSON.stringify(detail.body.data)).not.toContain('student.a@example.invalid');

    const docs = await request(app).get(`${STUDENTS}/${ids.A}/documents`).set(auth(token));
    expect(docs.status).toBe(200);
    expect(docs.body.data.map((d: { id: string }) => d.id)).toEqual([docId]);

    expect((await request(app).get(`${STUDENTS}/${ids.A}/documents/${docId}/file`).set(auth(token))).status).toBe(403);
  });

  it('lets imports.view alone open a document file', async () => {
    const res = await request(app)
      .get(`${STUDENTS}/${ids.A}/documents/${docId}/file`)
      .set(auth(await as('imports.view')));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/pdf/);
  });

  it('keeps the list, detail and documents closed to dashboard.view alone', async () => {
    const token = await as('dashboard.view');
    expect((await request(app).get(STUDENTS).set(auth(token))).status).toBe(403);
    expect((await request(app).get(`${STUDENTS}/${ids.A}`).set(auth(token))).status).toBe(403);
    expect((await request(app).get(`${STUDENTS}/${ids.A}/documents`).set(auth(token))).status).toBe(403);
  });
});
