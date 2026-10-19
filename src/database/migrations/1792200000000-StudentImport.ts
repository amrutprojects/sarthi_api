import type { MigrationInterface, QueryRunner } from 'typeorm';

/* Approved-student data import: import batches, source rows, and the student master register. */
export class StudentImport1792200000000 implements MigrationInterface {
  name = 'StudentImport1792200000000';

  public async up(q: QueryRunner): Promise<void> {
    const base = `
      "id"        uuid        NOT NULL DEFAULT gen_random_uuid(),
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now(),
      "isDelete"  boolean     NOT NULL DEFAULT false,
      "isActive"  boolean     NOT NULL DEFAULT true`;

    await q.query(`
      CREATE TABLE "import_batches" (${base},
        "code"            varchar(20)  NOT NULL,
        "status"          varchar(30)  NOT NULL,
        "sourceChannel"   varchar(20)  NOT NULL DEFAULT 'FILE_UPLOAD',
        "fileName"        varchar(255) NOT NULL,
        "fileChecksum"    char(64)     NOT NULL,
        "fileSize"        integer      NOT NULL,
        "sourceReference" varchar(120) NULL,
        "counts"          jsonb        NOT NULL DEFAULT '{}'::jsonb,
        "columnMapping"   jsonb        NOT NULL DEFAULT '{}'::jsonb,
        "ignoredColumns"  jsonb        NOT NULL DEFAULT '[]'::jsonb,
        "failureReason"   text         NULL,
        "createdById"     uuid         NOT NULL,
        "finalisedById"   uuid         NULL,
        "finalisedAt"     timestamptz  NULL,
        "cancelledById"   uuid         NULL,
        CONSTRAINT "PK_import_batches" PRIMARY KEY ("id"),
        CONSTRAINT "FK_import_batches_createdBy"   FOREIGN KEY ("createdById")   REFERENCES "users"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_import_batches_finalisedBy" FOREIGN KEY ("finalisedById") REFERENCES "users"("id") ON DELETE RESTRICT
      )`);
    await q.query(`CREATE UNIQUE INDEX "UQ_import_batches_code" ON "import_batches" ("code")`);
    await q.query(
      `CREATE UNIQUE INDEX "UQ_import_batches_checksum_open" ON "import_batches" ("fileChecksum") WHERE "isDelete" = false AND "status" <> 'CANCELLED'`,
    );

    await q.query(`
      CREATE TABLE "students" (${base},
        "code"                   varchar(20)  NOT NULL,
        "sourceRecordId"         varchar(64)  NULL,
        "sourceChecksum"         char(64)     NOT NULL,
        "firstName"              varchar(100) NOT NULL,
        "lastName"               varchar(100) NOT NULL,
        "fatherName"             varchar(150) NOT NULL,
        "motherName"             varchar(150) NOT NULL,
        "email"                  varchar(254) NULL,
        "dateOfBirth"            date         NULL,
        "currentAddress"         varchar(500) NOT NULL,
        "aadhaarEnc"             bytea        NULL,
        "aadhaarBidx"            char(64)     NULL,
        "aadhaarLast4"           char(4)      NULL,
        "mobile"                 varchar(16)  NULL,
        "religion"               varchar(60)  NOT NULL,
        "caste"                  varchar(80)  NOT NULL,
        "centreCode"             varchar(10)  NULL,
        "trackCode"              varchar(4)   NULL,
        "trackSourceValue"       varchar(120) NOT NULL,
        "educationQualification" varchar(150) NOT NULL,
        "externalStatus"         varchar(30)  NOT NULL,
        "approvedAt"             timestamptz  NOT NULL,
        "evidenceRef"            varchar(120) NULL,
        "declarationAccepted"    boolean      NULL,
        "documents"              jsonb        NOT NULL DEFAULT '{}'::jsonb,
        "status"                 varchar(30)  NOT NULL DEFAULT 'RECEIVED',
        "importBatchId"          uuid         NOT NULL,
        CONSTRAINT "PK_students" PRIMARY KEY ("id"),
        CONSTRAINT "FK_students_importBatch" FOREIGN KEY ("importBatchId") REFERENCES "import_batches"("id") ON DELETE RESTRICT
      )`);
    await q.query(`CREATE UNIQUE INDEX "UQ_students_code" ON "students" ("code")`);
    await q.query(
      `CREATE UNIQUE INDEX "UQ_students_source_record" ON "students" ("sourceRecordId") WHERE "isDelete" = false AND "sourceRecordId" IS NOT NULL`,
    );
    await q.query(`CREATE INDEX "IDX_students_bidx" ON "students" ("aadhaarBidx")`);
    await q.query(`CREATE SEQUENCE "students_code_seq"`);
    await q.query(`CREATE SEQUENCE "import_batches_code_seq"`);

    await q.query(`
      CREATE TABLE "import_rows" (${base},
        "batchId"        uuid        NOT NULL,
        "rowNumber"      integer     NOT NULL,
        "status"         varchar(30) NOT NULL,
        "checksum"       char(64)    NOT NULL,
        "sourceRecordId" varchar(64) NULL,
        "data"           jsonb       NOT NULL,
        "aadhaarEnc"     bytea       NULL,
        "aadhaarBidx"    char(64)    NULL,
        "aadhaarLast4"   char(4)     NULL,
        "issues"         jsonb       NOT NULL DEFAULT '[]'::jsonb,
        "matchStudentId" uuid        NULL,
        "matchRowNumber" integer     NULL,
        "matchTier"      varchar(10) NULL,
        "matchNote"      varchar(200) NULL,
        "decision"       varchar(20) NULL,
        "decisionReason" text        NULL,
        "decidedById"    uuid        NULL,
        "decidedAt"      timestamptz NULL,
        "rejectReason"   text        NULL,
        "studentId"      uuid        NULL,
        CONSTRAINT "PK_import_rows" PRIMARY KEY ("id"),
        CONSTRAINT "FK_import_rows_batch"   FOREIGN KEY ("batchId")        REFERENCES "import_batches"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_import_rows_match"   FOREIGN KEY ("matchStudentId") REFERENCES "students"("id")       ON DELETE RESTRICT,
        CONSTRAINT "FK_import_rows_student" FOREIGN KEY ("studentId")      REFERENCES "students"("id")       ON DELETE RESTRICT,
        CONSTRAINT "FK_import_rows_decidedBy" FOREIGN KEY ("decidedById")  REFERENCES "users"("id")          ON DELETE RESTRICT
      )`);
    await q.query(`CREATE INDEX "IDX_import_rows_batch_status" ON "import_rows" ("batchId", "status")`);
    await q.query(`CREATE INDEX "IDX_import_rows_bidx" ON "import_rows" ("aadhaarBidx")`);

    for (const t of ['import_batches', 'import_rows', 'students']) {
      await q.query(`CREATE TRIGGER "TRG_${t}_updated_at" BEFORE UPDATE ON "${t}" FOR EACH ROW EXECUTE FUNCTION "set_updated_at"()`);
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE "import_rows"`);
    await q.query(`DROP TABLE "students"`);
    await q.query(`DROP TABLE "import_batches"`);
    await q.query(`DROP SEQUENCE "students_code_seq"`);
    await q.query(`DROP SEQUENCE "import_batches_code_seq"`);
  }
}
