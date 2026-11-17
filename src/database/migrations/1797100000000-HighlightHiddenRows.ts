import type { MigrationInterface, QueryRunner } from 'typeorm';

/*
 * Home Page Management → "Skill Development Diploma": a show/hide switch for each row of the fact table
 * beside the home page band (Total duration, Ideal completion, Candidature validity, Per module, Schedule,
 * Security deposit, Certification). A hidden row is left out of the table; its value stays where it is managed.
 *
 * programme_highlight gains "hiddenRows", the keys of the hidden rows. The CHECK admits only the seven row
 * keys; the keys are written out here rather than imported, so this migration stays what it was when it ran
 * even if the list in the code changes later.
 *
 * Defaults to empty, so every row stays shown exactly as today. A column only; no row is rewritten, so no
 * "updatedAt" changes.
 */
const KEYS = [
  'totalDuration',
  'idealCompletion',
  'candidatureValidity',
  'perModule',
  'schedule',
  'securityDeposit',
  'certification',
];

export class HighlightHiddenRows1797100000000 implements MigrationInterface {
  name = 'HighlightHiddenRows1797100000000';

  public async up(q: QueryRunner): Promise<void> {
    const keyList = KEYS.map((k) => `'${k}'`).join(', ');
    await q.query(`
      ALTER TABLE "programme_highlight"
        ADD COLUMN "hiddenRows" text[] NOT NULL DEFAULT '{}',
        ADD CONSTRAINT "CHK_programme_highlight_hidden_rows" CHECK ("hiddenRows" <@ ARRAY[${keyList}]::text[])`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE "programme_highlight"
        DROP CONSTRAINT IF EXISTS "CHK_programme_highlight_hidden_rows",
        DROP COLUMN "hiddenRows"`);
  }
}
