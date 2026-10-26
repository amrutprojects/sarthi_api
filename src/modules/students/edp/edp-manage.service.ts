import crypto from 'crypto';
import bcrypt from 'bcrypt';
import type { Request } from 'express';
import { AppDataSource } from '../../../config/database.config';
import { AppError } from '../../../shared/errors/app-error';
import { buildMeta, likePattern, toSkipTake } from '../../../shared/utils/pagination';
import { auditService } from '../../audit';
import { EDP_FOLLOW_UP_STATUS, EDP_STAGES, type EdpFollowUpStatus, type EdpStage } from './edp.constants';
import { EdpAccount, EdpAdmin, EdpFollowUp } from './edp.entities';
import { signEdpToken } from './edp.security';
import type { FollowUpBody, ManageListQuery } from './edp.validation';

const DUMMY_HASH = bcrypt.hashSync(crypto.randomBytes(16).toString('hex'), 4);

/* Where each student stands, derived in SQL so the list can be filtered and counted by it. */
const STAGE_SQL = `CASE
  WHEN a."emailVerifiedAt" IS NULL THEN 'OTP_PENDING'
  WHEN p."status" = 'SUBMITTED' THEN 'SUBMITTED'
  WHEN p."mainCompletedAt" IS NOT NULL THEN 'MAIN_DONE'
  WHEN p."basicCompletedAt" IS NOT NULL THEN 'BASIC_DONE'
  ELSE 'VERIFIED' END`;

/* The latest follow-up of each account: its current follow-up status (fu.* null = not followed up yet). */
const FROM = `FROM "edp_accounts" a
  LEFT JOIN "edp_applications" p ON p."accountId" = a."id" AND p."isDelete" = false
  LEFT JOIN "students" s ON s."id" = p."studentId" AND s."isDelete" = false
  LEFT JOIN LATERAL (
    SELECT f."status", f."note", f."createdAt", m."name" AS "byName"
    FROM "edp_follow_ups" f LEFT JOIN "edp_admins" m ON m."id" = f."adminId"
    WHERE f."accountId" = a."id" AND f."isDelete" = false
    ORDER BY f."createdAt" DESC, f."id" DESC
    LIMIT 1
  ) fu ON true
  WHERE a."isDelete" = false`;

const followUpDto = (f: { status: string; note: string | null; createdAt: Date; byName: string | null }) => ({
  status: f.status as EdpFollowUpStatus,
  status_label: EDP_FOLLOW_UP_STATUS[f.status as EdpFollowUpStatus],
  note: f.note,
  at: f.createdAt,
  by: f.byName,
});

interface Row {
  id: string;
  firstName: string;
  middleName: string | null;
  lastName: string;
  email: string;
  mobile: string;
  stage: EdpStage;
  createdAt: Date;
  emailVerifiedAt: Date | null;
  lastLoginAt: Date | null;
  basicCompletedAt: Date | null;
  mainCompletedAt: Date | null;
  submittedAt: Date | null;
  lastActivityAt: Date;
  code: string | null;
  registrationNumber: string | null;
  fuStatus: string | null;
  fuNote: string | null;
  fuAt: Date | null;
  fuBy: string | null;
}

/* The EDP tracking panel (edp.sumago.ai/manage): its own sign-in and read-only views over the portal's tables. */
export const edpManageService = {
  async login(email: string, password: string) {
    const admin = await AppDataSource.getRepository(EdpAdmin)
      .createQueryBuilder('m')
      .addSelect('m.passwordHash')
      .where('m.email = :email AND m.isDelete = false', { email })
      .getOne();
    const ok = await bcrypt.compare(password, admin?.passwordHash ?? DUMMY_HASH);
    if (!admin || !ok || !admin.isActive) throw AppError.unauthorized('Incorrect email or password');
    await AppDataSource.getRepository(EdpAdmin).update(admin.id, { lastLoginAt: new Date() });
    const { token, expiresAt } = signEdpToken('edp-admin', admin.id);
    return { token, expires_at: expiresAt, admin: { id: admin.id, name: admin.name, email: admin.email } };
  },

  /* Students per stage, plus the total, and per current follow-up status (NONE = not followed up yet). */
  async summary() {
    const rows: { stage: EdpStage; n: number }[] = await AppDataSource.query(
      `SELECT ${STAGE_SQL} AS "stage", count(*)::int AS "n" ${FROM} GROUP BY 1`,
    );
    const counts = Object.fromEntries(Object.keys(EDP_STAGES).map((k) => [k, 0])) as Record<EdpStage, number>;
    for (const r of rows) counts[r.stage] = r.n;
    const fuRows: { status: string; n: number }[] = await AppDataSource.query(
      `SELECT coalesce(fu."status", 'NONE') AS "status", count(*)::int AS "n" ${FROM} GROUP BY 1`,
    );
    const followUps = Object.fromEntries(['NONE', ...Object.keys(EDP_FOLLOW_UP_STATUS)].map((k) => [k, 0])) as Record<
      EdpFollowUpStatus | 'NONE',
      number
    >;
    for (const r of fuRows) followUps[r.status as EdpFollowUpStatus | 'NONE'] = r.n;
    return {
      total: rows.reduce((t, r) => t + r.n, 0),
      counts,
      stages: Object.entries(EDP_STAGES).map(([code, label]) => ({ code, label, count: counts[code as EdpStage] })),
      follow_ups: followUps,
    };
  },

  /* A student's follow-ups, newest first (who recorded each, when, the status and the note). */
  async followUps(accountId: string) {
    const exists = await AppDataSource.getRepository(EdpAccount).exists({ where: { id: accountId, isDelete: false } });
    if (!exists) throw AppError.notFound('Student not found');
    const rows: { status: string; note: string | null; createdAt: Date; byName: string | null }[] = await AppDataSource.query(
      `SELECT f."status", f."note", f."createdAt", m."name" AS "byName"
       FROM "edp_follow_ups" f LEFT JOIN "edp_admins" m ON m."id" = f."adminId"
       WHERE f."accountId" = $1 AND f."isDelete" = false
       ORDER BY f."createdAt" DESC, f."id" DESC`,
      [accountId],
    );
    return rows.map(followUpDto);
  },

  /* Records a follow-up (status + optional note) by the signed-in EDP admin; it becomes the student's current status. */
  async addFollowUp(req: Request, admin: EdpAdmin, accountId: string, body: FollowUpBody) {
    const exists = await AppDataSource.getRepository(EdpAccount).exists({ where: { id: accountId, isDelete: false } });
    if (!exists) throw AppError.notFound('Student not found');
    const note = body.note?.trim() || null;
    const saved = await AppDataSource.getRepository(EdpFollowUp).save(
      AppDataSource.getRepository(EdpFollowUp).create({ accountId, status: body.status, note, adminId: admin.id }),
    );
    await auditService.record(req, {
      action: 'edp.follow_up.create',
      resource: 'edp_account',
      resourceId: accountId,
      actorUserId: null,
      details: { followUpId: saved.id, status: body.status, edpAdminId: admin.id, hasNote: !!note },
    });
    return this.followUps(accountId);
  },

  /* Every account, newest first: contact details, stage and the dates of each step; search by name, email or mobile. */
  async list(q: ManageListQuery) {
    const params: unknown[] = [];
    let where = '';
    if (q.search) {
      params.push(likePattern(q.search.trim()));
      where += ` AND ((a."firstName" || ' ' || coalesce(a."middleName" || ' ', '') || a."lastName") ILIKE $${params.length}
        OR (a."firstName" || ' ' || a."lastName") ILIKE $${params.length} OR a."email" ILIKE $${params.length}
        OR a."mobile" LIKE $${params.length} OR s."code" ILIKE $${params.length})`;
    }
    if (q.stage) {
      params.push(q.stage);
      where += ` AND ${STAGE_SQL} = $${params.length}`;
    }
    if (q.follow_up === 'NONE') where += ` AND fu."status" IS NULL`;
    else if (q.follow_up) {
      params.push(q.follow_up);
      where += ` AND fu."status" = $${params.length}`;
    }
    const [{ total }]: { total: number }[] = await AppDataSource.query(`SELECT count(*)::int AS "total" ${FROM}${where}`, params);
    const { skip, take } = toSkipTake(q);
    const rows: Row[] = await AppDataSource.query(
      `SELECT a."id", a."firstName", a."middleName", a."lastName", a."email", a."mobile", ${STAGE_SQL} AS "stage",
              a."createdAt", a."emailVerifiedAt", a."lastLoginAt", p."basicCompletedAt", p."mainCompletedAt",
              p."submittedAt", s."code", s."registrationNumber",
              fu."status" AS "fuStatus", fu."note" AS "fuNote", fu."createdAt" AS "fuAt", fu."byName" AS "fuBy",
              GREATEST(a."updatedAt", coalesce(p."updatedAt", a."updatedAt")) AS "lastActivityAt"
       ${FROM}${where}
       ORDER BY a."createdAt" ${q.sortOrder === 'ASC' ? 'ASC' : 'DESC'}, a."id"
       LIMIT ${take} OFFSET ${skip}`,
      params,
    );
    return {
      items: rows.map((r) => ({
        id: r.id,
        name: [r.firstName, r.middleName, r.lastName].filter(Boolean).join(' '),
        email: r.email,
        mobile_number: r.mobile,
        stage: r.stage,
        stage_label: EDP_STAGES[r.stage],
        account_created_at: r.createdAt,
        otp_verified_at: r.emailVerifiedAt,
        last_login_at: r.lastLoginAt,
        basic_completed_at: r.basicCompletedAt,
        main_completed_at: r.mainCompletedAt,
        submitted_at: r.submittedAt,
        registration_id: r.code,
        registration_number: r.registrationNumber,
        last_activity_at: r.lastActivityAt,
        follow_up: r.fuStatus ? followUpDto({ status: r.fuStatus, note: r.fuNote, createdAt: r.fuAt!, byName: r.fuBy }) : null,
      })),
      meta: buildMeta(q, total),
    };
  },
};
