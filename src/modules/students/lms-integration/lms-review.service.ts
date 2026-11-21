import type { Request } from 'express';
import { MESSAGES } from '../../../constants/api-response.constants';
import { AppDataSource } from '../../../config/database.config';
import { AppError } from '../../../shared/errors/app-error';
import { auditService } from '../../audit';
import type { AuthUser } from '../../auth';
import { maskAadhaar, maskEmail, maskMobile } from '../aadhaar';
import type { MatchDecision } from '../import/import.service';
import type { ImportRowValues } from '../import/row-validator';
import { Student } from '../register/student.entity';
import { LmsStudentReview } from './lms-integration.entities';
import { insertLmsStudent, LMS_AUDIT, studentValuesOf } from './lms-student.service';

/*
 * Amrut's review of LMS creates it held (202 REVIEW). The decision words, rules and audit action are the import's
 * same-person / different-person workflow (import.service.ts `decide`, A-16):
 *   SAME_PERSON       the LMS learner is the matched student: linked to it, nothing in the register changes
 *                     (protected identity fields are never overwritten);
 *   DIFFERENT_PERSON  a new student is created from the held values (source LMS, code LMS-…), with the review's id —
 *                     the student_id the LMS was given;
 *   HOLD              stays pending.
 * The LMS learns the outcome by retrying its create with the same Idempotency-Key (or the same learner reference):
 * 202 REVIEW while pending, then 200 MATCHED or 201 CREATED.
 */

/* The review as the Panel sees it: masked contact and Aadhaar, like the import's preview grid. */
export function publicReview(r: LmsStudentReview, match: Pick<Student, 'id' | 'code'> | null) {
  const d = r.data as Partial<ImportRowValues>;
  return {
    id: r.id,
    status: r.status,
    lmsTenantCode: r.lmsTenantCode,
    lmsLearnerRef: r.lmsLearnerRef,
    name: [d.firstName, d.lastName].filter(Boolean).join(' '),
    fatherName: d.fatherName ?? null,
    motherName: d.motherName ?? null,
    dateOfBirth: d.dateOfBirth ?? null,
    email: maskEmail(d.email ?? null),
    mobile: maskMobile(d.mobile ?? null),
    aadhaar: maskAadhaar(r.aadhaarLast4),
    gender: d.gender ?? null,
    districtName: d.districtName ?? null,
    talukaName: d.talukaName ?? null,
    match: { tier: r.matchTier, studentId: r.matchStudentId, studentCode: match?.code ?? null, note: r.matchNote },
    decision: r.decision,
    decisionReason: r.decisionReason,
    decidedById: r.decidedById,
    decidedAt: r.decidedAt,
    studentId: r.studentId,
    createdAt: r.createdAt,
  };
}
export type PublicReview = ReturnType<typeof publicReview>;

const reviews = () => AppDataSource.getRepository(LmsStudentReview);

async function withMatches(rows: LmsStudentReview[]): Promise<PublicReview[]> {
  const ids = [...new Set(rows.map((r) => r.matchStudentId))];
  const students = ids.length
    ? await AppDataSource.getRepository(Student).find({ where: ids.map((id) => ({ id })), select: { id: true, code: true } })
    : [];
  return rows.map((r) => publicReview(r, students.find((s) => s.id === r.matchStudentId) ?? null));
}

export const lmsReviewService = {
  async list(q: { page: number; limit: number; status?: 'PENDING' | 'DECIDED' }) {
    const [items, total] = await reviews().findAndCount({
      where: q.status ? { status: q.status } : {},
      order: { createdAt: 'DESC' },
      skip: (q.page - 1) * q.limit,
      take: q.limit,
    });
    return { items: await withMatches(items), total };
  },

  async get(id: string): Promise<PublicReview> {
    const r = await reviews().findOneBy({ id });
    if (!r) throw AppError.notFound(MESSAGES.notFound('Review'));
    return (await withMatches([r]))[0];
  },

  async decide(id: string, decision: MatchDecision, reason: string, actor: AuthUser, req?: Request): Promise<PublicReview> {
    const result = await AppDataSource.transaction(async (m) => {
      const repo = m.getRepository(LmsStudentReview);
      const r = await repo
        .createQueryBuilder('r')
        .addSelect('r.aadhaarEnc')
        .where('r.id = :id', { id })
        .setLock('pessimistic_write')
        .getOne();
      if (!r) throw AppError.notFound(MESSAGES.notFound('Review'));
      if (r.status === 'DECIDED') throw AppError.conflict('This review is already decided');
      Object.assign(r, { decision, decisionReason: reason, decidedById: actor.id, decidedAt: new Date() });
      let created: Student | null = null;
      if (decision === 'SAME_PERSON') {
        const match = await m.getRepository(Student).findOne({ where: { id: r.matchStudentId, isDelete: false } });
        if (!match) throw AppError.conflict('The matched student no longer exists; decide DIFFERENT_PERSON or HOLD');
        r.status = 'DECIDED';
        r.studentId = match.id;
      } else if (decision === 'DIFFERENT_PERSON') {
        const d = r.data as unknown as ImportRowValues & { sourceChecksum: string };
        created = await insertLmsStudent(
          m,
          studentValuesOf(d, { lmsTenantCode: r.lmsTenantCode, lmsLearnerRef: r.lmsLearnerRef }),
          { aadhaarEnc: r.aadhaarEnc, aadhaarBidx: r.aadhaarBidx, aadhaarLast4: r.aadhaarLast4 },
          d.sourceChecksum,
          r.id,
        );
        r.status = 'DECIDED';
        r.studentId = created.id;
      }
      await repo.save(r);
      await auditService.recordInTx(m, req, {
        action: 'reconciliation.decided',
        resource: 'lms_student_review',
        resourceId: r.id,
        details: { tier: r.matchTier, decision, reason, studentId: r.studentId },
      });
      if (created) {
        await auditService.recordInTx(m, req, {
          action: LMS_AUDIT.CREATED,
          resource: 'student',
          resourceId: created.id,
          details: { code: created.code, reviewId: r.id, lmsTenantCode: r.lmsTenantCode },
        });
      }
      return r;
    });
    return (await withMatches([result]))[0];
  },
};
