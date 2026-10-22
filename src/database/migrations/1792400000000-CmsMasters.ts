import type { MigrationInterface, QueryRunner } from 'typeorm';

/*
 * CMS masters (Masters sidebar group): departments, colleges, training centre types, training centres,
 * centre location information, centre capacity & infrastructure, batches, batch assignments, documents.
 *
 * Same conventions as CmsGeography:
 * - The common columns (id UUID, createdAt / updatedAt TIMESTAMPTZ, isDelete, isActive).
 * - Foreign keys are RESTRICT: the application soft-deletes, and each service refuses to delete a parent
 *   that is still referenced, so a child is never orphaned.
 * - Uniqueness uses PARTIAL unique indexes over non-deleted rows; names compare case-insensitively.
 * - CHECK constraints repeat the validators' shape rules, so raw SQL cannot store what the API refuses.
 * - The set_updated_at trigger keeps updatedAt correct for raw / bulk SQL too.
 *
 * Field sources: AMRUT_KALASH_02 Admin Panel specification — Training Centre Profile (Table 32),
 * Programme batch (Table 40), Centre and track allocation (Table 41), Document upload (Table 56).
 * Creates tables only; no existing table or row is touched.
 */
export class CmsMasters1792400000000 implements MigrationInterface {
  name = 'CmsMasters1792400000000';

  public async up(q: QueryRunner): Promise<void> {
    const base = `
      "id"        uuid        NOT NULL DEFAULT gen_random_uuid(),
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now(),
      "isDelete"  boolean     NOT NULL DEFAULT false,
      "isActive"  boolean     NOT NULL DEFAULT true`;
    const nameCheck = (t: string, min: number) => `CONSTRAINT "CHK_${t}_name_trimmed" CHECK ("name" = btrim("name") AND length("name") >= ${min})`;
    const codeCheck = (t: string, re: string) => `CONSTRAINT "CHK_${t}_code_upper" CHECK ("code" = upper("code") AND "code" ~ '${re}')`;
    const pinCheck = (t: string) => `CONSTRAINT "CHK_${t}_pin" CHECK ("pinCode" IS NULL OR "pinCode" ~ '^[0-9]{6}$')`;

    /* ---- Department Master ---- */
    await q.query(`
      CREATE TABLE "departments" (${base},
        "name"        varchar(100) NOT NULL,
        "code"        varchar(20)  NOT NULL,
        "description" varchar(500) NULL,
        CONSTRAINT "PK_departments" PRIMARY KEY ("id"),
        ${nameCheck('departments', 2)},
        ${codeCheck('departments', '^[A-Z][A-Z0-9-]{1,19}$')}
      )`);
    await q.query(`CREATE UNIQUE INDEX "UQ_departments_code_active" ON "departments" ("code") WHERE "isDelete" = false`);
    await q.query(`CREATE UNIQUE INDEX "UQ_departments_name_active" ON "departments" (lower("name")) WHERE "isDelete" = false`);

    /* ---- College Master ---- */
    await q.query(`
      CREATE TABLE "colleges" (${base},
        "name"          varchar(150) NOT NULL,
        "code"          varchar(20)  NOT NULL,
        "districtId"    uuid         NOT NULL,
        "talukaId"      uuid         NULL,
        "address"       varchar(300) NULL,
        "pinCode"       char(6)      NULL,
        "contactNumber" varchar(15)  NULL,
        "email"         varchar(254) NULL,
        CONSTRAINT "PK_colleges" PRIMARY KEY ("id"),
        CONSTRAINT "FK_colleges_district" FOREIGN KEY ("districtId") REFERENCES "districts"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_colleges_taluka" FOREIGN KEY ("talukaId") REFERENCES "talukas"("id") ON DELETE RESTRICT,
        ${nameCheck('colleges', 2)},
        ${codeCheck('colleges', '^[A-Z][A-Z0-9-]{1,19}$')},
        ${pinCheck('colleges')}
      )`);
    await q.query(`CREATE UNIQUE INDEX "UQ_colleges_code_active" ON "colleges" ("code") WHERE "isDelete" = false`);
    await q.query(`CREATE UNIQUE INDEX "UQ_colleges_district_name_active" ON "colleges" ("districtId", lower("name")) WHERE "isDelete" = false`);
    await q.query(`CREATE INDEX "IDX_colleges_districtId" ON "colleges" ("districtId")`);
    await q.query(`CREATE INDEX "IDX_colleges_talukaId" ON "colleges" ("talukaId")`);

    /* ---- Training Centre Type Master (seeded with the list in F-ADM-CEN-03) ---- */
    await q.query(`
      CREATE TABLE "training_centre_types" (${base},
        "name"        varchar(100) NOT NULL,
        "code"        varchar(20)  NOT NULL,
        "description" varchar(500) NULL,
        CONSTRAINT "PK_training_centre_types" PRIMARY KEY ("id"),
        ${nameCheck('training_centre_types', 2)},
        ${codeCheck('training_centre_types', '^[A-Z][A-Z0-9-]{1,19}$')}
      )`);
    await q.query(`CREATE UNIQUE INDEX "UQ_training_centre_types_code_active" ON "training_centre_types" ("code") WHERE "isDelete" = false`);
    await q.query(`CREATE UNIQUE INDEX "UQ_training_centre_types_name_active" ON "training_centre_types" (lower("name")) WHERE "isDelete" = false`);
    await q.query(`
      INSERT INTO "training_centre_types" ("name", "code", "description") VALUES
        ('Owned', 'OWNED', 'Centre owned by the programme.'),
        ('Partner', 'PARTNER', 'Centre run by a partner organisation.'),
        ('Affiliated', 'AFFILIATED', 'Centre affiliated to the programme.'),
        ('Other', 'OTHER', 'Any other ownership arrangement.')`);

    /* ---- Training Centre Master (Table 32, sections A–B) ---- */
    await q.query(`CREATE SEQUENCE "training_centre_code_seq"`);
    await q.query(`
      CREATE TABLE "training_centres" (${base},
        "name"               varchar(150) NOT NULL,
        "code"               varchar(10)  NOT NULL,
        "centreTypeId"       uuid         NULL,
        "districtId"         uuid         NOT NULL,
        "talukaId"           uuid         NULL,
        "contactNumber"      varchar(15)  NULL,
        "email"              varchar(254) NULL,
        "pocName"            varchar(120) NULL,
        "pocMobile"          varchar(10)  NULL,
        "centreHead"         varchar(120) NULL,
        "alternativeContact" varchar(160) NULL,
        "coordinator1"       varchar(160) NULL,
        "coordinator2"       varchar(160) NULL,
        CONSTRAINT "PK_training_centres" PRIMARY KEY ("id"),
        CONSTRAINT "FK_training_centres_type" FOREIGN KEY ("centreTypeId") REFERENCES "training_centre_types"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_training_centres_district" FOREIGN KEY ("districtId") REFERENCES "districts"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_training_centres_taluka" FOREIGN KEY ("talukaId") REFERENCES "talukas"("id") ON DELETE RESTRICT,
        ${nameCheck('training_centres', 3)},
        ${codeCheck('training_centres', '^[A-Z][A-Z0-9]{1,9}$')},
        CONSTRAINT "CHK_training_centres_poc_mobile" CHECK ("pocMobile" IS NULL OR "pocMobile" ~ '^[6-9][0-9]{9}$')
      )`);
    await q.query(`CREATE UNIQUE INDEX "UQ_training_centres_code_active" ON "training_centres" ("code") WHERE "isDelete" = false`);
    await q.query(`CREATE UNIQUE INDEX "UQ_training_centres_district_name_active" ON "training_centres" ("districtId", lower("name")) WHERE "isDelete" = false`);
    await q.query(`CREATE INDEX "IDX_training_centres_districtId" ON "training_centres" ("districtId")`);
    await q.query(`CREATE INDEX "IDX_training_centres_talukaId" ON "training_centres" ("talukaId")`);
    await q.query(`CREATE INDEX "IDX_training_centres_centreTypeId" ON "training_centres" ("centreTypeId")`);

    /* ---- Location Information (one per centre) ---- */
    await q.query(`
      CREATE TABLE "centre_locations" (${base},
        "centreId"        uuid         NOT NULL,
        "address"         varchar(300) NOT NULL,
        "pinCode"         char(6)      NULL,
        "locationUrl"     varchar(500) NULL,
        "nearestLandmark" varchar(200) NULL,
        "nearestStation"  varchar(200) NULL,
        "publicTransport" varchar(200) NULL,
        "parking"         varchar(10)  NULL,
        "remarks"         varchar(500) NULL,
        CONSTRAINT "PK_centre_locations" PRIMARY KEY ("id"),
        CONSTRAINT "FK_centre_locations_centre" FOREIGN KEY ("centreId") REFERENCES "training_centres"("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_centre_locations_address" CHECK ("address" = btrim("address") AND length("address") >= 5),
        ${pinCheck('centre_locations')},
        CONSTRAINT "CHK_centre_locations_url" CHECK ("locationUrl" IS NULL OR "locationUrl" LIKE 'https://%'),
        CONSTRAINT "CHK_centre_locations_parking" CHECK ("parking" IS NULL OR "parking" IN ('YES', 'NO', 'LIMITED'))
      )`);
    await q.query(`CREATE UNIQUE INDEX "UQ_centre_locations_centre_active" ON "centre_locations" ("centreId") WHERE "isDelete" = false`);

    /* ---- Capacity & Infrastructure (one per centre; Table 32 sections C–D) ---- */
    await q.query(`
      CREATE TABLE "centre_infrastructure" (${base},
        "centreId"           uuid         NOT NULL,
        "maxSeatingCapacity" integer      NOT NULL,
        "numberOfFloors"     integer      NULL,
        "trainingRooms"      integer      NULL,
        "computerSystems"    integer      NULL,
        "internetType"       varchar(60)  NULL,
        "internetSpeed"      varchar(60)  NULL,
        "hasLift"            boolean      NULL,
        "hasAc"              boolean      NULL,
        "hasWashroom"        boolean      NULL,
        "hasDrinkingWater"   boolean      NULL,
        "powerBackup"        varchar(200) NULL,
        "facilities"         jsonb        NOT NULL DEFAULT '{}'::jsonb,
        CONSTRAINT "PK_centre_infrastructure" PRIMARY KEY ("id"),
        CONSTRAINT "FK_centre_infrastructure_centre" FOREIGN KEY ("centreId") REFERENCES "training_centres"("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_centre_infrastructure_counts" CHECK (
          "maxSeatingCapacity" >= 1
          AND ("numberOfFloors" IS NULL OR "numberOfFloors" >= 0)
          AND ("trainingRooms" IS NULL OR "trainingRooms" >= 0)
          AND ("computerSystems" IS NULL OR "computerSystems" >= 0))
      )`);
    await q.query(`CREATE UNIQUE INDEX "UQ_centre_infrastructure_centre_active" ON "centre_infrastructure" ("centreId") WHERE "isDelete" = false`);

    /* ---- Batch Master (Table 40) ---- */
    await q.query(`
      CREATE TABLE "batches" (${base},
        "centreId"     uuid         NOT NULL,
        "name"         varchar(100) NOT NULL,
        "code"         varchar(30)  NOT NULL,
        "trackName"    varchar(100) NULL,
        "capacity"     integer      NOT NULL,
        "startDate"    date         NOT NULL,
        "endDate"      date         NULL,
        "deliveryMode" varchar(10)  NOT NULL,
        "batchStatus"  varchar(12)  NOT NULL DEFAULT 'PLANNED',
        CONSTRAINT "PK_batches" PRIMARY KEY ("id"),
        CONSTRAINT "FK_batches_centre" FOREIGN KEY ("centreId") REFERENCES "training_centres"("id") ON DELETE RESTRICT,
        ${nameCheck('batches', 2)},
        ${codeCheck('batches', '^[A-Z0-9][A-Z0-9-]{1,29}$')},
        CONSTRAINT "CHK_batches_capacity" CHECK ("capacity" >= 1),
        CONSTRAINT "CHK_batches_dates" CHECK ("endDate" IS NULL OR "endDate" > "startDate"),
        CONSTRAINT "CHK_batches_mode" CHECK ("deliveryMode" IN ('OFFLINE', 'ONLINE', 'BLENDED')),
        CONSTRAINT "CHK_batches_status" CHECK ("batchStatus" IN ('PLANNED', 'OPEN', 'FULL', 'CLOSED', 'CANCELLED'))
      )`);
    await q.query(`CREATE UNIQUE INDEX "UQ_batches_code_active" ON "batches" ("code") WHERE "isDelete" = false`);
    await q.query(`CREATE UNIQUE INDEX "UQ_batches_centre_name_active" ON "batches" ("centreId", lower("name")) WHERE "isDelete" = false`);
    await q.query(`CREATE INDEX "IDX_batches_centreId" ON "batches" ("centreId")`);

    /* ---- Assign Batch (Table 41): one non-deleted assignment per student ---- */
    await q.query(`
      CREATE TABLE "batch_assignments" (${base},
        "batchId"    uuid         NOT NULL,
        "studentId"  uuid         NOT NULL,
        "reasonCode" varchar(30)  NULL,
        "remarks"    varchar(500) NULL,
        "assignedAt" timestamptz  NOT NULL DEFAULT now(),
        CONSTRAINT "PK_batch_assignments" PRIMARY KEY ("id"),
        CONSTRAINT "FK_batch_assignments_batch" FOREIGN KEY ("batchId") REFERENCES "batches"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_batch_assignments_student" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_batch_assignments_reason" CHECK ("reasonCode" IS NULL OR "reasonCode" IN ('PREFERRED_CENTRE_FULL', 'CANDIDATE_REQUEST', 'PROGRAMME_DECISION', 'OTHER'))
      )`);
    await q.query(`CREATE UNIQUE INDEX "UQ_batch_assignments_student_active" ON "batch_assignments" ("studentId") WHERE "isDelete" = false`);
    await q.query(`CREATE INDEX "IDX_batch_assignments_batchId" ON "batch_assignments" ("batchId")`);

    /* ---- Document Master (Table 56) ---- */
    await q.query(`
      CREATE TABLE "documents" (${base},
        "title"              varchar(150) NOT NULL,
        "category"           varchar(30)  NOT NULL,
        "description"        varchar(500) NULL,
        "districtId"         uuid         NULL,
        "centreId"           uuid         NULL,
        "fileName"           varchar(255) NOT NULL,
        "mimeType"           varchar(100) NOT NULL,
        "fileSize"           integer      NOT NULL,
        "sha256"             char(64)     NOT NULL,
        "storageKey"         varchar(100) NOT NULL,
        "uploadedById"       uuid         NULL,
        "verificationStatus" varchar(10)  NOT NULL DEFAULT 'PENDING',
        "verificationReason" varchar(300) NULL,
        "verifiedById"       uuid         NULL,
        "verifiedAt"         timestamptz  NULL,
        CONSTRAINT "PK_documents" PRIMARY KEY ("id"),
        CONSTRAINT "FK_documents_district" FOREIGN KEY ("districtId") REFERENCES "districts"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_documents_centre" FOREIGN KEY ("centreId") REFERENCES "training_centres"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_documents_uploaded_by" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_documents_verified_by" FOREIGN KEY ("verifiedById") REFERENCES "users"("id") ON DELETE SET NULL,
        CONSTRAINT "CHK_documents_title_trimmed" CHECK ("title" = btrim("title") AND length("title") >= 3),
        CONSTRAINT "CHK_documents_category" CHECK ("category" IN ('CENTRE_PROFILE', 'AGREEMENT', 'APPROVAL_LETTER', 'CERTIFICATE', 'REPORT', 'FINANCE', 'PHOTO_EVIDENCE', 'OTHER')),
        CONSTRAINT "CHK_documents_file_size" CHECK ("fileSize" > 0),
        CONSTRAINT "CHK_documents_verification" CHECK ("verificationStatus" IN ('PENDING', 'VERIFIED', 'REJECTED')),
        CONSTRAINT "CHK_documents_rejection_reason" CHECK ("verificationStatus" <> 'REJECTED' OR "verificationReason" IS NOT NULL)
      )`);
    await q.query(`CREATE UNIQUE INDEX "UQ_documents_storage_key" ON "documents" ("storageKey")`);
    await q.query(`CREATE INDEX "IDX_documents_category" ON "documents" ("category")`);
    await q.query(`CREATE INDEX "IDX_documents_districtId" ON "documents" ("districtId")`);
    await q.query(`CREATE INDEX "IDX_documents_centreId" ON "documents" ("centreId")`);

    for (const t of [
      'departments', 'colleges', 'training_centre_types', 'training_centres', 'centre_locations',
      'centre_infrastructure', 'batches', 'batch_assignments', 'documents',
    ]) {
      await q.query(`CREATE TRIGGER "TRG_${t}_updated_at" BEFORE UPDATE ON "${t}" FOR EACH ROW EXECUTE FUNCTION "set_updated_at"()`);
    }
  }

  /* Children first: the foreign keys are RESTRICT. */
  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "documents"`);
    await q.query(`DROP TABLE IF EXISTS "batch_assignments"`);
    await q.query(`DROP TABLE IF EXISTS "batches"`);
    await q.query(`DROP TABLE IF EXISTS "centre_infrastructure"`);
    await q.query(`DROP TABLE IF EXISTS "centre_locations"`);
    await q.query(`DROP TABLE IF EXISTS "training_centres"`);
    await q.query(`DROP SEQUENCE IF EXISTS "training_centre_code_seq"`);
    await q.query(`DROP TABLE IF EXISTS "training_centre_types"`);
    await q.query(`DROP TABLE IF EXISTS "colleges"`);
    await q.query(`DROP TABLE IF EXISTS "departments"`);
  }
}
