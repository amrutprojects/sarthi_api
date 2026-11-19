import type { MigrationInterface, QueryRunner } from 'typeorm';

/*
 * EDP student application form: the taluka is now typed, not chosen from the Taluka master, and is optional.
 *
 * The form field `taluka_id` (a talukas id) becomes `taluka` (free text, at most 100 characters). The values live in
 * the applications' JSON (`edp_applications.data`), so this moves what has already been filled in:
 *
 *   - every draft and submitted application holding `taluka_id` gets `taluka` with that taluka's name instead. An id
 *     that no longer resolves (deleted master row, or a half-typed draft value) leaves no taluka: the field is
 *     optional, and the applicant can type it.
 *   - `students.talukaName` is filled in from `talukaId` where it is still empty, so an application submitted before
 *     migration 1795600000000 (copied into the student register) still shows its taluka now that the portal reads the
 *     name rather than the reference.
 *
 * No schema change: `students.talukaId` stays as it is (the student import and the admin panel's register still use
 * it), and nothing is dropped.
 */
const UUID = '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';

export class EdpTalukaFreeText1798100000000 implements MigrationInterface {
  name = 'EdpTalukaFreeText1798100000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `UPDATE "edp_applications" a
          SET "data" = ("data" - 'taluka_id') || COALESCE(
                (SELECT jsonb_build_object('taluka', t."name")
                   FROM "talukas" t
                  WHERE t."id" = CASE WHEN a."data"->>'taluka_id' ~ $1 THEN (a."data"->>'taluka_id')::uuid END),
                '{}'::jsonb)
        WHERE a."data" ? 'taluka_id'`,
      [UUID],
    );
    await q.query(
      `UPDATE "students" s
          SET "talukaName" = t."name"
         FROM "talukas" t
        WHERE t."id" = s."talukaId" AND s."talukaName" IS NULL`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    /* Back to `taluka_id`, matching the typed name against the talukas of the application's district; text that names
     * no taluka of that district cannot become an id and is dropped (the field was required before, so such an
     * application would have to have its taluka selected again). The backfilled student names are left as they are:
     * they are indistinguishable from the ones an import supplied. */
    await q.query(
      `UPDATE "edp_applications" a
          SET "data" = ("data" - 'taluka') || COALESCE(
                (SELECT jsonb_build_object('taluka_id', t."id"::text)
                   FROM "talukas" t
                  WHERE t."districtId" = CASE WHEN a."data"->>'district_id' ~ $1 THEN (a."data"->>'district_id')::uuid END
                    AND lower(t."name") = lower(a."data"->>'taluka')
                    AND NOT t."isDelete"
                  ORDER BY t."isActive" DESC
                  LIMIT 1),
                '{}'::jsonb)
        WHERE a."data" ? 'taluka'`,
      [UUID],
    );
  }
}
