import type { MigrationInterface, QueryRunner } from 'typeorm';

/*
 * The EDP portal's additional registration details on the student register (Basic Details: gender, addresses,
 * district / taluka, alternate contacts, disability; Main Form: centre and course type, qualification details).
 *
 * - Every column is nullable: imported and admin-entered records do not carry these details, and nothing is backfilled.
 * - districtId / talukaId → CMS geography, centreId → centres, courseId → lms_courses, all ON DELETE RESTRICT.
 * - New document types, all non-mandatory (whether they are mandatory is the Document Types master's setting):
 *   Applicant Photograph with Aadhaar, 12th / 3-year Diploma marksheet, Disability Certificate. Codes and names are
 *   unique across every row of document_types, so an existing row with the same code or name is left as it is.
 */
const COLUMNS: [name: string, type: string][] = [
  ['gender', 'varchar(20)'],
  ['maritalStatus', 'varchar(20)'],
  ['permanentAddress', 'varchar(500)'],
  ['landmark', 'varchar(150)'],
  ['districtId', 'uuid'],
  ['talukaId', 'uuid'],
  ['pinCode', 'char(6)'],
  ['alternateMobile', 'varchar(16)'],
  ['alternateEmail', 'varchar(254)'],
  ['disabilityStatus', 'boolean'],
  ['disabilityType', 'varchar(100)'],
  ['disabilityCertificateNumber', 'varchar(50)'],
  ['nameChanged', 'boolean'],
  ['centreId', 'uuid'],
  ['courseId', 'uuid'],
  ['qualificationName', 'varchar(150)'],
  ['qualificationStream', 'varchar(150)'],
  ['qualificationBoard', 'varchar(200)'],
  ['qualificationCompletedOn', 'date'],
  ['gradingType', 'varchar(12)'],
  ['cgpaScale', 'smallint'],
  ['score', 'numeric(5,2)'],
  ['qualificationClass', 'varchar(40)'],
];

const FKS: [column: string, table: string][] = [
  ['districtId', 'districts'],
  ['talukaId', 'talukas'],
  ['centreId', 'edp_centres'],
  ['courseId', 'lms_courses'],
];

const DOCUMENT_TYPES: [code: string, name: string, description: string][] = [
  ['AADHAAR_PHOTO', 'Applicant Photograph with Aadhaar', 'Photograph of the applicant holding the Aadhaar card'],
  ['HSC_DIPLOMA', '12th Pass or 3 Years Diploma Pass Marksheet / Certificate', '12th (HSC) or 3-year diploma marksheet or certificate'],
  ['DISABILITY_CERT', 'Disability Certificate', 'Required from applicants who declare a disability'],
];

export class StudentEdpProfile1795300000000 implements MigrationInterface {
  name = 'StudentEdpProfile1795300000000';

  public async up(q: QueryRunner): Promise<void> {
    for (const [name, type] of COLUMNS) await q.query(`ALTER TABLE "students" ADD COLUMN "${name}" ${type} NULL`);
    for (const [col, table] of FKS) {
      await q.query(
        `ALTER TABLE "students" ADD CONSTRAINT "FK_students_${col}" FOREIGN KEY ("${col}") REFERENCES "${table}"("id") ON DELETE RESTRICT`,
      );
      await q.query(`CREATE INDEX "IDX_students_${col}" ON "students" ("${col}")`);
    }
    await q.query(
      `ALTER TABLE "students" ADD CONSTRAINT "CHK_students_pinCode" CHECK ("pinCode" IS NULL OR "pinCode" ~ '^[1-9][0-9]{5}$')`,
    );
    await q.query(
      `ALTER TABLE "students" ADD CONSTRAINT "CHK_students_gradingType" CHECK ("gradingType" IS NULL OR "gradingType" IN ('PERCENTAGE', 'CGPA'))`,
    );
    await q.query(
      `ALTER TABLE "students" ADD CONSTRAINT "CHK_students_score" CHECK ("score" IS NULL OR ("score" >= 0 AND "score" <= 100))`,
    );

    for (const [code, name, description] of DOCUMENT_TYPES)
      await q.query(
        `INSERT INTO "document_types" ("code", "name", "isMandatory", "description")
         SELECT $1::varchar, $2::varchar, false, $3::varchar
         WHERE NOT EXISTS (SELECT 1 FROM "document_types" WHERE "code" = $1::varchar OR lower("name") = lower($2::varchar))`,
        [code, name, description],
      );
  }

  public async down(q: QueryRunner): Promise<void> {
    /* The document types are left in place: student records or files may reference them by then. */
    for (const c of ['CHK_students_score', 'CHK_students_gradingType', 'CHK_students_pinCode'])
      await q.query(`ALTER TABLE "students" DROP CONSTRAINT IF EXISTS "${c}"`);
    for (const [col] of FKS) {
      await q.query(`DROP INDEX IF EXISTS "IDX_students_${col}"`);
      await q.query(`ALTER TABLE "students" DROP CONSTRAINT IF EXISTS "FK_students_${col}"`);
    }
    for (const [name] of [...COLUMNS].reverse()) await q.query(`ALTER TABLE "students" DROP COLUMN IF EXISTS "${name}"`);
  }
}
