import type { MigrationInterface, QueryRunner } from 'typeorm';

/*
 * CMS: the "Leadership & Governing Board" section (मान्यवर व संचालक मंडळ) of the home and About pages.
 *
 * Two tables. The members are a list an administrator adds to, edits, reorders, hides and deletes,
 * one row each. The section's own words — its heading and subtitle and the notice under the cards —
 * are single-valued and live in a singleton settings row, so they can be edited without touching any
 * member.
 *
 * A member's `name` is NULLABLE on purpose. Most offices are listed by their public-record title with
 * the officeholder's name still to be supplied from official AMRUT records; the website prints its
 * "name to be filled" placeholder for those rather than a guessed name. An empty string is never a
 * name, so the CHECK keeps the two states apart.
 *
 * Optional bilingual text (a member's description and subtitle, the section subtitle, the notice) is
 * stored as '' when absent, and a pair is either filled in both languages or blank in both: the site
 * defaults to Marathi and has no per-field language fallback, so a half-filled pair would print an
 * empty line for half the visitors.
 *
 * A photo is a storage key ('cms/board-members/<uuid>.jpg'), never the image itself. The file lives in
 * the configured document storage (STORAGE_DIR or the S3 bucket) and is served through the API.
 *
 * Creates tables only; no existing table or row is touched. The initial content is written by the
 * seed (seed-board-members.ts), like the other CMS sections.
 */
export class CmsBoardMembers1794100000000 implements MigrationInterface {
  name = 'CmsBoardMembers1794100000000';

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
      CREATE TABLE "board_section" (${base},
        "headingMr"     varchar(150)  NOT NULL,
        "headingEn"     varchar(150)  NOT NULL,
        "subtitleMr"    varchar(300)  NOT NULL DEFAULT '',
        "subtitleEn"    varchar(300)  NOT NULL DEFAULT '',
        "noticeTitleMr" varchar(150)  NOT NULL DEFAULT '',
        "noticeTitleEn" varchar(150)  NOT NULL DEFAULT '',
        "noticeBodyMr"  varchar(1000) NOT NULL DEFAULT '',
        "noticeBodyEn"  varchar(1000) NOT NULL DEFAULT '',
        "showNotice"    boolean       NOT NULL DEFAULT true,
        CONSTRAINT "PK_board_section" PRIMARY KEY ("id"),
        ${filled('board_section', 'heading', 'heading')},
        ${pair('board_section', 'subtitle', 'subtitle')},
        ${pair('board_section', 'notice_title', 'noticeTitle')},
        ${pair('board_section', 'notice_body', 'noticeBody')},
        CONSTRAINT "CHK_board_section_notice_shown" CHECK (NOT "showNotice" OR btrim("noticeBodyMr") <> '')
      )`);

    /* A singleton, the same way the other CMS sections are: one live configuration, ever. */
    await q.query(`CREATE UNIQUE INDEX "UQ_board_section_singleton" ON "board_section" ((true)) WHERE "isDelete" = false`);

    await q.query(`
      CREATE TABLE "board_members" (${base},
        "name"          varchar(120) NULL,
        "categoryMr"    varchar(60)  NOT NULL,
        "categoryEn"    varchar(60)  NOT NULL,
        "designationMr" varchar(250) NOT NULL,
        "designationEn" varchar(250) NOT NULL,
        "descriptionMr" varchar(500) NOT NULL DEFAULT '',
        "descriptionEn" varchar(500) NOT NULL DEFAULT '',
        "subtitleMr"    varchar(150) NOT NULL DEFAULT '',
        "subtitleEn"    varchar(150) NOT NULL DEFAULT '',
        "photoKey"      varchar(120) NULL,
        "displayOrder"  integer      NOT NULL DEFAULT 0,
        CONSTRAINT "PK_board_members" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_board_members_name" CHECK ("name" IS NULL OR btrim("name") <> ''),
        ${filled('board_members', 'category', 'category')},
        ${filled('board_members', 'designation', 'designation')},
        ${pair('board_members', 'description', 'description')},
        ${pair('board_members', 'subtitle', 'subtitle')},
        CONSTRAINT "CHK_board_members_photo_key"
          CHECK ("photoKey" IS NULL OR "photoKey" ~ '^cms/board-members/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.(jpg|png|webp)$'),
        CONSTRAINT "CHK_board_members_order" CHECK ("displayOrder" >= 0)
      )`);

    /* One file belongs to one member, which is what lets the photo route find its owner by key. */
    await q.query(`CREATE UNIQUE INDEX "UQ_board_members_photo_key" ON "board_members" ("photoKey") WHERE "photoKey" IS NOT NULL`);

    /*
     * The same person cannot be listed twice for the same office. Placeholder rows (no name yet) are
     * exempt: several offices can be awaiting a name at once.
     */
    await q.query(
      `CREATE UNIQUE INDEX "UQ_board_members_name_designation" ON "board_members" (lower("name"), lower("designationEn"))
         WHERE "isDelete" = false AND "name" IS NOT NULL`,
    );

    for (const t of ['board_section', 'board_members']) {
      await q.query(`CREATE TRIGGER "TRG_${t}_updated_at" BEFORE UPDATE ON "${t}" FOR EACH ROW EXECUTE FUNCTION "set_updated_at"()`);
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "board_members"`);
    await q.query(`DROP TABLE IF EXISTS "board_section"`);
  }
}
