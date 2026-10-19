import type { MigrationInterface, QueryRunner } from 'typeorm';

/* Student document files (staged per import row, then per student) and the documents report on import batches. */
export class StudentDocuments1792400000000 implements MigrationInterface {
  name = 'StudentDocuments1792400000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE "student_documents" (
        "id"           uuid         NOT NULL DEFAULT gen_random_uuid(),
        "createdAt"    timestamptz  NOT NULL DEFAULT now(),
        "updatedAt"    timestamptz  NOT NULL DEFAULT now(),
        "isDelete"     boolean      NOT NULL DEFAULT false,
        "isActive"     boolean      NOT NULL DEFAULT true,
        "batchId"      uuid         NOT NULL,
        "importRowId"  uuid         NOT NULL,
        "studentId"    uuid         NULL,
        "docType"      varchar(30)  NOT NULL,
        "storageKey"   varchar(300) NOT NULL,
        "originalName" varchar(255) NOT NULL,
        "mimeType"     varchar(50)  NOT NULL,
        "sizeBytes"    integer      NOT NULL,
        "sha256"       char(64)     NOT NULL,
        "uploadedById" uuid         NOT NULL,
        CONSTRAINT "PK_student_documents" PRIMARY KEY ("id"),
        CONSTRAINT "FK_student_documents_batch"   FOREIGN KEY ("batchId")      REFERENCES "import_batches"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_student_documents_row"     FOREIGN KEY ("importRowId")  REFERENCES "import_rows"("id")    ON DELETE RESTRICT,
        CONSTRAINT "FK_student_documents_student" FOREIGN KEY ("studentId")    REFERENCES "students"("id")       ON DELETE RESTRICT,
        CONSTRAINT "FK_student_documents_user"    FOREIGN KEY ("uploadedById") REFERENCES "users"("id")          ON DELETE RESTRICT
      )`);
    await q.query(`CREATE INDEX "IDX_student_documents_student" ON "student_documents" ("studentId")`);
    await q.query(`CREATE INDEX "IDX_student_documents_row" ON "student_documents" ("importRowId")`);
    await q.query(
      `CREATE UNIQUE INDEX "UQ_student_documents_row_type" ON "student_documents" ("importRowId", "docType") WHERE "isDelete" = false AND "studentId" IS NULL`,
    );
    await q.query(
      `CREATE TRIGGER "TRG_student_documents_updated_at" BEFORE UPDATE ON "student_documents" FOR EACH ROW EXECUTE FUNCTION "set_updated_at"()`,
    );
    await q.query(`ALTER TABLE "import_batches" ADD COLUMN "documentsReport" jsonb NULL`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "import_batches" DROP COLUMN "documentsReport"`);
    await q.query(`DROP TABLE "student_documents"`);
  }
}
