import type { MigrationInterface, QueryRunner } from 'typeorm';

/*
 * Approval of the student forms of IPP (src/modules/ipp-approvals, docs/ipp-approvals.md; the calls between the two
 * servers: ipp_backend/docs/SARTHI_LINK.md).
 *
 * - ipp_batches / ipp_applications: what IPP sent (always the newest snapshot: lastSeq) and, per application, the stage
 *   of its approval, the event that brought it there and the highest level it ever reached.
 * - ipp_approval_events: the history, append-only (trigger).
 * - ipp_decisions: the outbox to IPP. Written in the transaction of the decision, sent by the worker.
 * - ipp_messages: ids of IPP's messages already done.
 * - user_districts: the districts of a Divisional Officer.
 *
 * The CHECKs repeat the moves of the contract, so no code path can store another one. The Head Office switch is a
 * panel_settings row (`ipp.head_office_approval`); none is inserted: a missing row means on. New tables only.
 */
const STAGES = `'AUDITOR', 'DIVISION', 'COEP', 'HEAD_OFFICE', 'SUPER_ADMIN', 'APPROVED'`;

/* The moves of the contract (section 3), for the columns of an event or a decision. */
const APPROVE_MOVES = `("fromStage", "toStage") IN (('DIVISION', 'COEP'), ('COEP', 'HEAD_OFFICE'), ('COEP', 'SUPER_ADMIN'), ('HEAD_OFFICE', 'APPROVED'), ('SUPER_ADMIN', 'APPROVED'))`;
const REJECT_MOVES = `("fromStage", "toStage") IN (('DIVISION', 'AUDITOR'), ('COEP', 'DIVISION'), ('HEAD_OFFICE', 'COEP'), ('SUPER_ADMIN', 'COEP'))`;
const SWITCH_MOVES = `("fromStage", "toStage") IN (('HEAD_OFFICE', 'SUPER_ADMIN'), ('SUPER_ADMIN', 'HEAD_OFFICE'))`;
const REASON = `"reason" IS NOT NULL AND length(btrim("reason")) BETWEEN 3 AND 500`;

export class IppApprovals1798900000000 implements MigrationInterface {
  name = 'IppApprovals1798900000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE "ipp_batches" (
        "id"             uuid         NOT NULL DEFAULT gen_random_uuid(),
        "createdAt"      timestamptz  NOT NULL DEFAULT now(),
        "updatedAt"      timestamptz  NOT NULL DEFAULT now(),
        "ippId"          varchar(64)  NOT NULL,
        "code"           varchar(40)  NOT NULL,
        "name"           varchar(200) NOT NULL,
        "size"           integer      NOT NULL,
        "districtId"     uuid         NOT NULL,
        "centreCode"     varchar(60)  NOT NULL,
        "centreName"     varchar(200) NOT NULL,
        "startDate"      date         NULL,
        "endDate"        date         NULL,
        "deliveryMode"   varchar(10)  NOT NULL,
        "technologyCode" varchar(60)  NULL,
        "technologyName" varchar(200) NULL,
        "sentBy"         varchar(200) NULL,
        "ippCreatedAt"   timestamptz  NOT NULL,
        "receivedAt"     timestamptz  NOT NULL DEFAULT now(),
        "lastSeq"        bigint       NOT NULL,
        CONSTRAINT "PK_ipp_batches" PRIMARY KEY ("id"),
        CONSTRAINT "FK_ipp_batches_district" FOREIGN KEY ("districtId") REFERENCES "districts"("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_ipp_batches_size" CHECK ("size" >= 0),
        CONSTRAINT "CHK_ipp_batches_deliveryMode" CHECK ("deliveryMode" IN ('OFFLINE', 'ONLINE', 'BLENDED')),
        CONSTRAINT "CHK_ipp_batches_lastSeq" CHECK ("lastSeq" > 0)
      )`);
    await q.query(`CREATE UNIQUE INDEX "UQ_ipp_batches_ippId" ON "ipp_batches" ("ippId")`);
    await q.query(`CREATE INDEX "IDX_ipp_batches_districtId" ON "ipp_batches" ("districtId")`);
    await q.query(`CREATE INDEX "IDX_ipp_batches_receivedAt" ON "ipp_batches" ("receivedAt")`);

    await q.query(`
      CREATE TABLE "ipp_applications" (
        "id"                 uuid         NOT NULL,
        "createdAt"          timestamptz  NOT NULL DEFAULT now(),
        "updatedAt"          timestamptz  NOT NULL DEFAULT now(),
        "batchId"            uuid         NOT NULL,
        "registrationId"     varchar(40)  NOT NULL,
        "registrationNumber" varchar(60)  NULL,
        "name"               varchar(200) NOT NULL,
        "email"              varchar(254) NOT NULL,
        "mobile"             varchar(30)  NOT NULL,
        "aadhaarMasked"      varchar(14)  NULL,
        "formDistrict"       varchar(200) NULL,
        "category"           varchar(200) NULL,
        "centre"             varchar(200) NULL,
        "technology"         varchar(200) NULL,
        "submittedAt"        timestamptz  NOT NULL,
        "auditorApprovedAt"  timestamptz  NULL,
        "auditorApprovedBy"  varchar(200) NULL,
        "fields"             jsonb        NOT NULL,
        "documents"          jsonb        NOT NULL,
        "edits"              jsonb        NOT NULL,
        "stage"              varchar(12)  NOT NULL,
        "stageEvent"         varchar(12)  NOT NULL,
        "stageUpdatedAt"     timestamptz  NOT NULL,
        "reached"            smallint     NOT NULL,
        "lastSeq"            bigint       NOT NULL,
        CONSTRAINT "PK_ipp_applications" PRIMARY KEY ("id"),
        CONSTRAINT "FK_ipp_applications_batch" FOREIGN KEY ("batchId") REFERENCES "ipp_batches"("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_ipp_applications_stage" CHECK ("stage" IN (${STAGES})),
        CONSTRAINT "CHK_ipp_applications_aadhaarMasked" CHECK ("aadhaarMasked" IS NULL OR "aadhaarMasked" ~ '^XXXX-XXXX-[0-9]{4}$'),
        CONSTRAINT "CHK_ipp_applications_json"
          CHECK (jsonb_typeof("fields") = 'array' AND jsonb_typeof("documents") = 'array' AND jsonb_typeof("edits") = 'array'),
        CONSTRAINT "CHK_ipp_applications_stageEvent" CHECK (
          ("stageEvent" IN ('RECEIVED', 'RESUBMITTED') AND "stage" = 'DIVISION')
          OR ("stageEvent" = 'APPROVED' AND "stage" IN ('COEP', 'HEAD_OFFICE', 'SUPER_ADMIN', 'APPROVED'))
          OR ("stageEvent" = 'REJECTED' AND "stage" IN ('AUDITOR', 'DIVISION', 'COEP'))
          OR ("stageEvent" = 'MOVED' AND "stage" IN ('HEAD_OFFICE', 'SUPER_ADMIN'))
        ),
        CONSTRAINT "CHK_ipp_applications_reached" CHECK (
          "reached" BETWEEN 1 AND 4
          AND "reached" >= CASE "stage" WHEN 'AUDITOR' THEN 1 WHEN 'DIVISION' THEN 1 WHEN 'COEP' THEN 2 WHEN 'APPROVED' THEN 4 ELSE 3 END
          AND ("reached" = 4) = ("stage" = 'APPROVED')
        ),
        CONSTRAINT "CHK_ipp_applications_lastSeq" CHECK ("lastSeq" > 0)
      )`);
    await q.query(`CREATE INDEX "IDX_ipp_applications_batchId" ON "ipp_applications" ("batchId")`);
    await q.query(`CREATE INDEX "IDX_ipp_applications_stage" ON "ipp_applications" ("stage", "stageUpdatedAt")`);

    await q.query(`
      CREATE TABLE "ipp_approval_events" (
        "id"            uuid         NOT NULL DEFAULT gen_random_uuid(),
        "seq"           bigserial    NOT NULL,
        "applicationId" uuid         NOT NULL,
        "event"         varchar(12)  NOT NULL,
        "fromStage"     varchar(12)  NULL,
        "toStage"       varchar(12)  NOT NULL,
        "reason"        varchar(500) NULL,
        "byUserId"      uuid         NULL,
        "byName"        varchar(200) NOT NULL,
        "byRole"        varchar(60)  NULL,
        "messageId"     uuid         NULL,
        "at"            timestamptz  NOT NULL DEFAULT now(),
        CONSTRAINT "PK_ipp_approval_events" PRIMARY KEY ("id"),
        CONSTRAINT "FK_ipp_approval_events_application" FOREIGN KEY ("applicationId") REFERENCES "ipp_applications"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_ipp_approval_events_user" FOREIGN KEY ("byUserId") REFERENCES "users"("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_ipp_approval_events_stages" CHECK ("toStage" IN (${STAGES}) AND ("fromStage" IS NULL OR "fromStage" IN (${STAGES}))),
        CONSTRAINT "CHK_ipp_approval_events_move" CHECK (
          CASE "event"
            WHEN 'RECEIVED' THEN "fromStage" IS NULL AND "toStage" = 'DIVISION'
            WHEN 'RESUBMITTED' THEN "fromStage" IS NOT NULL AND "fromStage" = 'AUDITOR' AND "toStage" = 'DIVISION'
            WHEN 'CORRECTED' THEN "fromStage" IS NOT NULL AND "fromStage" = "toStage"
            WHEN 'APPROVED' THEN "fromStage" IS NOT NULL AND ${APPROVE_MOVES}
            WHEN 'REJECTED' THEN "fromStage" IS NOT NULL AND ${REJECT_MOVES}
            WHEN 'MOVED' THEN "fromStage" IS NOT NULL AND ${SWITCH_MOVES}
            ELSE false
          END
        ),
        CONSTRAINT "CHK_ipp_approval_events_reason" CHECK (CASE WHEN "event" = 'REJECTED' THEN ${REASON} ELSE "reason" IS NULL END),
        CONSTRAINT "CHK_ipp_approval_events_by" CHECK (
          CASE WHEN "event" IN ('APPROVED', 'REJECTED', 'MOVED') THEN "byUserId" IS NOT NULL AND "messageId" IS NULL
               ELSE "byUserId" IS NULL AND "messageId" IS NOT NULL END
        )
      )`);
    await q.query(`CREATE INDEX "IDX_ipp_approval_events_application" ON "ipp_approval_events" ("applicationId", "seq")`);
    await q.query(`CREATE INDEX "IDX_ipp_approval_events_user" ON "ipp_approval_events" ("byUserId") WHERE "byUserId" IS NOT NULL`);
    /* The history is append-only: block UPDATE and DELETE at the database level (as audit_logs). */
    await q.query(`
      CREATE OR REPLACE FUNCTION "ipp_approval_events_immutable"() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'ipp_approval_events is append-only';
      END;
      $$ LANGUAGE plpgsql`);
    await q.query(
      `CREATE TRIGGER "TRG_ipp_approval_events_immutable" BEFORE UPDATE OR DELETE ON "ipp_approval_events" FOR EACH ROW EXECUTE FUNCTION "ipp_approval_events_immutable"()`,
    );

    await q.query(`
      CREATE TABLE "ipp_decisions" (
        "id"            uuid         NOT NULL DEFAULT gen_random_uuid(),
        "createdAt"     timestamptz  NOT NULL DEFAULT now(),
        "updatedAt"     timestamptz  NOT NULL DEFAULT now(),
        "seq"           bigserial    NOT NULL,
        "applicationId" uuid         NOT NULL,
        "action"        varchar(8)   NOT NULL,
        "fromStage"     varchar(12)  NOT NULL,
        "toStage"       varchar(12)  NOT NULL,
        "reason"        varchar(500) NULL,
        "byName"        varchar(200) NOT NULL,
        "byRole"        varchar(60)  NOT NULL,
        "decidedAt"     timestamptz  NOT NULL,
        "status"        varchar(8)   NOT NULL DEFAULT 'PENDING',
        "attempts"      integer      NOT NULL DEFAULT 0,
        "nextAttemptAt" timestamptz  NULL,
        "lastError"     varchar(300) NULL,
        "sentAt"        timestamptz  NULL,
        CONSTRAINT "PK_ipp_decisions" PRIMARY KEY ("id"),
        CONSTRAINT "FK_ipp_decisions_application" FOREIGN KEY ("applicationId") REFERENCES "ipp_applications"("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_ipp_decisions_status" CHECK ("status" IN ('PENDING', 'SENT', 'FAILED')),
        CONSTRAINT "CHK_ipp_decisions_sent" CHECK (("status" = 'SENT') = ("sentAt" IS NOT NULL)),
        CONSTRAINT "CHK_ipp_decisions_attempts" CHECK ("attempts" >= 0),
        CONSTRAINT "CHK_ipp_decisions_move" CHECK (
          CASE "action"
            WHEN 'APPROVE' THEN ${APPROVE_MOVES}
            WHEN 'REJECT' THEN ${REJECT_MOVES}
            WHEN 'MOVE' THEN ${SWITCH_MOVES}
            ELSE false
          END
        ),
        CONSTRAINT "CHK_ipp_decisions_reason" CHECK (CASE WHEN "action" = 'REJECT' THEN ${REASON} ELSE "reason" IS NULL END)
      )`);
    await q.query(`CREATE INDEX "IDX_ipp_decisions_open" ON "ipp_decisions" ("seq") WHERE "status" <> 'SENT'`);
    await q.query(`CREATE INDEX "IDX_ipp_decisions_application" ON "ipp_decisions" ("applicationId", "seq")`);
    await q.query(`CREATE INDEX "IDX_ipp_decisions_sentAt" ON "ipp_decisions" ("sentAt") WHERE "sentAt" IS NOT NULL`);

    await q.query(`
      CREATE TABLE "ipp_messages" (
        "id"             uuid        NOT NULL,
        "seq"            bigint      NOT NULL,
        "batchId"        uuid        NOT NULL,
        "applicationIds" uuid[]      NOT NULL DEFAULT '{}',
        "receivedAt"     timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_ipp_messages" PRIMARY KEY ("id"),
        CONSTRAINT "FK_ipp_messages_batch" FOREIGN KEY ("batchId") REFERENCES "ipp_batches"("id") ON DELETE RESTRICT
      )`);
    await q.query(`CREATE INDEX "IDX_ipp_messages_receivedAt" ON "ipp_messages" ("receivedAt")`);

    await q.query(`
      CREATE TABLE "user_districts" (
        "id"         uuid        NOT NULL DEFAULT gen_random_uuid(),
        "createdAt"  timestamptz NOT NULL DEFAULT now(),
        "updatedAt"  timestamptz NOT NULL DEFAULT now(),
        "isDelete"   boolean     NOT NULL DEFAULT false,
        "isActive"   boolean     NOT NULL DEFAULT true,
        "userId"     uuid        NOT NULL,
        "districtId" uuid        NOT NULL,
        CONSTRAINT "PK_user_districts" PRIMARY KEY ("id"),
        CONSTRAINT "FK_user_districts_user" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_user_districts_district" FOREIGN KEY ("districtId") REFERENCES "districts"("id") ON DELETE RESTRICT
      )`);
    await q.query(`CREATE UNIQUE INDEX "UQ_user_districts_active" ON "user_districts" ("userId", "districtId") WHERE "isDelete" = false`);
    await q.query(`CREATE INDEX "IDX_user_districts_districtId" ON "user_districts" ("districtId")`);

    for (const t of ['ipp_batches', 'ipp_applications', 'ipp_decisions', 'user_districts']) {
      await q.query(`CREATE TRIGGER "TRG_${t}_updated_at" BEFORE UPDATE ON "${t}" FOR EACH ROW EXECUTE FUNCTION "set_updated_at"()`);
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE "user_districts"`);
    await q.query(`DROP TABLE "ipp_messages"`);
    await q.query(`DROP TABLE "ipp_decisions"`);
    await q.query(`DROP TABLE "ipp_approval_events"`);
    await q.query(`DROP FUNCTION "ipp_approval_events_immutable"()`);
    await q.query(`DROP TABLE "ipp_applications"`);
    await q.query(`DROP TABLE "ipp_batches"`);
    await q.query(`DELETE FROM "panel_settings" WHERE "key" = 'ipp.head_office_approval'`);
  }
}
