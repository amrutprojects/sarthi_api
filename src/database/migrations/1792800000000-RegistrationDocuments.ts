import type { MigrationInterface, QueryRunner } from 'typeorm';

/* Documents uploaded with an admin-entered registration belong to a student directly, without an import batch or row. */
export class RegistrationDocuments1792800000000 implements MigrationInterface {
  name = 'RegistrationDocuments1792800000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "student_documents" ALTER COLUMN "batchId" DROP NOT NULL`);
    await q.query(`ALTER TABLE "student_documents" ALTER COLUMN "importRowId" DROP NOT NULL`);
    /* Every document belongs to an import row or to a student. */
    await q.query(
      `ALTER TABLE "student_documents" ADD CONSTRAINT "CHK_student_documents_owner" CHECK ("importRowId" IS NOT NULL OR "studentId" IS NOT NULL)`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "student_documents" DROP CONSTRAINT "CHK_student_documents_owner"`);
    await q.query(`ALTER TABLE "student_documents" ALTER COLUMN "importRowId" SET NOT NULL`);
    await q.query(`ALTER TABLE "student_documents" ALTER COLUMN "batchId" SET NOT NULL`);
  }
}
