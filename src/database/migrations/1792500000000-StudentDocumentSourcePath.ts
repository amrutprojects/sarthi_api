import type { MigrationInterface, QueryRunner } from 'typeorm';

/* Records where each document was inside the uploaded ZIP (the path written in the Excel, or found by folder). */
export class StudentDocumentSourcePath1792500000000 implements MigrationInterface {
  name = 'StudentDocumentSourcePath1792500000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "student_documents" ADD COLUMN "sourcePath" varchar(300) NULL`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "student_documents" DROP COLUMN "sourcePath"`);
  }
}
