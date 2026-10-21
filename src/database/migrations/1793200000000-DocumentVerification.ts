import type { MigrationInterface, QueryRunner } from 'typeorm';

/* A reviewer marks each uploaded document as checked against the registration (Student Registration detail page). */
export class DocumentVerification1793200000000 implements MigrationInterface {
  name = 'DocumentVerification1793200000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "student_documents" ADD COLUMN "verifiedAt" timestamptz NULL`);
    await q.query(`ALTER TABLE "student_documents" ADD COLUMN "verifiedById" uuid NULL`);
    await q.query(
      `ALTER TABLE "student_documents" ADD CONSTRAINT "FK_student_documents_verifiedBy" FOREIGN KEY ("verifiedById") REFERENCES "users"("id") ON DELETE RESTRICT`,
    );
    await q.query(
      `ALTER TABLE "student_documents" ADD CONSTRAINT "CHK_student_documents_verified" CHECK (("verifiedAt" IS NULL) = ("verifiedById" IS NULL))`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "student_documents" DROP CONSTRAINT "CHK_student_documents_verified"`);
    await q.query(`ALTER TABLE "student_documents" DROP CONSTRAINT "FK_student_documents_verifiedBy"`);
    await q.query(`ALTER TABLE "student_documents" DROP COLUMN "verifiedById"`);
    await q.query(`ALTER TABLE "student_documents" DROP COLUMN "verifiedAt"`);
  }
}
