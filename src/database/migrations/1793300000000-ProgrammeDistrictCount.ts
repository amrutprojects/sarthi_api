import type { MigrationInterface, QueryRunner } from 'typeorm';

/*
 * The district figure on the home page's "Programme at a glance" card.
 *
 * The other three figures on that card are derived rather than stored — total hours is the module
 * total times the number of modules, and the module and domain counts are the lists themselves —
 * so they cannot contradict the Modules page. The district count has no such source: the geography
 * master holds the districts a FORM may choose from, which is a different thing and is not the 36
 * the programme reports.
 *
 * It is therefore stored, seeded with the figure the site already showed.
 *
 * NOTE for whoever edits it: this is the headline number on the home page only. The schematic map
 * and the district office pages are drawn from the programme dataset, which still has 36 tiles.
 * Changing this to something else makes the headline disagree with the map.
 */
export class ProgrammeDistrictCount1793300000000 implements MigrationInterface {
  name = 'ProgrammeDistrictCount1793300000000';

  public async up(q: QueryRunner): Promise<void> {
    /* Added with the current figure as the default so existing rows are correct immediately. */
    await q.query(
      `ALTER TABLE "programme_module_settings" ADD COLUMN "districtCount" integer NOT NULL DEFAULT 36`,
    );
    await q.query(
      `ALTER TABLE "programme_module_settings"
         ADD CONSTRAINT "CHK_programme_module_settings_districts" CHECK ("districtCount" >= 0)`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE "programme_module_settings" DROP CONSTRAINT IF EXISTS "CHK_programme_module_settings_districts"`,
    );
    await q.query(`ALTER TABLE "programme_module_settings" DROP COLUMN "districtCount"`);
  }
}
