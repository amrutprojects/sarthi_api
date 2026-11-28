import type { Request } from 'express';
import type { EntityManager } from 'typeorm';
import { AppDataSource } from '../../config/database.config';
import { AppError } from '../../shared/errors/app-error';
import { buildMeta, type Paginated } from '../../shared/utils/pagination';
import { auditService } from '../audit';
import type { AuthUser } from '../auth';
import { accessOf, limitedToDistricts, type IppAccess } from './ipp-access';
import {
  approveTo,
  IPP_AUDIT,
  IPP_ERROR,
  LEVEL_ROLES,
  rejectTo,
  STAGE_LABELS,
  STAGE_RANK,
  type Level,
  type Stage,
} from './ipp-approvals.constants';
import { ippApprovalsRepository as repository } from './ipp-approvals.repository';
import {
  toApplicationDetailDto,
  toApplicationRowDto,
  toBatchRowDto,
  type ApplicationDetailDto,
  type ApplicationRowDto,
  type BatchRowDto,
  type SummaryDto,
} from './ipp-approvals.mapper';
import type { ListApplicationsQuery, ListBatchesQuery } from './ipp-approvals.validation';
import { ippHeadOfficeService } from './ipp-head-office.service';
import { kickIppLink } from './ipp-outbox.runtime';

/*
 * Reading and deciding the student forms of IPP (docs/ipp-approvals.md). A decision locks the application, checks the
 * officer's rights on the stage it is at now, and stores the new stage, the history and the message to IPP (outbox) in one
 * transaction: nobody decides twice and IPP misses nothing.
 */
export interface DecidedMany {
  approved: number;
  skipped: number;
  applications: { id: string; stage: Stage; stageLabel: string }[];
}

/* A rejection has its reason (3–500 characters); an approval has one when it is a second approval (null when not given). */
type Decision = { event: 'APPROVED'; reason: string | null } | { event: 'REJECTED'; reason: string };

/*
 * A second approval (the level decided the form before) needs a reason: 422 when it is not given, before anything is
 * changed. A first approval does not need one.
 */
function assertReasons(rows: { decidedHere: boolean }[], decision: Decision, many: boolean): void {
  if (decision.event !== 'APPROVED' || decision.reason) return;
  const again = rows.filter((r) => r.decidedHere).length;
  if (!again) return;
  throw AppError.validation([
    {
      field: 'body.reason',
      message: many
        ? `Approval reason is required: ${again} of these applications were rejected before, so this is their second approval.`
        : 'Approval reason is required: the application was rejected before, so this is its second approval.',
    },
  ]);
}

const notFound = (what: string) => AppError.notFound(`${what} not found`);
const notYours = () => AppError.conflict('This form is not yours to decide now', IPP_ERROR.NOT_YOURS_TO_DECIDE);

class IppApprovalsService {
  /* ---- reading ---- */

  private async access(auth: AuthUser): Promise<{ access: IppAccess; headOffice: boolean }> {
    const headOffice = await ippHeadOfficeService.isEnabled();
    return { access: accessOf(auth, headOffice), headOffice };
  }

  async summary(auth: AuthUser): Promise<SummaryDto> {
    const { access, headOffice } = await this.access(auth);
    const { stages, toDecide, sentBack, views } = await repository.counts(access);
    return {
      stages: access.decides,
      districts: limitedToDistricts(access) ? await repository.districtsOf(auth.id) : null,
      headOfficeEnabled: headOffice,
      toDecide,
      sentBack,
      counts: stages,
      views,
    };
  }

  async listApplications(auth: AuthUser, q: ListApplicationsQuery): Promise<Paginated<ApplicationRowDto>> {
    const { access } = await this.access(auth);
    const { items, total } = await repository.listApplications(access, q);
    return { items: items.map(toApplicationRowDto), meta: buildMeta(q, total) };
  }

  async application(auth: AuthUser, id: string): Promise<ApplicationDetailDto> {
    const { access, headOffice } = await this.access(auth);
    const row = await repository.findApplication(access, id);
    if (!row) throw notFound('Application');
    return toApplicationDetailDto(row, await repository.history(id), headOffice);
  }

  async listBatches(auth: AuthUser, q: ListBatchesQuery): Promise<Paginated<BatchRowDto>> {
    const { access } = await this.access(auth);
    const { items, total } = await repository.listBatches(access, q);
    return { items: items.map(toBatchRowDto), meta: buildMeta(q, total) };
  }

  async batch(auth: AuthUser, id: string): Promise<BatchRowDto> {
    const { access } = await this.access(auth);
    const row = await repository.findBatch(access, id);
    if (!row) throw notFound('Batch');
    return toBatchRowDto(row);
  }

  districts() {
    return repository.activeDistricts();
  }

  /* ---- deciding ---- */

  approve(req: Request, id: string, reason: string | null): Promise<ApplicationDetailDto> {
    return this.decideOne(req, id, { event: 'APPROVED', reason });
  }

  reject(req: Request, id: string, reason: string): Promise<ApplicationDetailDto> {
    return this.decideOne(req, id, { event: 'REJECTED', reason });
  }

  private async decideOne(req: Request, id: string, decision: Decision): Promise<ApplicationDetailDto> {
    const auth = req.auth!;
    await AppDataSource.transaction(async (m) => {
      const headOffice = await ippHeadOfficeService.holdAndRead(m);
      const access = accessOf(auth, headOffice);
      const rows = await repository.lockDecidable(m, access, { ids: [id] });
      if (!rows.length) throw (await repository.isVisible(access, id, m)) ? notYours() : notFound('Application');
      assertReasons(rows, decision, false);
      const [done] = await this.store(m, auth, rows, decision, headOffice);
      await auditService.recordInTx(m, req, {
        action: decision.event === 'APPROVED' ? IPP_AUDIT.APPROVE : IPP_AUDIT.REJECT,
        resource: 'ipp_application',
        resourceId: id,
        /* Not the reason: free text, kept in the history only. */
        details: { from: rows[0].stage, to: done.stage },
      });
    });
    kickIppLink();
    return this.application(auth, id);
  }

  /*
   * Approves what is the user's to decide now of the given ids, each with the same reason; the rest (other stage, not
   * visible, unknown) is skipped.
   */
  async approveMany(req: Request, ids: string[], reason: string | null): Promise<DecidedMany> {
    const auth = req.auth!;
    const result = await AppDataSource.transaction(async (m) => {
      const headOffice = await ippHeadOfficeService.holdAndRead(m);
      const rows = await repository.lockDecidable(m, accessOf(auth, headOffice), { ids });
      assertReasons(rows, { event: 'APPROVED', reason }, true);
      const done = await this.store(m, auth, rows, { event: 'APPROVED', reason }, headOffice);
      const skipped = ids.length - done.length;
      if (done.length)
        await auditService.recordInTx(m, req, {
          action: IPP_AUDIT.APPROVE_MANY,
          resource: 'ipp_application',
          resourceId: null,
          details: { approved: done.length, skipped, applicationIds: done.map((d) => d.id) },
        });
      return { approved: done.length, skipped, applications: done };
    });
    if (result.approved) kickIppLink();
    return result;
  }

  /*
   * Approves every application of the batch that is the user's to decide now, each with the same reason; nothing is asked
   * for that could be skipped.
   */
  async approveBatch(req: Request, batchId: string, reason: string | null): Promise<DecidedMany> {
    const auth = req.auth!;
    const result = await AppDataSource.transaction(async (m) => {
      const headOffice = await ippHeadOfficeService.holdAndRead(m);
      const access = accessOf(auth, headOffice);
      if (!(await repository.isBatchVisible(access, batchId, m))) throw notFound('Batch');
      const rows = await repository.lockDecidable(m, access, { batchId });
      assertReasons(rows, { event: 'APPROVED', reason }, true);
      const done = await this.store(m, auth, rows, { event: 'APPROVED', reason }, headOffice);
      if (done.length)
        await auditService.recordInTx(m, req, {
          action: IPP_AUDIT.APPROVE_BATCH,
          resource: 'ipp_batch',
          resourceId: batchId,
          details: { approved: done.length, applicationIds: done.map((d) => d.id) },
        });
      return { approved: done.length, skipped: 0, applications: done };
    });
    if (result.approved) kickIppLink();
    return result;
  }

  /* The new stage, the history and the message to IPP of the locked applications. */
  private async store(
    m: EntityManager,
    auth: AuthUser,
    rows: { id: string; stage: Level; decidedHere?: boolean }[],
    decision: Decision,
    headOffice: boolean,
  ): Promise<DecidedMany['applications']> {
    if (!rows.length) return [];
    const approve = decision.event === 'APPROVED';
    const moves = rows.map((r) => ({ id: r.id, from: r.stage, to: approve ? approveTo(r.stage, headOffice) : rejectTo(r.stage) }));
    const ids = moves.map((x) => x.id);
    const from = moves.map((x) => x.from);
    const to = moves.map((x) => x.to);
    const roles = moves.map((x) => LEVEL_ROLES[x.from]);
    /* One moment for the form, its history and IPP. */
    const at = new Date();

    await m.query(
      `UPDATE "ipp_applications" a
          SET "stage" = t."to", "reached" = GREATEST(a."reached", t."rank"), "stageEvent" = $4, "stageUpdatedAt" = $5
         FROM unnest($1::uuid[], $2::varchar[], $3::smallint[]) AS t("id", "to", "rank")
        WHERE a."id" = t."id"`,
      [ids, to, to.map((s) => STAGE_RANK[s]), decision.event, at],
    );
    await m.query(
      `INSERT INTO "ipp_approval_events" ("applicationId", "event", "fromStage", "toStage", "reason", "byUserId", "byName", "byRole", "at")
       SELECT t."id", $5::varchar, t."from", t."to", $6::varchar, $7::uuid, $8::varchar, t."role", $9::timestamptz
         FROM unnest($1::uuid[], $2::varchar[], $3::varchar[], $4::varchar[]) WITH ORDINALITY AS t("id", "from", "to", "role", "n") ORDER BY t."n"`,
      [ids, from, to, roles, decision.event, decision.reason, auth.id, auth.name, at],
    );
    await m.query(
      `INSERT INTO "ipp_decisions" ("applicationId", "action", "fromStage", "toStage", "reason", "byName", "byRole", "decidedAt")
       SELECT t."id", $5::varchar, t."from", t."to", $6::varchar, $7::varchar, t."role", $8::timestamptz
         FROM unnest($1::uuid[], $2::varchar[], $3::varchar[], $4::varchar[]) WITH ORDINALITY AS t("id", "from", "to", "role", "n") ORDER BY t."n"`,
      [ids, from, to, roles, approve ? 'APPROVE' : 'REJECT', decision.reason, auth.name, at],
    );
    return moves.map((x) => ({ id: x.id, stage: x.to, stageLabel: STAGE_LABELS[x.to] }));
  }
}

export const ippApprovalsService = new IppApprovalsService();
