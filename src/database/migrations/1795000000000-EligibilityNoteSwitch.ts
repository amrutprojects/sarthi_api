import type { MigrationInterface, QueryRunner } from 'typeorm';

/*
 * Eligibility page: let the "Note" box under the lists be switched off, and switch it off.
 *
 * The seeded note told visitors the criteria were demo parameters ("... held as configurable system
 * parameters in this demo ..."). It is no longer shown on the website. The note's text stays in the
 * database, so an administrator can still turn it back on, or rewrite it, in CMS -> Eligibility Page
 * Management.
 *
 * Only exactly the seeded text is switched off: a note an administrator wrote is never matched, so
 * nothing they typed is hidden.
 */
export class EligibilityNoteSwitch1795000000000 implements MigrationInterface {
  name = 'EligibilityNoteSwitch1795000000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "eligibility_page_settings" ADD COLUMN "showNote" boolean NOT NULL DEFAULT true`);
    await q.query(`
      UPDATE "eligibility_page_settings" SET "showNote" = false, "updatedAt" = now()
      WHERE "noteBodyEn" LIKE 'These criteria follow the published scheme structure%'`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "eligibility_page_settings" DROP COLUMN "showNote"`);
  }
}
