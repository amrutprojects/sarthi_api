import type { MigrationInterface, QueryRunner } from 'typeorm';

/*
 * Where an IPP batch is, as IPP sends it with the batch (docs/ipp-approvals.md): the Auditor starts it once every student of
 * it is final approved, then ends it. ipp_batches keeps the status (NOT_STARTED, ONGOING, ENDED) and when it started and
 * ended; the dashboards count the ongoing ones. Batches received before stay NOT_STARTED until IPP sends them again.
 */
export class IppBatchRuns1799200000000 implements MigrationInterface {
  name = 'IppBatchRuns1799200000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE "ipp_batches"
        ADD COLUMN "status" varchar(12) NOT NULL DEFAULT 'NOT_STARTED',
        ADD COLUMN "startedAt" timestamptz NULL,
        ADD COLUMN "endedAt" timestamptz NULL,
        ADD CONSTRAINT "CHK_ipp_batches_status" CHECK ("status" IN ('NOT_STARTED', 'ONGOING', 'ENDED')),
        ADD CONSTRAINT "CHK_ipp_batches_run" CHECK (
          CASE "status"
            WHEN 'NOT_STARTED' THEN "startedAt" IS NULL AND "endedAt" IS NULL
            WHEN 'ONGOING' THEN "startedAt" IS NOT NULL AND "endedAt" IS NULL
            ELSE "startedAt" IS NOT NULL AND "endedAt" IS NOT NULL
          END
        )`);
    await q.query(`CREATE INDEX "IDX_ipp_batches_status" ON "ipp_batches" ("status")`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX "IDX_ipp_batches_status"`);
    await q.query(`
      ALTER TABLE "ipp_batches"
        DROP CONSTRAINT "CHK_ipp_batches_run",
        DROP CONSTRAINT "CHK_ipp_batches_status",
        DROP COLUMN "endedAt",
        DROP COLUMN "startedAt",
        DROP COLUMN "status"`);
  }
}
