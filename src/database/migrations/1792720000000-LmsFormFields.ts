import type { MigrationInterface, QueryRunner } from 'typeorm';

/*
 * LMS Admin — Form Field Configuration (AMRUT_KALASH_03 L-38 / FR-338, form F-LMS-FFC Table 40, table DB-305
 * form_field_config "same structure as DB-207", AD-12): lms_form_fields, one row per field of a configurable
 * form, keyed (formCode, fieldCode) among non-deleted rows.
 *
 * Same conventions as LmsEntities:
 * - The common columns (id UUID, createdAt / updatedAt TIMESTAMPTZ, isDelete, isActive). isActive is the
 *   field status (L-38: ACTIVE; custom field ACTIVE ↔ ARCHIVED).
 * - Uniqueness uses PARTIAL unique indexes over non-deleted rows: the field key per form, and the label
 *   per form case-insensitively (F-LMS-FFC-03 "Label unique within the form").
 * - CHECK constraints repeat the validators' shape rules and the spec's fixed rules: a system-locked field is
 *   visible and compulsory; a hidden field cannot be compulsory (F-LMS-FFC-04 / -05).
 * - No foreign key: DB-305 lists none (the configuration is per form, not per LMS entity).
 *
 * Seeded (BRL-349, Table "Form Field Configuration (Trainer Profile) — seeded with every field optional except
 * Trainer Name"): the standard fields of the Trainer Profile, F-LMS-TRN Table 39, all optional and visible
 * except full_name (system-locked, compulsory on every save). Codes are the API field names of Table 39.
 */
export class LmsFormFields1792720000000 implements MigrationInterface {
  name = 'LmsFormFields1792720000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE "lms_form_fields" (
        "id"             uuid         NOT NULL DEFAULT gen_random_uuid(),
        "createdAt"      timestamptz  NOT NULL DEFAULT now(),
        "updatedAt"      timestamptz  NOT NULL DEFAULT now(),
        "isDelete"       boolean      NOT NULL DEFAULT false,
        "isActive"       boolean      NOT NULL DEFAULT true,
        "formCode"       varchar(40)  NOT NULL,
        "fieldCode"      varchar(60)  NOT NULL,
        "isCustom"       boolean      NOT NULL DEFAULT false,
        "isSystemLocked" boolean      NOT NULL DEFAULT false,
        "label"          varchar(80)  NOT NULL,
        "helpText"       varchar(200) NULL,
        "translations"   jsonb        NOT NULL DEFAULT '{}'::jsonb,
        "sectionCode"    varchar(40)  NOT NULL,
        "sortOrder"      integer      NOT NULL,
        "dataType"       varchar(20)  NOT NULL,
        "options"        jsonb        NULL,
        "rules"          jsonb        NOT NULL DEFAULT '{}'::jsonb,
        "isVisible"      boolean      NOT NULL DEFAULT true,
        "isRequired"     boolean      NOT NULL DEFAULT false,
        "requiredStage"  varchar(20)  NOT NULL DEFAULT 'ON_VERIFICATION',
        "sensitivity"    varchar(20)  NOT NULL DEFAULT 'INTERNAL',
        "isExportable"   boolean      NOT NULL DEFAULT true,
        CONSTRAINT "PK_lms_form_fields" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_lms_form_fields_form_code" CHECK ("formCode" ~ '^[A-Z][A-Z0-9_]{1,39}$'),
        CONSTRAINT "CHK_lms_form_fields_field_code" CHECK ("fieldCode" ~ '^[a-z][a-z0-9_]{1,59}$'),
        CONSTRAINT "CHK_lms_form_fields_section_code" CHECK ("sectionCode" ~ '^[A-Z][A-Z0-9_]{0,39}$'),
        CONSTRAINT "CHK_lms_form_fields_label_trimmed" CHECK ("label" = btrim("label") AND length("label") >= 1),
        CONSTRAINT "CHK_lms_form_fields_help_text_trimmed" CHECK ("helpText" IS NULL OR ("helpText" = btrim("helpText") AND length("helpText") >= 1)),
        CONSTRAINT "CHK_lms_form_fields_translations" CHECK (jsonb_typeof("translations") = 'object'),
        CONSTRAINT "CHK_lms_form_fields_sort_order" CHECK ("sortOrder" >= 0),
        CONSTRAINT "CHK_lms_form_fields_data_type" CHECK ("dataType" IN (
          'TEXT', 'LONG_TEXT', 'NUMBER', 'DATE', 'YES_NO', 'SINGLE_CHOICE', 'MULTIPLE_CHOICE', 'FILE',
          'EMAIL', 'PHONE', 'IMAGE', 'TEXT_ARRAY', 'REFERENCE', 'REFERENCE_ARRAY', 'REPEATING_GROUP', 'ENUM_ARRAY', 'GRID', 'SIGN_OFF')),
        CONSTRAINT "CHK_lms_form_fields_custom_type" CHECK (NOT "isCustom" OR "dataType" IN (
          'TEXT', 'LONG_TEXT', 'NUMBER', 'DATE', 'YES_NO', 'SINGLE_CHOICE', 'MULTIPLE_CHOICE', 'FILE')),
        CONSTRAINT "CHK_lms_form_fields_options" CHECK (
          ("dataType" IN ('SINGLE_CHOICE', 'MULTIPLE_CHOICE') AND jsonb_typeof("options") = 'array' AND jsonb_array_length("options") >= 1)
          OR ("dataType" NOT IN ('SINGLE_CHOICE', 'MULTIPLE_CHOICE') AND "options" IS NULL)),
        CONSTRAINT "CHK_lms_form_fields_rules" CHECK (jsonb_typeof("rules") = 'object'),
        CONSTRAINT "CHK_lms_form_fields_required_stage" CHECK ("requiredStage" IN ('ON_SAVE', 'ON_VERIFICATION')),
        CONSTRAINT "CHK_lms_form_fields_sensitivity" CHECK ("sensitivity" IN ('INTERNAL', 'PERSONAL', 'RESTRICTED')),
        CONSTRAINT "CHK_lms_form_fields_hidden_not_required" CHECK ("isVisible" OR NOT "isRequired"),
        CONSTRAINT "CHK_lms_form_fields_system_locked" CHECK (NOT "isSystemLocked" OR ("isVisible" AND "isRequired" AND "isActive" AND NOT "isCustom")),
        CONSTRAINT "CHK_lms_form_fields_standard_active" CHECK ("isCustom" OR "isActive" OR "isDelete")
      )`);
    await q.query(`CREATE UNIQUE INDEX "UQ_lms_form_fields_field_active" ON "lms_form_fields" ("formCode", "fieldCode") WHERE "isDelete" = false`);
    await q.query(`CREATE UNIQUE INDEX "UQ_lms_form_fields_label_active" ON "lms_form_fields" ("formCode", lower("label")) WHERE "isDelete" = false`);
    /* DB-207 / DB-305 indexes: form_code, section_code, sort_order; status. */
    await q.query(`CREATE INDEX "IDX_lms_form_fields_position" ON "lms_form_fields" ("formCode", "sectionCode", "sortOrder")`);
    await q.query(`CREATE INDEX "IDX_lms_form_fields_isActive" ON "lms_form_fields" ("isActive")`);
    await q.query(`CREATE TRIGGER "TRG_lms_form_fields_updated_at" BEFORE UPDATE ON "lms_form_fields" FOR EACH ROW EXECUTE FUNCTION "set_updated_at"()`);

    await seedTrainerProfileFields(q);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "lms_form_fields"`);
  }
}

/*
 * Standard fields of the Trainer Profile (F-LMS-TRN Table 39), in section order.
 * [fieldCode, label, sectionCode, sortOrder, dataType, sensitivity, isExportable]
 * - F-LMS-TRN-13 / -14 / -15 hold several inputs each ("each"); they are one row per input.
 * - Sensitivity is Table 39's column; F-LMS-TRN-18 is "excluded from exports by default".
 * - F-LMS-TRN-22 (LMS login and status) is managed by the system (status badge, 'Create LMS login'), not
 *   a data-entry field, and F-LMS-TRN-23 is the custom fields themselves: neither is a row here.
 */
const TRAINER_PROFILE_FIELDS: [string, string, string, number, string, string, boolean][] = [
  ['full_name', 'Trainer Name', 'A', 1, 'TEXT', 'PERSONAL', true],
  ['designation', 'Designation', 'A', 2, 'TEXT', 'INTERNAL', true],
  ['trainer_code', 'Trainer ID', 'A', 3, 'TEXT', 'INTERNAL', true],
  ['mobile', 'Contact Number', 'A', 4, 'PHONE', 'PERSONAL', true],
  ['email', 'Official Email', 'A', 5, 'EMAIL', 'PERSONAL', true],
  ['centre_codes', 'Assigned Training Centre', 'A', 6, 'REFERENCE_ARRAY', 'INTERNAL', true],
  ['languages', 'Languages Known', 'A', 7, 'TEXT_ARRAY', 'INTERNAL', true],
  ['joined_on', 'Date of Joining / Association', 'A', 8, 'DATE', 'INTERNAL', true],
  ['photo', 'Trainer Photograph', 'A', 9, 'IMAGE', 'PERSONAL', true],
  ['qualifications', 'Educational Qualifications', 'B', 1, 'REPEATING_GROUP', 'PERSONAL', true],
  ['certifications', 'Additional Certifications', 'B', 2, 'REPEATING_GROUP', 'PERSONAL', true],
  ['primary_domains', 'Primary Training Domain / Technology', 'C', 1, 'REFERENCE_ARRAY', 'INTERNAL', true],
  ['skills', 'Technical / Domain Skills', 'C', 2, 'LONG_TEXT', 'INTERNAL', true],
  ['tools', 'Tools & Platforms', 'C', 3, 'LONG_TEXT', 'INTERNAL', true],
  ['training_areas', 'Training Areas / Modules', 'C', 4, 'LONG_TEXT', 'INTERNAL', true],
  ['exp_total_years', 'Total Relevant Experience', 'D', 1, 'NUMBER', 'INTERNAL', true],
  ['exp_training_years', 'Training Experience', 'D', 2, 'NUMBER', 'INTERNAL', true],
  ['exp_industry_years', 'Industry / Practical Experience', 'D', 3, 'NUMBER', 'INTERNAL', true],
  ['exp_industry_details', 'Industry / Practical Experience Details', 'D', 4, 'LONG_TEXT', 'INTERNAL', true],
  ['exp_training_details', 'Training Experience Details', 'D', 5, 'LONG_TEXT', 'INTERNAL', true],
  ['projects', 'Projects / Implementation Exposure', 'E', 1, 'REPEATING_GROUP', 'INTERNAL', true],
  ['responsibilities', 'AMRUT KALASH Responsibilities', 'F', 1, 'ENUM_ARRAY', 'INTERNAL', true],
  ['competency', 'Trainer Competency Snapshot', 'G', 1, 'GRID', 'INTERNAL', false],
  ['professional_summary', 'Professional Summary', 'H', 1, 'LONG_TEXT', 'INTERNAL', true],
  ['verification', 'Verification and sign-off', 'VERIFICATION', 1, 'SIGN_OFF', 'INTERNAL', true],
  ['signed_copy', 'Signed profile copy', 'VERIFICATION', 2, 'FILE', 'RESTRICTED', true],
];

/*
 * Inserts the Trainer Profile's standard fields that are missing (idempotent: rows already present, or a
 * label already taken, are left alone). Exported so the integration tests can re-apply the seed after they
 * empty the tables between test files.
 */
export async function seedTrainerProfileFields(q: { query: (sql: string, params?: unknown[]) => Promise<unknown> }): Promise<void> {
  for (const [fieldCode, label, sectionCode, sortOrder, dataType, sensitivity, isExportable] of TRAINER_PROFILE_FIELDS) {
    /* BRL-349: only Trainer Name is compulsory (system-locked, on every save); everything else optional. */
    const locked = fieldCode === 'full_name';
    await q.query(
      `INSERT INTO "lms_form_fields"
         ("formCode", "fieldCode", "isCustom", "isSystemLocked", "label", "sectionCode", "sortOrder", "dataType",
          "isVisible", "isRequired", "requiredStage", "sensitivity", "isExportable")
       VALUES ('TRAINER_PROFILE', $1, false, $2, $3, $4, $5, $6, true, $2, $7, $8, $9)
       ON CONFLICT DO NOTHING`,
      [fieldCode, locked, label, sectionCode, sortOrder, dataType, locked ? 'ON_SAVE' : 'ON_VERIFICATION', sensitivity, isExportable],
    );
  }
}
