import type { MigrationInterface, QueryRunner } from 'typeorm';

/*
 * LMS Admin — Track Variant Master (AMRUT_KALASH_03 L-07 / FR-307, screen UI-317, table DB-310 with the
 * Module 3 parts of DB-335 / DB-337 / DB-340): lms_track_variants, one per (Module 3 course module, technology
 * track), and its curriculum in child tables:
 *   lms_track_variant_phases                 phases 1–7 (DB-310 module_phase)
 *   lms_track_variant_modules                track modules (DB-310 unit / track module), each in a phase
 *   lms_track_variant_components             mini / integration projects, capstone, business simulation, portfolio
 *   lms_track_variant_oft_cards              OFT assignment cards (F-LMS-29, DB-335 oft_assignment)
 *   lms_track_variant_assessment_components  the ten-component framework (F-LMS-18-10)
 *   lms_track_variant_readiness_gates        readiness gates 1–6 (F-LMS-32, DB-337 readiness_gate)
 *
 * Same conventions as LmsEntities: base columns, partial unique indexes over non-deleted rows, CHECK
 * constraints repeating the validators' shape rules, RESTRICT foreign keys, set_updated_at triggers.
 * technology_tracks belongs to the Admin Panel: referenced only, never written. Nothing is seeded: phase
 * names, track-module titles, OFT cards and gates come from each track's syllabus and are entered on screen.
 * "Module number 3" for lms_track_variants.courseModuleId is checked by the service (it lives on another row).
 */
export class LmsTrackVariants1792750000000 implements MigrationInterface {
  name = 'LmsTrackVariants1792750000000';

  public async up(q: QueryRunner): Promise<void> {
    const base = `
      "id"        uuid        NOT NULL DEFAULT gen_random_uuid(),
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now(),
      "isDelete"  boolean     NOT NULL DEFAULT false,
      "isActive"  boolean     NOT NULL DEFAULT true`;
    const trimmed = (col: string, min: number) => `("${col}" = btrim("${col}") AND length("${col}") >= ${min})`;
    const optTrimmed = (col: string) => `("${col}" IS NULL OR ${trimmed(col, 1)})`;
    const variantFk = (t: string) =>
      `CONSTRAINT "FK_${t}_variant" FOREIGN KEY ("trackVariantId") REFERENCES "lms_track_variants"("id") ON DELETE RESTRICT`;
    const evidence = `"evidenceTypes" text[] NOT NULL`;
    const evidenceCheck = (t: string) =>
      `CONSTRAINT "CHK_${t}_evidence_types" CHECK (cardinality("evidenceTypes") >= 1 AND "evidenceTypes" <@ ARRAY['PHOTOGRAPH','FIELD_LOG','DOCUMENT','LINK','HOST_NOTE']::text[])`;

    await q.query(`
      CREATE TABLE "lms_track_variants" (${base},
        "courseModuleId"       uuid          NOT NULL,
        "trackId"              uuid          NOT NULL,
        "status"               varchar(12)   NOT NULL DEFAULT 'DRAFT',
        "expectedTrackModules" smallint      NULL,
        "expectedOftCards"     smallint      NULL,
        "syllabusReference"    varchar(120)  NULL,
        "description"          varchar(3000) NULL,
        "publishedAt"          timestamptz   NULL,
        CONSTRAINT "PK_lms_track_variants" PRIMARY KEY ("id"),
        CONSTRAINT "FK_lms_track_variants_course_module" FOREIGN KEY ("courseModuleId") REFERENCES "lms_course_modules"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_lms_track_variants_track" FOREIGN KEY ("trackId") REFERENCES "technology_tracks"("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_lms_track_variants_status" CHECK ("status" IN ('DRAFT','PUBLISHED','RETIRED')),
        CONSTRAINT "CHK_lms_track_variants_track_modules" CHECK ("expectedTrackModules" IS NULL OR "expectedTrackModules" BETWEEN 22 AND 23),
        CONSTRAINT "CHK_lms_track_variants_oft_cards" CHECK ("expectedOftCards" IS NULL OR "expectedOftCards" BETWEEN 12 AND 13),
        CONSTRAINT "CHK_lms_track_variants_syllabus_ref" CHECK (${optTrimmed('syllabusReference')}),
        CONSTRAINT "CHK_lms_track_variants_description" CHECK (${optTrimmed('description')})
      )`);
    await q.query(`CREATE UNIQUE INDEX "UQ_lms_track_variants_pair_active" ON "lms_track_variants" ("courseModuleId", "trackId") WHERE "isDelete" = false`);
    await q.query(`CREATE INDEX "IDX_lms_track_variants_courseModuleId" ON "lms_track_variants" ("courseModuleId")`);
    await q.query(`CREATE INDEX "IDX_lms_track_variants_trackId" ON "lms_track_variants" ("trackId")`);
    await q.query(`CREATE INDEX "IDX_lms_track_variants_status" ON "lms_track_variants" ("status")`);
    await q.query(`CREATE INDEX "IDX_lms_track_variants_isActive" ON "lms_track_variants" ("isActive")`);

    await q.query(`
      CREATE TABLE "lms_track_variant_phases" (${base},
        "trackVariantId" uuid          NOT NULL,
        "phaseNumber"    smallint      NOT NULL,
        "title"          varchar(160)  NOT NULL,
        "description"    varchar(3000) NULL,
        CONSTRAINT "PK_lms_track_variant_phases" PRIMARY KEY ("id"),
        ${variantFk('lms_track_variant_phases')},
        CONSTRAINT "CHK_lms_track_variant_phases_number" CHECK ("phaseNumber" BETWEEN 1 AND 7),
        CONSTRAINT "CHK_lms_track_variant_phases_title" CHECK (${trimmed('title', 3)}),
        CONSTRAINT "CHK_lms_track_variant_phases_description" CHECK (${optTrimmed('description')})
      )`);
    await q.query(`CREATE UNIQUE INDEX "UQ_lms_track_variant_phases_number_active" ON "lms_track_variant_phases" ("trackVariantId", "phaseNumber") WHERE "isDelete" = false`);
    await q.query(`CREATE INDEX "IDX_lms_track_variant_phases_trackVariantId" ON "lms_track_variant_phases" ("trackVariantId")`);

    await q.query(`
      CREATE TABLE "lms_track_variant_modules" (${base},
        "trackVariantId" uuid          NOT NULL,
        "phaseId"        uuid          NOT NULL,
        "code"           varchar(30)   NOT NULL,
        "title"          varchar(160)  NOT NULL,
        "sortOrder"      smallint      NOT NULL,
        "lectureHours"   numeric(6,2)  NULL,
        "practicalHours" numeric(6,2)  NULL,
        "description"    varchar(3000) NULL,
        CONSTRAINT "PK_lms_track_variant_modules" PRIMARY KEY ("id"),
        ${variantFk('lms_track_variant_modules')},
        CONSTRAINT "FK_lms_track_variant_modules_phase" FOREIGN KEY ("phaseId") REFERENCES "lms_track_variant_phases"("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_lms_track_variant_modules_code" CHECK ("code" = upper("code") AND "code" ~ '^[A-Z0-9][A-Z0-9-]{0,29}$'),
        CONSTRAINT "CHK_lms_track_variant_modules_title" CHECK (${trimmed('title', 3)}),
        CONSTRAINT "CHK_lms_track_variant_modules_sort" CHECK ("sortOrder" >= 1),
        CONSTRAINT "CHK_lms_track_variant_modules_hours" CHECK (("lectureHours" IS NULL OR "lectureHours" >= 0) AND ("practicalHours" IS NULL OR "practicalHours" >= 0)),
        CONSTRAINT "CHK_lms_track_variant_modules_description" CHECK (${optTrimmed('description')})
      )`);
    await q.query(`CREATE UNIQUE INDEX "UQ_lms_track_variant_modules_code_active" ON "lms_track_variant_modules" ("trackVariantId", "code") WHERE "isDelete" = false`);
    await q.query(`CREATE UNIQUE INDEX "UQ_lms_track_variant_modules_sort_active" ON "lms_track_variant_modules" ("trackVariantId", "sortOrder") WHERE "isDelete" = false`);
    await q.query(`CREATE INDEX "IDX_lms_track_variant_modules_trackVariantId" ON "lms_track_variant_modules" ("trackVariantId")`);
    await q.query(`CREATE INDEX "IDX_lms_track_variant_modules_phaseId" ON "lms_track_variant_modules" ("phaseId")`);

    await q.query(`
      CREATE TABLE "lms_track_variant_components" (${base},
        "trackVariantId" uuid          NOT NULL,
        "kind"           varchar(30)   NOT NULL,
        "title"          varchar(150)  NOT NULL,
        "trackModuleId"  uuid          NULL,
        "description"    varchar(3000) NULL,
        CONSTRAINT "PK_lms_track_variant_components" PRIMARY KEY ("id"),
        ${variantFk('lms_track_variant_components')},
        CONSTRAINT "FK_lms_track_variant_components_module" FOREIGN KEY ("trackModuleId") REFERENCES "lms_track_variant_modules"("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_lms_track_variant_components_kind" CHECK ("kind" IN ('MINI_PROJECT','INTEGRATION_PROJECT','CAPSTONE_PROJECT','BUSINESS_SIMULATION','PORTFOLIO')),
        CONSTRAINT "CHK_lms_track_variant_components_title" CHECK (${trimmed('title', 3)}),
        CONSTRAINT "CHK_lms_track_variant_components_description" CHECK (${optTrimmed('description')})
      )`);
    /* One capstone, one business simulation and one portfolio per variant. */
    await q.query(`
      CREATE UNIQUE INDEX "UQ_lms_track_variant_components_single_active" ON "lms_track_variant_components" ("trackVariantId", "kind")
      WHERE "isDelete" = false AND "kind" IN ('CAPSTONE_PROJECT','BUSINESS_SIMULATION','PORTFOLIO')`);
    await q.query(`CREATE INDEX "IDX_lms_track_variant_components_trackVariantId" ON "lms_track_variant_components" ("trackVariantId")`);
    await q.query(`CREATE INDEX "IDX_lms_track_variant_components_trackModuleId" ON "lms_track_variant_components" ("trackModuleId")`);

    await q.query(`
      CREATE TABLE "lms_track_variant_oft_cards" (${base},
        "trackVariantId"           uuid          NOT NULL,
        "oftCode"                  varchar(20)   NOT NULL,
        "title"                    varchar(150)  NOT NULL,
        "stage"                    varchar(60)   NULL,
        "linkedTrackModuleId"      uuid          NULL,
        "instructions"             text          NOT NULL,
        "hoursMin"                 numeric(6,2)  NOT NULL,
        "hoursMax"                 numeric(6,2)  NOT NULL,
        "deliverable"              varchar(1000) NOT NULL,
        ${evidence},
        "evidenceNotes"            varchar(2000) NULL,
        "hostVerificationRequired" boolean       NOT NULL DEFAULT false,
        "status"                   varchar(12)   NOT NULL DEFAULT 'DRAFT',
        CONSTRAINT "PK_lms_track_variant_oft_cards" PRIMARY KEY ("id"),
        ${variantFk('lms_track_variant_oft_cards')},
        CONSTRAINT "FK_lms_track_variant_oft_cards_module" FOREIGN KEY ("linkedTrackModuleId") REFERENCES "lms_track_variant_modules"("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_lms_track_variant_oft_cards_code" CHECK ("oftCode" ~ '^OFT-M3-T[0-9]{2}-[0-9]{2}$'),
        CONSTRAINT "CHK_lms_track_variant_oft_cards_title" CHECK (${trimmed('title', 3)}),
        CONSTRAINT "CHK_lms_track_variant_oft_cards_stage" CHECK (${optTrimmed('stage')}),
        CONSTRAINT "CHK_lms_track_variant_oft_cards_instructions" CHECK (length(btrim("instructions")) BETWEEN 20 AND 8000),
        CONSTRAINT "CHK_lms_track_variant_oft_cards_hours" CHECK ("hoursMin" > 0 AND "hoursMin" <= "hoursMax"),
        CONSTRAINT "CHK_lms_track_variant_oft_cards_deliverable" CHECK (${trimmed('deliverable', 10)}),
        ${evidenceCheck('lms_track_variant_oft_cards')},
        CONSTRAINT "CHK_lms_track_variant_oft_cards_evidence_notes" CHECK (${optTrimmed('evidenceNotes')}),
        CONSTRAINT "CHK_lms_track_variant_oft_cards_status" CHECK ("status" IN ('DRAFT','PUBLISHED','RETIRED'))
      )`);
    await q.query(`CREATE UNIQUE INDEX "UQ_lms_track_variant_oft_cards_code_active" ON "lms_track_variant_oft_cards" ("trackVariantId", "oftCode") WHERE "isDelete" = false`);
    await q.query(`CREATE INDEX "IDX_lms_track_variant_oft_cards_trackVariantId" ON "lms_track_variant_oft_cards" ("trackVariantId")`);
    await q.query(`CREATE INDEX "IDX_lms_track_variant_oft_cards_linkedTrackModuleId" ON "lms_track_variant_oft_cards" ("linkedTrackModuleId")`);
    await q.query(`CREATE INDEX "IDX_lms_track_variant_oft_cards_status" ON "lms_track_variant_oft_cards" ("status")`);

    await q.query(`
      CREATE TABLE "lms_track_variant_assessment_components" (${base},
        "trackVariantId" uuid         NOT NULL,
        "componentCode"  varchar(30)  NOT NULL,
        "label"          varchar(150) NOT NULL,
        "weight"         numeric(5,2) NULL,
        "source"         varchar(200) NULL,
        "indicative"     boolean      NOT NULL DEFAULT true,
        "sortOrder"      smallint     NOT NULL,
        CONSTRAINT "PK_lms_track_variant_assessment_components" PRIMARY KEY ("id"),
        ${variantFk('lms_track_variant_assessment_components')},
        CONSTRAINT "CHK_lms_track_variant_assessment_components_code" CHECK ("componentCode" = upper("componentCode") AND "componentCode" ~ '^[A-Z0-9][A-Z0-9_-]{0,29}$'),
        CONSTRAINT "CHK_lms_track_variant_assessment_components_label" CHECK (${trimmed('label', 2)}),
        CONSTRAINT "CHK_lms_track_variant_assessment_components_weight" CHECK ("weight" IS NULL OR "weight" BETWEEN 0 AND 100),
        CONSTRAINT "CHK_lms_track_variant_assessment_components_source" CHECK (${optTrimmed('source')}),
        CONSTRAINT "CHK_lms_track_variant_assessment_components_sort" CHECK ("sortOrder" BETWEEN 1 AND 10)
      )`);
    await q.query(`CREATE UNIQUE INDEX "UQ_lms_track_variant_assessment_components_code_active" ON "lms_track_variant_assessment_components" ("trackVariantId", "componentCode") WHERE "isDelete" = false`);
    await q.query(`CREATE UNIQUE INDEX "UQ_lms_track_variant_assessment_components_sort_active" ON "lms_track_variant_assessment_components" ("trackVariantId", "sortOrder") WHERE "isDelete" = false`);
    await q.query(`CREATE INDEX "IDX_lms_track_variant_assessment_components_trackVariantId" ON "lms_track_variant_assessment_components" ("trackVariantId")`);

    await q.query(`
      CREATE TABLE "lms_track_variant_readiness_gates" (${base},
        "trackVariantId"         uuid          NOT NULL,
        "gateNumber"             smallint      NOT NULL,
        "title"                  varchar(120)  NOT NULL,
        "heldAfterTrackModuleId" uuid          NOT NULL,
        "demonstration"          varchar(4000) NOT NULL,
        ${evidence},
        "evidenceNotes"          varchar(2000) NULL,
        "remediationPath"        varchar(2000) NOT NULL,
        "clearanceMode"          varchar(20)   NOT NULL DEFAULT 'ASSESSOR_DECIDES',
        "clearanceMinBand"       smallint      NULL,
        CONSTRAINT "PK_lms_track_variant_readiness_gates" PRIMARY KEY ("id"),
        ${variantFk('lms_track_variant_readiness_gates')},
        CONSTRAINT "FK_lms_track_variant_readiness_gates_module" FOREIGN KEY ("heldAfterTrackModuleId") REFERENCES "lms_track_variant_modules"("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_lms_track_variant_readiness_gates_number" CHECK ("gateNumber" BETWEEN 1 AND 6),
        CONSTRAINT "CHK_lms_track_variant_readiness_gates_title" CHECK (${trimmed('title', 3)}),
        CONSTRAINT "CHK_lms_track_variant_readiness_gates_demonstration" CHECK (${trimmed('demonstration', 20)}),
        ${evidenceCheck('lms_track_variant_readiness_gates')},
        CONSTRAINT "CHK_lms_track_variant_readiness_gates_evidence_notes" CHECK (${optTrimmed('evidenceNotes')}),
        CONSTRAINT "CHK_lms_track_variant_readiness_gates_remediation" CHECK (${trimmed('remediationPath', 10)}),
        CONSTRAINT "CHK_lms_track_variant_readiness_gates_clearance" CHECK (
          ("clearanceMode" = 'ASSESSOR_DECIDES' AND "clearanceMinBand" IS NULL)
          OR ("clearanceMode" = 'MINIMUM_BAND' AND "clearanceMinBand" BETWEEN 1 AND 5))
      )`);
    await q.query(`CREATE UNIQUE INDEX "UQ_lms_track_variant_readiness_gates_number_active" ON "lms_track_variant_readiness_gates" ("trackVariantId", "gateNumber") WHERE "isDelete" = false`);
    await q.query(`CREATE INDEX "IDX_lms_track_variant_readiness_gates_trackVariantId" ON "lms_track_variant_readiness_gates" ("trackVariantId")`);
    await q.query(`CREATE INDEX "IDX_lms_track_variant_readiness_gates_module" ON "lms_track_variant_readiness_gates" ("heldAfterTrackModuleId")`);

    for (const t of [
      'lms_track_variants',
      'lms_track_variant_phases',
      'lms_track_variant_modules',
      'lms_track_variant_components',
      'lms_track_variant_oft_cards',
      'lms_track_variant_assessment_components',
      'lms_track_variant_readiness_gates',
    ]) {
      await q.query(`CREATE TRIGGER "TRG_${t}_updated_at" BEFORE UPDATE ON "${t}" FOR EACH ROW EXECUTE FUNCTION "set_updated_at"()`);
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "lms_track_variant_readiness_gates"`);
    await q.query(`DROP TABLE IF EXISTS "lms_track_variant_assessment_components"`);
    await q.query(`DROP TABLE IF EXISTS "lms_track_variant_oft_cards"`);
    await q.query(`DROP TABLE IF EXISTS "lms_track_variant_components"`);
    await q.query(`DROP TABLE IF EXISTS "lms_track_variant_modules"`);
    await q.query(`DROP TABLE IF EXISTS "lms_track_variant_phases"`);
    await q.query(`DROP TABLE IF EXISTS "lms_track_variants"`);
  }
}
