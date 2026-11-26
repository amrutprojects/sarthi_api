import type { EntityManager } from 'typeorm';
import { AppDataSource } from '../../config/database.config';
import { likePattern } from '../../shared/utils/pagination';
import { aboveSql, belowSql, canDecideSql, SqlParams, visibleSql, type IppAccess } from './ipp-access';
import { STAGES, type IppEvent, type Level, type Stage } from './ipp-approvals.constants';
import type { SnapshotDocument, SnapshotEdit, SnapshotField } from './ipp-approvals.entity';
import type { ListApplicationsQuery, ListBatchesQuery } from './ipp-approvals.validation';

/*
 * Reads of the IPP approvals. Every query of applications or batches goes through the conditions of ipp-access.ts: what a
 * user may not see is not selected, whatever id they ask for.
 */
const manager = (m?: EntityManager) => m ?? AppDataSource.manager;

export interface EventRow {
  event: IppEvent;
  from: Stage | null;
  to: Stage;
  reason: string | null;
  by: string;
  role: string | null;
  at: Date;
}

export interface ApplicationListRow {
  id: string;
  registrationId: string;
  registrationNumber: string | null;
  name: string;
  mobile: string;
  email: string;
  category: string | null;
  centre: string | null;
  technology: string | null;
  stage: Stage;
  stageUpdatedAt: Date;
  documents: SnapshotDocument[];
  batchId: string;
  batchCode: string;
  batchName: string;
  districtId: string;
  districtName: string;
  lastEvent: (Omit<EventRow, 'at'> & { at: string }) | null;
  canDecide: boolean;
  /* The level it is at decided it before: its next approval there needs a reason. */
  decidedHere: boolean;
}

export interface ApplicationDetailRow extends ApplicationListRow {
  aadhaarMasked: string | null;
  formDistrict: string | null;
  submittedAt: Date;
  auditorApprovedAt: Date | null;
  auditorApprovedBy: string | null;
  auditorApprovalReason: string | null;
  fields: SnapshotField[];
  edits: SnapshotEdit[];
}

export interface BatchListRow {
  id: string;
  code: string;
  name: string;
  size: number;
  districtId: string;
  districtName: string;
  centreCode: string;
  centreName: string;
  startDate: string | null;
  endDate: string | null;
  deliveryMode: 'OFFLINE' | 'ONLINE' | 'BLENDED';
  technologyName: string | null;
  sentBy: string | null;
  receivedAt: Date;
  students: number;
  toDecide: number;
  stages: Record<Stage, number>;
}

const FROM = `
  FROM "ipp_applications" a
  JOIN "ipp_batches" b ON b."id" = a."batchId"
  JOIN "districts" d ON d."id" = b."districtId"`;

/*
 * The level the form is at decided it before (approved it and it came back after a rejection, or rejected it): approving it
 * now is a second approval, which needs a reason (a first one does not). Over ipp_applications `a`.
 */
const DECIDED_HERE = `EXISTS (SELECT 1 FROM "ipp_approval_events" de WHERE de."applicationId" = a."id"
  AND de."event" IN ('APPROVED', 'REJECTED') AND de."fromStage" = a."stage")`;

/* lastEvent: the latest one that moved the form, so a correction does not hide why it was sent back (a."stageEvent" is the same event). */
const ROW = `
  a."id", a."registrationId", a."registrationNumber", a."name", a."mobile", a."email", a."category", a."centre", a."technology",
  a."stage", a."stageUpdatedAt", a."documents", b."id" AS "batchId", b."code" AS "batchCode", b."name" AS "batchName",
  d."id" AS "districtId", d."name" AS "districtName",
  (SELECT jsonb_build_object('event', e."event", 'from', e."fromStage", 'to', e."toStage", 'reason', e."reason", 'by', e."byName",
                             'role', e."byRole", 'at', e."at")
     FROM "ipp_approval_events" e WHERE e."applicationId" = a."id" AND e."event" <> 'CORRECTED' ORDER BY e."seq" DESC LIMIT 1) AS "lastEvent",
  ${DECIDED_HERE} AS "decidedHere"`;

const DETAIL = `
  a."aadhaarMasked", a."formDistrict", a."submittedAt", a."auditorApprovedAt", a."auditorApprovedBy", a."auditorApprovalReason", a."fields", a."edits"`;

const APPLICATION_SORT = { stageUpdatedAt: 'a."stageUpdatedAt"', name: 'lower(a."name")', registrationId: 'a."registrationId"' } as const;
const BATCH_SORT = { receivedAt: 'b."receivedAt"', name: 'lower(b."name")' } as const;

function viewSql(access: IppAccess, view: ListApplicationsQuery['view'], p: SqlParams): string {
  switch (view) {
    case 'TO_DECIDE':
      return canDecideSql(access, p);
    case 'SENT_ON':
      return `(${visibleSql(access, p)} AND ${aboveSql(access, p)})`;
    case 'SENT_BACK':
      return `(${visibleSql(access, p)} AND ${belowSql(access, p)} AND a."stageEvent" = 'REJECTED')`;
    case 'ALL':
      return visibleSql(access, p);
  }
}

class IppApprovalsRepository {
  async listApplications(access: IppAccess, q: ListApplicationsQuery): Promise<{ items: ApplicationListRow[]; total: number }> {
    const p = new SqlParams();
    const where = [viewSql(access, q.view, p)];
    if (q.stage) where.push(`a."stage" = ${p.add(q.stage)}`);
    if (q.batchId) where.push(`a."batchId" = ${p.add(q.batchId)}::uuid`);
    if (q.districtId) where.push(`b."districtId" = ${p.add(q.districtId)}::uuid`);
    if (q.search) {
      const term = p.add(likePattern(q.search));
      where.push(`(a."name" ILIKE ${term} OR a."registrationId" ILIKE ${term} OR a."mobile" ILIKE ${term} OR a."email" ILIKE ${term})`);
    }
    const condition = `${FROM} WHERE ${where.join(' AND ')}`;
    const [{ total }] = (await AppDataSource.query(`SELECT count(*)::int AS "total" ${condition}`, [...p.values])) as { total: number }[];
    if (!total) return { items: [], total };
    const canDecide = canDecideSql(access, p);
    const items: ApplicationListRow[] = await AppDataSource.query(
      `SELECT ${ROW}, ${canDecide} AS "canDecide" ${condition}
        ORDER BY ${APPLICATION_SORT[q.sortBy]} ${q.sortOrder}, a."id" ${q.sortOrder}
        LIMIT ${p.add(q.limit)} OFFSET ${p.add((q.page - 1) * q.limit)}`,
      p.values,
    );
    return { items, total };
  }

  async findApplication(access: IppAccess, id: string): Promise<ApplicationDetailRow | null> {
    const p = new SqlParams();
    const [row] = (await AppDataSource.query(
      `SELECT ${ROW}, ${DETAIL}, ${canDecideSql(access, p)} AS "canDecide" ${FROM} WHERE a."id" = ${p.add(id)}::uuid AND ${visibleSql(access, p)}`,
      p.values,
    )) as ApplicationDetailRow[];
    return row ?? null;
  }

  async isVisible(access: IppAccess, id: string, m?: EntityManager): Promise<boolean> {
    const p = new SqlParams();
    const rows: unknown[] = await manager(m).query(
      `SELECT 1 ${FROM} WHERE a."id" = ${p.add(id)}::uuid AND ${visibleSql(access, p)}`,
      p.values,
    );
    return rows.length > 0;
  }

  /* Newest first. */
  history(id: string): Promise<EventRow[]> {
    return AppDataSource.query(
      `SELECT "event", "fromStage" AS "from", "toStage" AS "to", "reason", "byName" AS "by", "byRole" AS "role", "at"
         FROM "ipp_approval_events" WHERE "applicationId" = $1 ORDER BY "seq" DESC`,
      [id],
    );
  }

  async counts(access: IppAccess): Promise<{ stages: Record<Stage, number>; toDecide: number; sentBack: number }> {
    const p = new SqlParams();
    const rows: { stage: Stage; n: number; toDecide: number; sentBack: number }[] = await AppDataSource.query(
      `SELECT a."stage", count(*)::int AS "n", count(*) FILTER (WHERE ${canDecideSql(access, p)})::int AS "toDecide",
              count(*) FILTER (WHERE a."stageEvent" = 'REJECTED' AND ${canDecideSql(access, p)})::int AS "sentBack"
         ${FROM} WHERE ${visibleSql(access, p)} GROUP BY a."stage"`,
      p.values,
    );
    const stages = Object.fromEntries(STAGES.map((s) => [s, 0])) as Record<Stage, number>;
    let toDecide = 0;
    let sentBack = 0;
    for (const r of rows) {
      stages[r.stage] = r.n;
      toDecide += r.toDecide;
      sentBack += r.sentBack;
    }
    return { stages, toDecide, sentBack };
  }

  /* A batch is seen when one of its applications is; the numbers count the applications the user sees. */
  private batchesSql(access: IppAccess, p: SqlParams): string {
    const perStage = STAGES.map((s) => `'${s}', count(*) FILTER (WHERE a."stage" = '${s}')`).join(', ');
    return `
      FROM "ipp_batches" b
      JOIN "districts" d ON d."id" = b."districtId"
      JOIN LATERAL (
        SELECT count(*)::int AS "students", count(*) FILTER (WHERE ${canDecideSql(access, p)})::int AS "toDecide",
               jsonb_build_object(${perStage}) AS "stages"
          FROM "ipp_applications" a WHERE a."batchId" = b."id" AND ${visibleSql(access, p)}
      ) x ON x."students" > 0`;
  }

  private static readonly BATCH = `
    b."id", b."code", b."name", b."size", d."id" AS "districtId", d."name" AS "districtName", b."centreCode", b."centreName",
    to_char(b."startDate", 'YYYY-MM-DD') AS "startDate", to_char(b."endDate", 'YYYY-MM-DD') AS "endDate", b."deliveryMode",
    b."technologyName", b."sentBy", b."receivedAt", x."students", x."toDecide", x."stages"`;

  async listBatches(access: IppAccess, q: ListBatchesQuery): Promise<{ items: BatchListRow[]; total: number }> {
    const p = new SqlParams();
    const from = this.batchesSql(access, p);
    const where = ['true'];
    if (q.districtId) where.push(`b."districtId" = ${p.add(q.districtId)}::uuid`);
    if (q.search) {
      const term = p.add(likePattern(q.search));
      where.push(`(b."code" ILIKE ${term} OR b."name" ILIKE ${term} OR b."centreName" ILIKE ${term} OR b."centreCode" ILIKE ${term})`);
    }
    const condition = `${from} WHERE ${where.join(' AND ')}`;
    const [{ total }] = (await AppDataSource.query(`SELECT count(*)::int AS "total" ${condition}`, [...p.values])) as { total: number }[];
    if (!total) return { items: [], total };
    const items: BatchListRow[] = await AppDataSource.query(
      `SELECT ${IppApprovalsRepository.BATCH} ${condition}
        ORDER BY ${BATCH_SORT[q.sortBy]} ${q.sortOrder}, b."id" ${q.sortOrder}
        LIMIT ${p.add(q.limit)} OFFSET ${p.add((q.page - 1) * q.limit)}`,
      p.values,
    );
    return { items, total };
  }

  async findBatch(access: IppAccess, id: string): Promise<BatchListRow | null> {
    const p = new SqlParams();
    const from = this.batchesSql(access, p);
    const [row] = (await AppDataSource.query(
      `SELECT ${IppApprovalsRepository.BATCH} ${from} WHERE b."id" = ${p.add(id)}::uuid`,
      p.values,
    )) as BatchListRow[];
    return row ?? null;
  }

  async isBatchVisible(access: IppAccess, batchId: string, m?: EntityManager): Promise<boolean> {
    const p = new SqlParams();
    const rows: unknown[] = await manager(m).query(
      `SELECT 1 ${FROM} WHERE a."batchId" = ${p.add(batchId)}::uuid AND ${visibleSql(access, p)} LIMIT 1`,
      p.values,
    );
    return rows.length > 0;
  }

  /*
   * The applications that are the user's to decide now, locked until the transaction ends (always in id order, so two
   * officers never block each other for good). A second officer waits here and then finds the stage changed: PostgreSQL
   * checks the conditions again on the row as the first one left it.
   */
  lockDecidable(
    m: EntityManager,
    access: IppAccess,
    which: { ids: string[] } | { batchId: string },
  ): Promise<{ id: string; stage: Level; decidedHere: boolean }[]> {
    const p = new SqlParams();
    const filter = 'ids' in which ? `a."id" = ANY(${p.add(which.ids)}::uuid[])` : `a."batchId" = ${p.add(which.batchId)}::uuid`;
    return m.query(
      `SELECT a."id", a."stage", ${DECIDED_HERE} AS "decidedHere" FROM "ipp_applications" a JOIN "ipp_batches" b ON b."id" = a."batchId"
        WHERE ${filter} AND ${canDecideSql(access, p)} ORDER BY a."id" FOR UPDATE OF a`,
      p.values,
    );
  }

  /* Active districts, for filters and the officers' page. */
  activeDistricts(): Promise<{ id: string; name: string; code: string }[]> {
    return AppDataSource.query(
      `SELECT "id", "name", "code" FROM "districts" WHERE "isDelete" = false AND "isActive" = true ORDER BY lower("name"), "id"`,
    );
  }

  districtsOf(userId: string): Promise<{ id: string; name: string }[]> {
    return AppDataSource.query(
      `SELECT d."id", d."name" FROM "user_districts" ud JOIN "districts" d ON d."id" = ud."districtId"
        WHERE ud."userId" = $1 AND ud."isDelete" = false ORDER BY lower(d."name"), d."id"`,
      [userId],
    );
  }
}

export const ippApprovalsRepository = new IppApprovalsRepository();
