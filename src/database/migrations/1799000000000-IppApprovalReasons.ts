import type { MigrationInterface, QueryRunner } from 'typeorm';

/*
 * An approval of an IPP form may have a reason now, as every rejection has one (docs/ipp-approvals.md). The API asks for it
 * on a second approval (the level decided the form before); a first approval may have none:
 *
 * - ipp_approval_events: an approval may have a reason of 3–500 characters. RECEIVED and RESUBMITTED (the form came from
 *   IPP) may carry the Auditor's approval reason.
 * - ipp_decisions (the outbox to IPP): an APPROVE may carry the reason.
 * - ipp_applications.auditorApprovalReason: why the Auditor approved the form, as IPP sends it (null before).
 */
const REASON = `"reason" IS NOT NULL AND length(btrim("reason")) BETWEEN 3 AND 500`;
const MAYBE_REASON = `"reason" IS NULL OR length(btrim("reason")) BETWEEN 3 AND 500`;

export class IppApprovalReasons1799000000000 implements MigrationInterface {
  name = 'IppApprovalReasons1799000000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "ipp_approval_events" DROP CONSTRAINT "CHK_ipp_approval_events_reason"`);
    await q.query(`
      ALTER TABLE "ipp_approval_events" ADD CONSTRAINT "CHK_ipp_approval_events_reason" CHECK (
        CASE
          WHEN "event" = 'REJECTED' THEN ${REASON}
          WHEN "event" IN ('APPROVED', 'RECEIVED', 'RESUBMITTED') THEN ${MAYBE_REASON}
          ELSE "reason" IS NULL
        END
      )`);

    await q.query(`ALTER TABLE "ipp_decisions" DROP CONSTRAINT "CHK_ipp_decisions_reason"`);
    await q.query(`
      ALTER TABLE "ipp_decisions" ADD CONSTRAINT "CHK_ipp_decisions_reason" CHECK (
        CASE
          WHEN "action" = 'REJECT' THEN ${REASON}
          WHEN "action" = 'APPROVE' THEN ${MAYBE_REASON}
          ELSE "reason" IS NULL
        END
      )`);

    await q.query(`ALTER TABLE "ipp_applications" ADD COLUMN "auditorApprovalReason" varchar(500) NULL`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "ipp_applications" DROP COLUMN "auditorApprovalReason"`);
    /* The reasons written meanwhile stay: the old rule is put back NOT VALID (the history cannot be changed). */
    await q.query(`ALTER TABLE "ipp_decisions" DROP CONSTRAINT "CHK_ipp_decisions_reason"`);
    await q.query(
      `ALTER TABLE "ipp_decisions" ADD CONSTRAINT "CHK_ipp_decisions_reason" CHECK (CASE WHEN "action" = 'REJECT' THEN ${REASON} ELSE "reason" IS NULL END) NOT VALID`,
    );
    await q.query(`ALTER TABLE "ipp_approval_events" DROP CONSTRAINT "CHK_ipp_approval_events_reason"`);
    await q.query(
      `ALTER TABLE "ipp_approval_events" ADD CONSTRAINT "CHK_ipp_approval_events_reason" CHECK (CASE WHEN "event" = 'REJECTED' THEN ${REASON} ELSE "reason" IS NULL END) NOT VALID`,
    );
  }
}
