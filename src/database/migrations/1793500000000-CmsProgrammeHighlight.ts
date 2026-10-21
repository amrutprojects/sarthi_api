import type { MigrationInterface, QueryRunner } from 'typeorm';

/*
 * CMS: the home page's programme section — the band headed "AMRUT KALASH — Skill Development
 * Diploma", its tagline, its objectives and the certification line.
 *
 * Two tables, because the objectives are a list an administrator adds to and reorders, and the
 * rest is single-valued.
 *
 * NOT here: the fact sheet beside it (total duration, per module, schedule, deposit). Those come
 * from the Modules content — several are summed from the modules themselves — so storing them
 * again would be a second place for the same numbers to disagree.
 *
 * Bilingual columns. The public site defaults to Marathi and renders all of this through bi().
 *
 * Creates tables only; no existing table or row is touched.
 */
export class CmsProgrammeHighlight1793500000000 implements MigrationInterface {
  name = 'CmsProgrammeHighlight1793500000000';

  public async up(q: QueryRunner): Promise<void> {
    const base = `
      "id"        uuid        NOT NULL DEFAULT gen_random_uuid(),
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now(),
      "isDelete"  boolean     NOT NULL DEFAULT false,
      "isActive"  boolean     NOT NULL DEFAULT true`;

    await q.query(`
      CREATE TABLE "programme_highlight" (${base},
        "headingMr"       varchar(200) NOT NULL,
        "headingEn"       varchar(200) NOT NULL,
        "subheadingMr"    varchar(300) NOT NULL,
        "subheadingEn"    varchar(300) NOT NULL,
        "taglineMr"       varchar(500) NOT NULL,
        "taglineEn"       varchar(500) NOT NULL,
        "certificationMr" varchar(300) NOT NULL,
        "certificationEn" varchar(300) NOT NULL,
        "isPublished"     boolean      NOT NULL DEFAULT true,
        CONSTRAINT "PK_programme_highlight" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_programme_highlight_heading_mr" CHECK (btrim("headingMr") <> ''),
        CONSTRAINT "CHK_programme_highlight_heading_en" CHECK (btrim("headingEn") <> '')
      )`);

    /* A singleton, the same way the other CMS pages are: one live configuration, ever. */
    await q.query(
      `CREATE UNIQUE INDEX "UQ_programme_highlight_singleton" ON "programme_highlight" ((true)) WHERE "isDelete" = false`,
    );

    await q.query(`
      CREATE TABLE "programme_highlight_objectives" (${base},
        "highlightId"  uuid         NOT NULL,
        "textMr"       varchar(400) NOT NULL,
        "textEn"       varchar(400) NOT NULL,
        "displayOrder" integer      NOT NULL DEFAULT 0,
        CONSTRAINT "PK_programme_highlight_objectives" PRIMARY KEY ("id"),
        CONSTRAINT "FK_programme_highlight_objectives_highlight"
          FOREIGN KEY ("highlightId") REFERENCES "programme_highlight"("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_programme_highlight_objectives_mr" CHECK (btrim("textMr") <> ''),
        CONSTRAINT "CHK_programme_highlight_objectives_en" CHECK (btrim("textEn") <> ''),
        CONSTRAINT "CHK_programme_highlight_objectives_order" CHECK ("displayOrder" >= 0)
      )`);

    await q.query(
      `CREATE INDEX "IDX_programme_highlight_objectives_highlightId" ON "programme_highlight_objectives" ("highlightId")`,
    );

    for (const t of ['programme_highlight', 'programme_highlight_objectives']) {
      await q.query(
        `CREATE TRIGGER "TRG_${t}_updated_at" BEFORE UPDATE ON "${t}" FOR EACH ROW EXECUTE FUNCTION "set_updated_at"()`,
      );
    }
  }

  /* Children first: the foreign key is RESTRICT. */
  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "programme_highlight_objectives"`);
    await q.query(`DROP TABLE IF EXISTS "programme_highlight"`);
  }
}
