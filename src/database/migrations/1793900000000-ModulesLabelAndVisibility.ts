import type { MigrationInterface, QueryRunner } from 'typeorm';

/*
 * Two changes to the Modules page, together because they ship together:
 *
 * 1. Each module gains `showElectiveLabel` — the "Show 'Elective' label on website" tick box. It
 *    decides only whether the site prints the "Elective" badge on an elective's card; the module is
 *    still an elective everywhere else (its domain table, the counts, its text). It defaults to
 *    true, so every existing card renders exactly as before until someone unticks it.
 *
 * 2. The Modules page loses its publish switch: the website always shows the saved content. The
 *    isPublished column is kept (it is part of the table's history and other pages keep theirs),
 *    but nothing reads or writes it for this page any more. It is set to true here so the stored
 *    value agrees with what the site now does, and content that was saved unpublished goes live.
 *
 * down() drops the column. The isPublished change is not reversed: which rows were unpublished
 * before is not recorded, and true is the column's default.
 */
export class ModulesLabelAndVisibility1793900000000 implements MigrationInterface {
  name = 'ModulesLabelAndVisibility1793900000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "programme_modules" ADD COLUMN "showElectiveLabel" boolean NOT NULL DEFAULT true`);
    await q.query(`UPDATE "programme_module_settings" SET "isPublished" = true WHERE "isPublished" = false`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "programme_modules" DROP COLUMN "showElectiveLabel"`);
  }
}
