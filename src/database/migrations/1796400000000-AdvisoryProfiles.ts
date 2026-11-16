import type { MigrationInterface, QueryRunner } from 'typeorm';

/*
 * Advisory Committee: full member profiles (the website's "View Profile" dialog).
 *
 * A member card now shows a name and one "Position" line ("Vice Chancellor, COEP Technological
 * University, Pune"), and the profile behind it has an Experience paragraph and five bullet lists:
 * Administrative Roles, Key Achievements, Major Contributions, Research Leadership and Education.
 * The separate organisation and expertise fields go.
 *
 * - "designationMr/En" widen to 300 characters: the position line carries the institution too.
 * - "experienceMr/En" are varchar(1000), one paragraph each.
 * - Each list is one text column per language holding its items one per line ('' when empty). The
 *   API splits them back into arrays; an item never contains a line break (the validator splits on them).
 * - Profile text may be filled in one language only (long biographies often exist in one language);
 *   the website falls back to the other. So, unlike the designation pair, the profile columns have
 *   no both-or-neither CHECK.
 *
 * Existing data is kept, folded into the new fields:
 * - organisation goes into the position line: "<designation>, <organisation>", or just the
 *   organisation when there was no designation. Done only when the result fits 300 characters in
 *   BOTH languages, so the pair stays both-or-neither (the old CHECKs guarantee that both pairs were);
 * - expertise becomes the experience paragraph;
 * - an organisation that could not be folded (too long) is appended to the experience paragraph
 *   instead ("<expertise>; <organisation>"), so nothing is lost.
 *
 * Uniqueness moves from (name, organisation) to (name, position), English, case-insensitive, live
 * rows only. Folding cannot normally create a clash (two live rows already differed in organisation),
 * but contrived pairs can — "Trainer" + no organisation beside no designation + "Trainer" — so any
 * live row that would collide with an earlier one (display order) gets the first suffix " (2)",
 * " (3)" … that leaves its position free among ALL live rows (another row may already read
 * "Trainer (2)"), appended to both halves of its position, rather than letting the index creation fail.
 *
 * Folded rows get a new "updatedAt" (the row trigger), so an admin screen opened before the upgrade
 * is asked to reload instead of saving the old fields over the new ones.
 */
const LISTS = ['administrativeRoles', 'keyAchievements', 'majorContributions', 'researchLeadership', 'education'];
const LANGS = ['Mr', 'En'] as const;

/* The position line with the organisation folded in, for one language. */
const folded = (l: (typeof LANGS)[number]) =>
  `CASE WHEN btrim("designation${l}") = '' THEN btrim("organisation${l}")
        ELSE btrim("designation${l}") || ', ' || btrim("organisation${l}") END`;
const foldable = `btrim("organisationMr") <> '' AND btrim("organisationEn") <> ''
  AND char_length(${folded('Mr')}) <= 300 AND char_length(${folded('En')}) <= 300`;

export class AdvisoryProfiles1796400000000 implements MigrationInterface {
  name = 'AdvisoryProfiles1796400000000';

  public async up(q: QueryRunner): Promise<void> {
    for (const l of LANGS) {
      await q.query(`ALTER TABLE "advisory_members" ALTER COLUMN "designation${l}" TYPE varchar(300)`);
      await q.query(`ALTER TABLE "advisory_members" ADD COLUMN "experience${l}" varchar(1000) NOT NULL DEFAULT ''`);
      for (const list of LISTS) await q.query(`ALTER TABLE "advisory_members" ADD COLUMN "${list}${l}" text NOT NULL DEFAULT ''`);
    }

    /* Expertise → experience; an organisation that does not fit the position line joins it. Then the fold. */
    await q.query(`
      UPDATE "advisory_members" SET "experienceMr" = btrim("expertiseMr"), "experienceEn" = btrim("expertiseEn")
      WHERE btrim("expertiseMr") <> '' OR btrim("expertiseEn") <> ''`);
    await q.query(`
      UPDATE "advisory_members" SET
        "experienceMr" = concat_ws('; ', nullif("experienceMr", ''), nullif(btrim("organisationMr"), '')),
        "experienceEn" = concat_ws('; ', nullif("experienceEn", ''), nullif(btrim("organisationEn"), ''))
      WHERE (btrim("organisationMr") <> '' OR btrim("organisationEn") <> '') AND NOT (${foldable})`);
    await q.query(`
      UPDATE "advisory_members" SET "designationMr" = ${folded('Mr')}, "designationEn" = ${folded('En')}
      WHERE ${foldable}`);

    await q.query(`DROP INDEX "UQ_advisory_members_name_organisation"`);
    /*
     * The clashes, numbered one row at a time in display order, so each choice sees the positions the
     * earlier ones took. A suffix is tried only if the numbered position (cut to stay within 300
     * characters) is not already some other live row's for the same name. Rows are few and clashes
     * rarer, so a query per attempt is fine.
     */
    const clashes: { id: string }[] = await q.query(`
      SELECT "id" FROM (
        SELECT "id", "displayOrder", "createdAt", row_number() OVER (
          PARTITION BY lower("nameEn"), lower("designationEn") ORDER BY "displayOrder", "createdAt", "id") AS n
        FROM "advisory_members" WHERE "isDelete" = false
      ) ranked WHERE n > 1 ORDER BY "displayOrder", "createdAt", "id"`);
    const numbered = (col: string) => `rtrim(left(${col}, 300 - char_length($2::text))) || $2::text`;
    for (const { id } of clashes) {
      for (let k = 2; ; k++) {
        const suffix = ` (${k})`;
        const [{ taken }] = await q.query(
          `SELECT EXISTS (
             SELECT 1 FROM "advisory_members" me JOIN "advisory_members" o
               ON o."isDelete" = false AND o."id" <> me."id" AND lower(o."nameEn") = lower(me."nameEn")
             WHERE me."id" = $1 AND lower(o."designationEn") = lower(${numbered('me."designationEn"')})) AS taken`,
          [id, suffix],
        );
        if (taken) continue;
        await q.query(
          `UPDATE "advisory_members" SET "designationMr" = ${numbered('"designationMr"')}, "designationEn" = ${numbered('"designationEn"')}
           WHERE "id" = $1`,
          [id, suffix],
        );
        break;
      }
    }
    /* The same person cannot be listed twice in the same position; a blank position counts as a value. */
    await q.query(
      `CREATE UNIQUE INDEX "UQ_advisory_members_name_designation" ON "advisory_members" (lower("nameEn"), lower("designationEn"))
         WHERE "isDelete" = false`,
    );

    /* Re-checked over the folded rows: the position is still blank in both languages or filled in both. */
    await q.query(`ALTER TABLE "advisory_members" DROP CONSTRAINT "CHK_advisory_members_designation_pair"`);
    await q.query(
      `ALTER TABLE "advisory_members" ADD CONSTRAINT "CHK_advisory_members_designation_pair"
         CHECK ((btrim("designationMr") = '') = (btrim("designationEn") = ''))`,
    );
    await q.query(`ALTER TABLE "advisory_members" DROP CONSTRAINT "CHK_advisory_members_organisation_pair"`);
    await q.query(`ALTER TABLE "advisory_members" DROP CONSTRAINT "CHK_advisory_members_expertise_pair"`);
    for (const col of ['organisationMr', 'organisationEn', 'expertiseMr', 'expertiseEn']) {
      await q.query(`ALTER TABLE "advisory_members" DROP COLUMN "${col}"`);
    }
  }

  /*
   * Back to the previous schema. The lists are dropped; the experience comes back as the expertise
   * (cut to 200 characters) where it is filled in both languages; positions are cut to 150. The
   * organisation cannot be split back out of the position, so it comes back blank — except that
   * blank organisations would make two live rows of the same name clash in the old unique index, so
   * every such row after the first (a blank-position row first) takes its position as its organisation,
   * numbered by its rank — "<position cut to fit 200> (n)" — because two positions that differ only
   * after the 200th character would otherwise come back as the same organisation. The rank is unique
   * per name, so the restored organisations are too, by construction.
   */
  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS "UQ_advisory_members_name_designation"`);
    for (const col of ['organisationMr', 'organisationEn', 'expertiseMr', 'expertiseEn']) {
      await q.query(`ALTER TABLE "advisory_members" ADD COLUMN "${col}" varchar(200) NOT NULL DEFAULT ''`);
    }

    await q.query(`
      UPDATE "advisory_members" SET "expertiseMr" = rtrim(left("experienceMr", 200)), "expertiseEn" = rtrim(left("experienceEn", 200))
      WHERE btrim("experienceMr") <> '' AND btrim("experienceEn") <> ''`);
    await q.query(`
      WITH ranked AS (
        SELECT "id", row_number() OVER (
          PARTITION BY lower("nameEn") ORDER BY (btrim("designationEn") = '') DESC, "displayOrder", "createdAt", "id") AS n
        FROM "advisory_members" WHERE "isDelete" = false
      )
      UPDATE "advisory_members" a SET
        "organisationMr" = rtrim(left(a."designationMr", 200 - char_length(' (' || r.n || ')'))) || ' (' || r.n || ')',
        "organisationEn" = rtrim(left(a."designationEn", 200 - char_length(' (' || r.n || ')'))) || ' (' || r.n || ')'
      FROM ranked r WHERE r."id" = a."id" AND r.n > 1`);
    await q.query(`
      UPDATE "advisory_members" SET "designationMr" = rtrim(left("designationMr", 150)), "designationEn" = rtrim(left("designationEn", 150))
      WHERE char_length("designationMr") > 150 OR char_length("designationEn") > 150`);

    for (const l of LANGS) {
      for (const list of LISTS) await q.query(`ALTER TABLE "advisory_members" DROP COLUMN "${list}${l}"`);
      await q.query(`ALTER TABLE "advisory_members" DROP COLUMN "experience${l}"`);
      await q.query(`ALTER TABLE "advisory_members" ALTER COLUMN "designation${l}" TYPE varchar(150)`);
    }

    await q.query(
      `ALTER TABLE "advisory_members" ADD CONSTRAINT "CHK_advisory_members_organisation_pair"
         CHECK ((btrim("organisationMr") = '') = (btrim("organisationEn") = ''))`,
    );
    await q.query(
      `ALTER TABLE "advisory_members" ADD CONSTRAINT "CHK_advisory_members_expertise_pair"
         CHECK ((btrim("expertiseMr") = '') = (btrim("expertiseEn") = ''))`,
    );
    await q.query(
      `CREATE UNIQUE INDEX "UQ_advisory_members_name_organisation" ON "advisory_members" (lower("nameEn"), lower("organisationEn"))
         WHERE "isDelete" = false`,
    );
  }
}
