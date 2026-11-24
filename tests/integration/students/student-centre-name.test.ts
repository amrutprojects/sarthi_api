import type { Express } from 'express';
import { AppDataSource } from '../../../src/config/database.config';
import { HTTP_STATUS } from '../../../src/constants/api-response.constants';
import { API, actorWith, request, resetData, setupTestApp, teardownTestApp } from '../../helpers/test-app';

/*
 * E2E 24 Nov 2026: a course centre added in the Regions master (the list the import and the summary use) had no
 * name in the student register (`centreName: null`), because the register read names only from the built-in list.
 * The Candidates screen then showed the bare code where the centre name belongs.
 */
let app: Express;
const CODE = 'E2ECN-C1';
const NAME = 'E2E Added Centre';

beforeAll(async () => {
  app = await setupTestApp();
});
beforeEach(resetData);
afterAll(async () => {
  /* regions is kept between test files: take the row this file added away again. */
  await AppDataSource.query(`DELETE FROM "regions" WHERE "code" = $1`, [CODE]);
  await teardownTestApp();
});

async function studentAt(centreCode: string): Promise<string> {
  const [user] = await AppDataSource.query(`SELECT "id" FROM "users" LIMIT 1`);
  const [batch] = await AppDataSource.query(
    `INSERT INTO "import_batches" ("code", "status", "fileName", "fileChecksum", "fileSize", "createdById")
     VALUES ('IMP-CN1', 'FINALISED', 'students.xlsx', $1, 1, $2) RETURNING "id"`,
    ['c'.repeat(64), user.id],
  );
  const [student] = await AppDataSource.query(
    `INSERT INTO "students" ("code", "sourceChecksum", "firstName", "lastName", "fatherName", "motherName", "currentAddress",
       "religion", "caste", "centreCode", "trackSourceValue", "educationQualification", "externalStatus", "approvedAt", "importBatchId")
     VALUES ('STU-CN1', $1, 'Etoe', 'Centre', 'Father', 'Mother', 'Pune', 'Hindu', 'Maratha', $2, 'Data Science', 'Graduate',
       'APPROVED', now(), $3)
     RETURNING "id"`,
    ['d'.repeat(64), centreCode, batch.id],
  );
  return student.id as string;
}

describe('student register: centre name of a centre added in the Regions master', () => {
  it('list and detail carry the master name', async () => {
    await AppDataSource.query(`INSERT INTO "regions" ("code", "name") VALUES ($1, $2)`, [CODE, NAME]);
    const actor = await actorWith(['imports.view']);
    const id = await studentAt(CODE);

    const list = await request(app).get(`${API}/students`).set('Authorization', `Bearer ${actor.token}`);
    expect(list.status).toBe(HTTP_STATUS.OK);
    const row = (list.body.data as { id: string; centreCode: string; centreName: string | null }[]).find((s) => s.id === id);
    expect(row).toMatchObject({ centreCode: CODE, centreName: NAME });

    const detail = await request(app).get(`${API}/students/${id}`).set('Authorization', `Bearer ${actor.token}`);
    expect(detail.status).toBe(HTTP_STATUS.OK);
    expect(detail.body.data).toMatchObject({ centreCode: CODE, centreName: NAME });
  });
});
