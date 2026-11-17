import type { MigrationInterface, QueryRunner } from 'typeorm';

/*
 * Home Page Management → "Skill Development Diploma": the name of each row of the fact table beside the home
 * page band can be edited from the CMS, in Marathi and English, and reset to the website's default name.
 *
 * programme_highlight gains "rowLabels", an object holding ONLY the customised rows:
 * { "<rowKey>": { "mr": "...", "en": "..." } }. The CHECK keeps it an object; the keys and the text are
 * validated by the API (and the reads ignore anything that is not a known key with both halves filled in).
 *
 * Defaults to empty, so every row keeps its current name exactly as today. A column only; no row is
 * rewritten, so no "updatedAt" changes.
 */
export class HighlightRowLabels1797200000000 implements MigrationInterface {
  name = 'HighlightRowLabels1797200000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE "programme_highlight"
        ADD COLUMN "rowLabels" jsonb NOT NULL DEFAULT '{}'::jsonb,
        ADD CONSTRAINT "CHK_programme_highlight_row_labels" CHECK (jsonb_typeof("rowLabels") = 'object')`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE "programme_highlight"
        DROP CONSTRAINT IF EXISTS "CHK_programme_highlight_row_labels",
        DROP COLUMN "rowLabels"`);
  }
}
