import type { MigrationInterface, QueryRunner } from 'typeorm';

/*
 * CMS: "Announcements" — the ticker that scrolls continuously across the top of every website page,
 * in the strip that used to carry a fixed demo notice.
 *
 * Two tables. The announcements are a list an administrator adds to, edits, reorders, hides and
 * deletes, one row each, with no fixed number. The ticker's label (the pill on the left of the strip)
 * and whether the strip is shown are single-valued and live in a singleton settings row.
 *
 * An announcement's title is never blank; its detail is optional, blank in both languages or filled
 * in both. Its `link` lands in an href on every page, so the CHECK below admits only a page of this
 * site ('/apply', never '//host') or an absolute http(s) address — never `javascript:` or `data:` —
 * the same rule as the other CMS links. NULL is an announcement without a link (plain text).
 *
 * Creates tables only; no existing table or row is touched. The initial content — the demo notice the
 * website showed — is written by the seed (seed-announcements.ts), like the other CMS sections.
 */
export class CmsAnnouncements1794700000000 implements MigrationInterface {
  name = 'CmsAnnouncements1794700000000';

  public async up(q: QueryRunner): Promise<void> {
    const base = `
      "id"        uuid        NOT NULL DEFAULT gen_random_uuid(),
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now(),
      "isDelete"  boolean     NOT NULL DEFAULT false,
      "isActive"  boolean     NOT NULL DEFAULT true`;

    const pair = (table: string, name: string, col: string) =>
      `CONSTRAINT "CHK_${table}_${name}_pair" CHECK ((btrim("${col}Mr") = '') = (btrim("${col}En") = ''))`;
    const filled = (table: string, name: string, col: string) =>
      `CONSTRAINT "CHK_${table}_${name}_mr" CHECK (btrim("${col}Mr") <> ''),
       CONSTRAINT "CHK_${table}_${name}_en" CHECK (btrim("${col}En") <> '')`;

    await q.query(`
      CREATE TABLE "announcement_settings" (${base},
        "labelMr"     varchar(60) NOT NULL,
        "labelEn"     varchar(60) NOT NULL,
        "showSection" boolean     NOT NULL DEFAULT true,
        CONSTRAINT "PK_announcement_settings" PRIMARY KEY ("id"),
        ${filled('announcement_settings', 'label', 'label')}
      )`);

    /* A singleton, the same way the other CMS sections are: one live configuration, ever. */
    await q.query(`CREATE UNIQUE INDEX "UQ_announcement_settings_singleton" ON "announcement_settings" ((true)) WHERE "isDelete" = false`);

    await q.query(`
      CREATE TABLE "announcements" (${base},
        "titleMr"      varchar(200) NOT NULL,
        "titleEn"      varchar(200) NOT NULL,
        "detailMr"     varchar(500) NOT NULL DEFAULT '',
        "detailEn"     varchar(500) NOT NULL DEFAULT '',
        "link"         varchar(500) NULL,
        "displayOrder" integer      NOT NULL DEFAULT 0,
        CONSTRAINT "PK_announcements" PRIMARY KEY ("id"),
        ${filled('announcements', 'title', 'title')},
        ${pair('announcements', 'detail', 'detail')},
        CONSTRAINT "CHK_announcements_link" CHECK (
          "link" IS NULL
          OR ("link" ~ '^/[A-Za-z0-9._~/?=&%#-]*$' AND "link" !~ '^//')
          OR "link" ~ '^https?://[^[:space:]<>"]+$'
        ),
        CONSTRAINT "CHK_announcements_order" CHECK ("displayOrder" >= 0)
      )`);

    for (const t of ['announcement_settings', 'announcements']) {
      await q.query(`CREATE TRIGGER "TRG_${t}_updated_at" BEFORE UPDATE ON "${t}" FOR EACH ROW EXECUTE FUNCTION "set_updated_at"()`);
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "announcements"`);
    await q.query(`DROP TABLE IF EXISTS "announcement_settings"`);
  }
}
