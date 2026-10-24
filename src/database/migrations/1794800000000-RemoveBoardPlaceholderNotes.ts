import type { MigrationInterface, QueryRunner } from 'typeorm';

/*
 * Leadership & Governing Board: take the "to be supplied" placeholder text off the website.
 *
 * The seed used to write two kinds of text that told visitors the information was still missing: the
 * notice box under the cards ("Names and photographs to be supplied …") and a "Name to be filled from
 * AMRUT records" line on each card whose name was blank. The seed no longer writes either; this
 * migration removes them from a database that already has them.
 *
 * Only exactly the seeded text is touched: the notice is switched off (its text is kept, so an
 * administrator can still turn it back on) and the cards' placeholder description is blanked. A notice
 * or description an administrator wrote is never matched, so nothing they typed is changed.
 */
export class RemoveBoardPlaceholderNotes1794800000000 implements MigrationInterface {
  name = 'RemoveBoardPlaceholderNotes1794800000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      UPDATE "board_section" SET "showNotice" = false, "updatedAt" = now()
      WHERE "showNotice" = true AND "noticeTitleEn" = 'Names and photographs to be supplied'`);
    await q.query(`
      UPDATE "board_members" SET "descriptionMr" = '', "descriptionEn" = '', "updatedAt" = now()
      WHERE "descriptionEn" = 'Name to be filled from AMRUT records'`);
  }

  /* A removed notice is not brought back: the placeholder text was never content anyone chose. */
  public async down(): Promise<void> {
    /* intentionally empty */
  }
}
