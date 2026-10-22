import type { MigrationInterface, QueryRunner } from 'typeorm';

/*
 * LMS Admin — Academic calendar and learning configuration (AMRUT_KALASH_03 L-05 / FR-305, form F-LMS-05
 * Table 30, table DB-304 academic_calendar / holiday; the learning-configuration keys are entity settings of
 * DB-302, edited on the same screen UI-313).
 *
 * - lms_academic_calendars: a calendar of one entity (F-LMS-05-02), optionally limited to one centre
 *   enabled for that entity — the centre exception calendar (F-LMS-05-03). Period (F-LMS-05-04: "to later
 *   than from") and working days (F-LMS-05-05: Monday to Sunday, ≥ 1, no default assumed).
 *   The name is unique in the entity (F-LMS-05-01). "No overlap with another calendar of the same entity
 *   and centre" (F-LMS-05-04) is checked by the service while it holds the entity row FOR UPDATE: an
 *   exclusion constraint would need the btree_gist extension, which this database does not install.
 * - lms_calendar_holidays: non-working days of a calendar (F-LMS-05-06), one per date per calendar.
 * - lms_learning_config: values of the learning-configuration keys (F-LMS-05-07) per entity, and per
 *   delivery mode for the mode-specific keys. A change soft-deletes the current row and inserts the new one,
 *   so earlier values stay in the table ("changing a key never rewrites past records", L-05). A key with no
 *   row shows its syllabus value (OQ-012) or 'To Be Confirmed' (OQ-013 / OQ-014 / OQ-015): nothing is seeded.
 *
 * Same conventions as LmsEntities: common columns, partial unique indexes over non-deleted rows, CHECKs
 * repeating the validators' shape rules, RESTRICT foreign keys. training_centres is the Admin Panel's table,
 * only referenced here.
 */
export class LmsAcademicCalendars1792710000000 implements MigrationInterface {
  name = 'LmsAcademicCalendars1792710000000';

  public async up(q: QueryRunner): Promise<void> {
    const base = `
      "id"        uuid        NOT NULL DEFAULT gen_random_uuid(),
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now(),
      "isDelete"  boolean     NOT NULL DEFAULT false,
      "isActive"  boolean     NOT NULL DEFAULT true`;

    await q.query(`
      CREATE TABLE "lms_academic_calendars" (${base},
        "entityId"    uuid         NOT NULL,
        "centreId"    uuid         NULL,
        "name"        varchar(80)  NOT NULL,
        "validFrom"   date         NOT NULL,
        "validTo"     date         NOT NULL,
        "workingDays" varchar(3)[] NOT NULL,
        CONSTRAINT "PK_lms_academic_calendars" PRIMARY KEY ("id"),
        CONSTRAINT "FK_lms_academic_calendars_entity" FOREIGN KEY ("entityId") REFERENCES "lms_entities"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_lms_academic_calendars_centre" FOREIGN KEY ("centreId") REFERENCES "training_centres"("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_lms_academic_calendars_name_trimmed" CHECK ("name" = btrim("name") AND length("name") >= 3),
        CONSTRAINT "CHK_lms_academic_calendars_period" CHECK ("validTo" > "validFrom"),
        CONSTRAINT "CHK_lms_academic_calendars_working_days" CHECK (
          cardinality("workingDays") BETWEEN 1 AND 7
          AND "workingDays" <@ ARRAY['MON','TUE','WED','THU','FRI','SAT','SUN']::varchar[]
        )
      )`);
    await q.query(
      `CREATE UNIQUE INDEX "UQ_lms_academic_calendars_name_active" ON "lms_academic_calendars" ("entityId", lower("name")) WHERE "isDelete" = false`,
    );
    await q.query(`CREATE INDEX "IDX_lms_academic_calendars_entityId" ON "lms_academic_calendars" ("entityId")`);
    await q.query(`CREATE INDEX "IDX_lms_academic_calendars_centreId" ON "lms_academic_calendars" ("centreId")`);
    await q.query(`CREATE INDEX "IDX_lms_academic_calendars_isActive" ON "lms_academic_calendars" ("isActive")`);
    /* DB-304: indexed by entity and date. */
    await q.query(`CREATE INDEX "IDX_lms_academic_calendars_period" ON "lms_academic_calendars" ("validFrom", "validTo")`);

    await q.query(`
      CREATE TABLE "lms_calendar_holidays" (${base},
        "calendarId" uuid        NOT NULL,
        "date"       date        NOT NULL,
        "name"       varchar(80) NOT NULL,
        CONSTRAINT "PK_lms_calendar_holidays" PRIMARY KEY ("id"),
        CONSTRAINT "FK_lms_calendar_holidays_calendar" FOREIGN KEY ("calendarId") REFERENCES "lms_academic_calendars"("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_lms_calendar_holidays_name_trimmed" CHECK ("name" = btrim("name") AND length("name") >= 2)
      )`);
    await q.query(
      `CREATE UNIQUE INDEX "UQ_lms_calendar_holidays_date_active" ON "lms_calendar_holidays" ("calendarId", "date") WHERE "isDelete" = false`,
    );
    await q.query(`CREATE INDEX "IDX_lms_calendar_holidays_calendarId" ON "lms_calendar_holidays" ("calendarId")`);
    await q.query(`CREATE INDEX "IDX_lms_calendar_holidays_date" ON "lms_calendar_holidays" ("date")`);

    await q.query(`
      CREATE TABLE "lms_learning_config" (${base},
        "entityId" uuid         NOT NULL,
        "key"      varchar(60)  NOT NULL,
        "mode"     varchar(10)  NULL,
        "value"    jsonb        NULL,
        "reason"   varchar(500) NOT NULL,
        CONSTRAINT "PK_lms_learning_config" PRIMARY KEY ("id"),
        CONSTRAINT "FK_lms_learning_config_entity" FOREIGN KEY ("entityId") REFERENCES "lms_entities"("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_lms_learning_config_key" CHECK ("key" ~ '^[a-z0-9_.]{2,60}$'),
        CONSTRAINT "CHK_lms_learning_config_mode" CHECK ("mode" IS NULL OR "mode" IN ('OFFLINE', 'ONLINE')),
        CONSTRAINT "CHK_lms_learning_config_reason" CHECK ("reason" = btrim("reason") AND length("reason") >= 1)
      )`);
    await q.query(
      `CREATE UNIQUE INDEX "UQ_lms_learning_config_key_active" ON "lms_learning_config" ("entityId", "key", COALESCE("mode", '')) WHERE "isDelete" = false`,
    );
    await q.query(`CREATE INDEX "IDX_lms_learning_config_entityId" ON "lms_learning_config" ("entityId")`);

    for (const t of ['lms_academic_calendars', 'lms_calendar_holidays', 'lms_learning_config']) {
      await q.query(`CREATE TRIGGER "TRG_${t}_updated_at" BEFORE UPDATE ON "${t}" FOR EACH ROW EXECUTE FUNCTION "set_updated_at"()`);
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "lms_learning_config"`);
    await q.query(`DROP TABLE IF EXISTS "lms_calendar_holidays"`);
    await q.query(`DROP TABLE IF EXISTS "lms_academic_calendars"`);
  }
}
