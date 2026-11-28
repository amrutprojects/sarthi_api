import type { Request } from 'express';
import type { EntityManager } from 'typeorm';
import { AppDataSource } from '../../config/database.config';
import { logger } from '../../observability/logger';
import { AppError } from '../../shared/errors/app-error';
import { IPP_ERROR, IPP_ROLE, STAGE_RANK, type IppEvent, type Stage } from './ipp-approvals.constants';
import { districtIdFor } from './ipp-districts';
import type { IppMessageApplication, IppMessageBatch, IppMessageInput } from './ipp-message.validation';
import { rowsOf } from './ipp-sql';

/*
 * Messages of IPP (contract ipp_backend/docs/SARTHI_LINK.md section 2). A message is done as a whole or not at all, and
 * once: the same id again answers with the stages as they are now. A snapshot is replaced only by a newer one (seq).
 * The log line holds ids and counts, never form values.
 */
export interface MessageAnswer {
  id: string;
  duplicate: boolean;
  applications: { id: string; stage: Stage }[];
}

interface Known {
  id: string;
  batchId: string;
  stage: Stage;
  /* bigint: text. */
  lastSeq: string;
}

const refuse = (code: string, message: string) => AppError.conflict(message, code);

class IppMessageService {
  async receive(req: Request, message: IppMessageInput): Promise<MessageAnswer> {
    const answer = await AppDataSource.transaction(async (m) => {
      /* Two calls with the same id (a retry while the first is still running) go one after the other. */
      await m.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`ipp_messages:${message.id}`]);
      const [done] = (await m.query(`SELECT "applicationIds" FROM "ipp_messages" WHERE "id" = $1`, [message.id])) as {
        applicationIds: string[];
      }[];
      if (done) return { id: message.id, duplicate: true, applications: await this.stages(m, done.applicationIds) };

      const batchId = await this.saveBatch(m, message);
      const ids = message.applications.map((a) => a.id);
      /* In id order, like every other lock on applications. */
      const known = new Map(
        (
          (await m.query(
            `SELECT "id", "batchId", "stage", "lastSeq" FROM "ipp_applications" WHERE "id" = ANY($1::uuid[]) ORDER BY "id" FOR UPDATE`,
            [ids],
          )) as Known[]
        ).map((k) => [k.id, k]),
      );
      for (const application of message.applications) await this.apply(m, message, batchId, application, known.get(application.id));
      await m.query(`INSERT INTO "ipp_messages" ("id", "seq", "batchId", "applicationIds") VALUES ($1, $2, $3, $4::uuid[])`, [
        message.id,
        message.seq,
        batchId,
        ids,
      ]);
      return { id: message.id, duplicate: false, applications: await this.stages(m, ids) };
    });
    logger.info(
      {
        requestId: req.id,
        messageId: message.id,
        seq: message.seq,
        applications: message.applications.length,
        duplicate: answer.duplicate,
      },
      'ipp link: message received',
    );
    return answer;
  }

  /* In the order asked for. */
  private async stages(m: EntityManager, ids: string[]): Promise<{ id: string; stage: Stage }[]> {
    const rows: { id: string; stage: Stage }[] = await m.query(
      `SELECT "id", "stage" FROM "ipp_applications" WHERE "id" = ANY($1::uuid[])`,
      [ids],
    );
    const stage = new Map(rows.map((r) => [r.id, r.stage]));
    return ids.filter((id) => stage.has(id)).map((id) => ({ id, stage: stage.get(id)! }));
  }

  /* Inserts or updates the batch and locks it: messages of one batch go one after the other. */
  private async saveBatch(m: EntityManager, { seq, batch }: { seq: number; batch: IppMessageBatch }): Promise<string> {
    const districtId = await districtIdFor(m, batch.district);
    await m.query(
      `INSERT INTO "ipp_batches" AS b ("ippId", "code", "name", "size", "districtId", "centreCode", "centreName", "startDate", "endDate",
         "deliveryMode", "technologyCode", "technologyName", "sentBy", "ippCreatedAt", "lastSeq", "status", "startedAt", "endedAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::date, $9::date, $10, $11, $12, $13, $14, $15, $16, $17::timestamptz, $18::timestamptz)
       ON CONFLICT ("ippId") DO UPDATE SET
         "code" = EXCLUDED."code", "name" = EXCLUDED."name", "size" = EXCLUDED."size", "districtId" = EXCLUDED."districtId",
         "centreCode" = EXCLUDED."centreCode", "centreName" = EXCLUDED."centreName", "startDate" = EXCLUDED."startDate",
         "endDate" = EXCLUDED."endDate", "deliveryMode" = EXCLUDED."deliveryMode", "technologyCode" = EXCLUDED."technologyCode",
         "technologyName" = EXCLUDED."technologyName", "sentBy" = EXCLUDED."sentBy", "ippCreatedAt" = EXCLUDED."ippCreatedAt",
         "lastSeq" = EXCLUDED."lastSeq", "status" = EXCLUDED."status", "startedAt" = EXCLUDED."startedAt", "endedAt" = EXCLUDED."endedAt"
       WHERE EXCLUDED."lastSeq" > b."lastSeq"`,
      [
        batch.id,
        batch.code,
        batch.name,
        batch.size,
        districtId,
        batch.centre.code,
        batch.centre.name,
        batch.start_date,
        batch.end_date,
        batch.delivery_mode,
        batch.technology?.code ?? null,
        batch.technology?.name ?? null,
        batch.created_by,
        batch.created_at,
        seq,
        batch.status,
        batch.started_at,
        batch.ended_at,
      ],
    );
    const [row] = (await m.query(`SELECT "id" FROM "ipp_batches" WHERE "ippId" = $1`, [batch.id])) as { id: string }[];
    return row.id;
  }

  private async apply(
    m: EntityManager,
    message: Pick<IppMessageInput, 'id' | 'seq'>,
    batchId: string,
    a: IppMessageApplication,
    known: Known | undefined,
  ): Promise<void> {
    if (!known) {
      if (a.action === 'UPDATE') throw refuse(IPP_ERROR.APPLICATION_UNKNOWN, `${a.registration_id} was never sent to Sarthi`);
      await this.insert(m, message, batchId, a);
      return;
    }
    if (known.batchId !== batchId) throw refuse(IPP_ERROR.APPLICATION_IN_OTHER_BATCH, `${a.registration_id} is in another batch`);

    /* A snapshot older than the one held (or the same one) changes nothing. */
    const newer = message.seq > Number(known.lastSeq);
    if (a.action === 'RESUBMIT') {
      if (known.stage !== 'AUDITOR')
        throw refuse(IPP_ERROR.STAGE_MISMATCH, `${a.registration_id} is not with the IPP Auditor (${known.stage})`);
      if (newer) await this.replaceSnapshot(m, message.seq, a);
      await m.query(
        `UPDATE "ipp_applications" SET "stage" = 'DIVISION', "stageEvent" = 'RESUBMITTED', "stageUpdatedAt" = clock_timestamp() WHERE "id" = $1`,
        [a.id],
      );
      await this.event(m, message.id, a, 'RESUBMITTED', 'AUDITOR', 'DIVISION');
      return;
    }
    /* SUBMIT of a form already here is an UPDATE. */
    if (!newer) return;
    await this.replaceSnapshot(m, message.seq, a);
    await this.event(m, message.id, a, 'CORRECTED', known.stage, known.stage);
  }

  private async insert(
    m: EntityManager,
    message: Pick<IppMessageInput, 'id' | 'seq'>,
    batchId: string,
    a: IppMessageApplication,
  ): Promise<void> {
    const inserted = rowsOf<{ id: string }>(
      await m.query(
        `INSERT INTO "ipp_applications" ("id", "batchId", "registrationId", "registrationNumber", "name", "email", "mobile", "aadhaarMasked",
           "formDistrict", "category", "centre", "technology", "submittedAt", "auditorApprovedAt", "auditorApprovedBy", "fields", "documents",
           "edits", "lastSeq", "auditorApprovalReason", "stage", "stageEvent", "stageUpdatedAt", "reached")
         VALUES ($1, $20, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb, $16::jsonb, $17::jsonb, $18, $19,
           'DIVISION', 'RECEIVED', clock_timestamp(), ${STAGE_RANK.DIVISION})
         ON CONFLICT ("id") DO NOTHING RETURNING "id"`,
        [...this.snapshot(message.seq, a), batchId],
      ),
    );
    /* Messages of one batch wait for each other, so it can only have come with another batch at this very moment. */
    if (!inserted.length) throw refuse(IPP_ERROR.APPLICATION_IN_OTHER_BATCH, `${a.registration_id} is in another batch`);
    await this.event(m, message.id, a, 'RECEIVED', null, 'DIVISION');
  }

  private async replaceSnapshot(m: EntityManager, seq: number, a: IppMessageApplication): Promise<void> {
    await m.query(
      `UPDATE "ipp_applications" SET "registrationId" = $2, "registrationNumber" = $3, "name" = $4, "email" = $5, "mobile" = $6,
         "aadhaarMasked" = $7, "formDistrict" = $8, "category" = $9, "centre" = $10, "technology" = $11, "submittedAt" = $12,
         "auditorApprovedAt" = $13, "auditorApprovedBy" = $14, "fields" = $15::jsonb, "documents" = $16::jsonb, "edits" = $17::jsonb,
         "lastSeq" = $18, "auditorApprovalReason" = $19
       WHERE "id" = $1`,
      this.snapshot(seq, a),
    );
  }

  /* $1 … $19 of both statements above. */
  private snapshot(seq: number, a: IppMessageApplication): unknown[] {
    return [
      a.id,
      a.registration_id,
      a.registration_number,
      a.name,
      a.email.trim(),
      a.mobile_number.trim(),
      a.aadhaar_masked,
      a.district,
      a.category,
      a.centre,
      a.technology,
      a.submitted_at,
      a.auditor_approved_at,
      a.auditor_approved_by,
      JSON.stringify(a.fields),
      JSON.stringify(a.documents),
      JSON.stringify(a.edits),
      seq,
      a.auditor_approval_reason,
    ];
  }

  /*
   * Who did it in IPP: whoever corrected the form last, or the Auditor who approved it. A form that comes (again) from IPP
   * carries the Auditor's approval reason in the history; a correction has none.
   */
  private async event(
    m: EntityManager,
    messageId: string,
    a: IppMessageApplication,
    event: IppEvent,
    from: Stage | null,
    to: Stage,
  ): Promise<void> {
    const by = (event === 'CORRECTED' ? a.edits[0]?.by : null) ?? a.auditor_approved_by ?? IPP_ROLE;
    const reason = event === 'CORRECTED' ? null : a.auditor_approval_reason;
    await m.query(
      `INSERT INTO "ipp_approval_events" ("applicationId", "event", "fromStage", "toStage", "reason", "byName", "byRole", "messageId", "at")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, clock_timestamp())`,
      [a.id, event, from, to, reason, by, IPP_ROLE, messageId],
    );
  }
}

export const ippMessageService = new IppMessageService();
