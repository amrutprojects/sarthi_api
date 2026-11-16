import type { MigrationInterface, QueryRunner } from 'typeorm';

/*
 * CMS: the "AMRUT Kalash Advisory Committee" page (अमृत कलश सल्लागार समिती) — the trainers and
 * advisors who guide the programme.
 *
 * Two tables, the same shape as the Board Members section (1794100000000-CmsBoardMembers.ts). The
 * members are a list an administrator adds to, edits, reorders, hides and deletes, one row each. The
 * page's own words — its heading and subtitle — live in a singleton settings row, so they can be
 * edited without touching any member.
 *
 * A member's name is NOT NULL and filled in both languages: unlike the board's public offices, a
 * trainer is only ever added by name. Designation, organisation and expertise are optional text,
 * stored as '' when absent, and a pair is either filled in both languages or blank in both: the site
 * defaults to Marathi and has no per-field language fallback, so a half-filled pair would print an
 * empty line for half the visitors.
 *
 * A photo is a storage key ('cms/advisory-committee/<uuid>.jpg'), never the image itself. The file
 * lives in the configured document storage (STORAGE_DIR or the S3 bucket) and is served through the API.
 *
 * Creates tables only; no existing table or row is touched. The section row is written by the seed
 * (seed-advisory-committee.ts), like the other CMS sections; no members are seeded.
 */
export class CmsAdvisoryCommittee1796200000000 implements MigrationInterface {
  name = 'CmsAdvisoryCommittee1796200000000';

  public async up(q: QueryRunner): Promise<void> {
    const base = `
      "id"        uuid        NOT NULL DEFAULT gen_random_uuid(),
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now(),
      "isDelete"  boolean     NOT NULL DEFAULT false,
      "isActive"  boolean     NOT NULL DEFAULT true`;

    /* Both halves blank, or both filled. */
    const pair = (table: string, name: string, col: string) =>
      `CONSTRAINT "CHK_${table}_${name}_pair" CHECK ((btrim("${col}Mr") = '') = (btrim("${col}En") = ''))`;
    const filled = (table: string, name: string, col: string) =>
      `CONSTRAINT "CHK_${table}_${name}_mr" CHECK (btrim("${col}Mr") <> ''),
       CONSTRAINT "CHK_${table}_${name}_en" CHECK (btrim("${col}En") <> '')`;

    await q.query(`
      CREATE TABLE "advisory_section" (${base},
        "headingMr"  varchar(150) NOT NULL,
        "headingEn"  varchar(150) NOT NULL,
        "subtitleMr" varchar(300) NOT NULL DEFAULT '',
        "subtitleEn" varchar(300) NOT NULL DEFAULT '',
        CONSTRAINT "PK_advisory_section" PRIMARY KEY ("id"),
        ${filled('advisory_section', 'heading', 'heading')},
        ${pair('advisory_section', 'subtitle', 'subtitle')}
      )`);

    /* A singleton, the same way the other CMS sections are: one live configuration, ever. */
    await q.query(`CREATE UNIQUE INDEX "UQ_advisory_section_singleton" ON "advisory_section" ((true)) WHERE "isDelete" = false`);

    await q.query(`
      CREATE TABLE "advisory_members" (${base},
        "nameMr"         varchar(120) NOT NULL,
        "nameEn"         varchar(120) NOT NULL,
        "designationMr"  varchar(150) NOT NULL DEFAULT '',
        "designationEn"  varchar(150) NOT NULL DEFAULT '',
        "organisationMr" varchar(200) NOT NULL DEFAULT '',
        "organisationEn" varchar(200) NOT NULL DEFAULT '',
        "expertiseMr"    varchar(200) NOT NULL DEFAULT '',
        "expertiseEn"    varchar(200) NOT NULL DEFAULT '',
        "photoKey"       varchar(120) NULL,
        "displayOrder"   integer      NOT NULL DEFAULT 0,
        CONSTRAINT "PK_advisory_members" PRIMARY KEY ("id"),
        ${filled('advisory_members', 'name', 'name')},
        ${pair('advisory_members', 'designation', 'designation')},
        ${pair('advisory_members', 'organisation', 'organisation')},
        ${pair('advisory_members', 'expertise', 'expertise')},
        CONSTRAINT "CHK_advisory_members_photo_key"
          CHECK ("photoKey" IS NULL OR "photoKey" ~ '^cms/advisory-committee/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.(jpg|png|webp)$'),
        CONSTRAINT "CHK_advisory_members_order" CHECK ("displayOrder" >= 0)
      )`);

    /* One file belongs to one member, which is what lets the photo route find its owner by key. */
    await q.query(`CREATE UNIQUE INDEX "UQ_advisory_members_photo_key" ON "advisory_members" ("photoKey") WHERE "photoKey" IS NOT NULL`);

    /*
     * The same person cannot be listed twice from the same organisation. A blank organisation counts
     * as a value, so the same name without an organisation can be listed only once too.
     */
    await q.query(
      `CREATE UNIQUE INDEX "UQ_advisory_members_name_organisation" ON "advisory_members" (lower("nameEn"), lower("organisationEn"))
         WHERE "isDelete" = false`,
    );

    for (const t of ['advisory_section', 'advisory_members']) {
      await q.query(`CREATE TRIGGER "TRG_${t}_updated_at" BEFORE UPDATE ON "${t}" FOR EACH ROW EXECUTE FUNCTION "set_updated_at"()`);
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "advisory_members"`);
    await q.query(`DROP TABLE IF EXISTS "advisory_section"`);
  }
}
