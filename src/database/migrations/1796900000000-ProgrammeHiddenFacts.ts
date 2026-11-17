import type { MigrationInterface, QueryRunner } from 'typeorm';

/*
 * Programme Page Management: a show/hide switch for each row of the fact sheet box on the website's
 * Programme page (Total hours, Modules, Electives, Ideal duration, Validity, Security deposit, Apply
 * before, Partner). A hidden row is left out of the box; its value stays where it is managed.
 *
 * programme_page_settings gains "hiddenFacts", the keys of the hidden rows. The CHECK admits only the
 * eight row keys; the keys are written out here rather than imported, so this migration stays what it
 * was when it ran even if the list in the code changes later.
 *
 * Defaults to empty, so every row stays shown exactly as today. A column only; no row is rewritten,
 * so no "updatedAt" changes.
 */
const KEYS = ['totalHours', 'modules', 'electives', 'idealDuration', 'validity', 'securityDeposit', 'applyBefore', 'partner'];

export class ProgrammeHiddenFacts1796900000000 implements MigrationInterface {
  name = 'ProgrammeHiddenFacts1796900000000';

  public async up(q: QueryRunner): Promise<void> {
    const keyList = KEYS.map((k) => `'${k}'`).join(', ');
    await q.query(`
      ALTER TABLE "programme_page_settings"
        ADD COLUMN "hiddenFacts" text[] NOT NULL DEFAULT '{}',
        ADD CONSTRAINT "CHK_programme_page_settings_hidden_facts" CHECK ("hiddenFacts" <@ ARRAY[${keyList}]::text[])`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE "programme_page_settings"
        DROP CONSTRAINT IF EXISTS "CHK_programme_page_settings_hidden_facts",
        DROP COLUMN "hiddenFacts"`);
  }
}
