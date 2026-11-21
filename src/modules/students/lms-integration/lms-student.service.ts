import crypto from 'crypto';
import type { Request } from 'express';
import type { EntityManager } from 'typeorm';
import { AppDataSource } from '../../../config/database.config';
import { auditService } from '../../audit';
import { mastersService } from '../../masters';
import { loadGeographyLookup } from '../import/geography';
import { rowChecksum, type ImportRowValues } from '../import/row-validator';
import { allocateRegistrationNumber } from '../registration/registration-number';
import { Student } from '../register/student.entity';
import { STUDENT_STATUS } from '../student.constants';
import { LMS_API_CODES, LmsApiError } from './lms-api-error';
import { LmsStudentRequest, LmsStudentReview } from './lms-integration.entities';
import {
  LMS_OPTIONAL_FIELDS,
  LMS_PATCHABLE_FIELDS,
  LMS_REQUIRED_FIELDS,
  normaliseLmsStudent,
  profileOf,
  typeErrors,
  type FieldError,
} from './lms-student.fields';
import { matchStudent, resultOf, type MatchProbe, type MatchResult, type MatchTier } from './student-match';

/*
 * The Amrut side of the LMS link (contract lms-api docs/contracts/multi-tenant/amrut-student-api.md §2–§4), called by
 * the LMS with an Amrut-issued key. It never returns a matched person's values, and nothing it logs or audits holds a
 * personal value (student codes, tiers, field names and key ids only).
 */

export const LMS_STUDENT_SOURCE = 'LMS';
export const LMS_CODE_PREFIX = 'LMS-';
/* students.externalStatus of a student created from the LMS (no source-portal status exists for it). */
export const LMS_EXTERNAL_STATUS = 'LMS';

export const LMS_AUDIT = {
  MATCHED: 'lms_integration.student.matched',
  CREATED: 'lms_integration.student.created',
  REVIEW: 'lms_integration.student.review',
  UPDATED: 'lms_integration.student.updated',
} as const;

/* One lock for every LMS create: two creates of one person never both pass the duplicate check. */
const CREATE_LOCK = 'lms-integration:students';
const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9_.:-]{1,100}$/;
const REF_RE = /^[A-Za-z0-9_.:-]{1,100}$/;
const TENANT_RE = /^[A-Za-z0-9_.-]{1,64}$/;

export interface MatchAnswer {
  result: MatchResult;
  tier: MatchTier | null;
  student_id: string | null;
  student_code: string | null;
}

export type CreateAnswer =
  | { status: 201; body: { result: 'CREATED'; student_id: string; student_code: string } }
  | { status: 200; body: { result: 'MATCHED'; student_id: string; student_code: string } }
  | { status: 202; body: { result: 'REVIEW'; student_id: string } };

const asObject = (body: unknown): Record<string, unknown> => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw LmsApiError.validation([{ field: 'body', code: 'invalid_type' }]);
  return body as Record<string, unknown>;
};

const loadContext = () => Promise.all([mastersService.loadLookup(), loadGeographyLookup()]);

const probeOf = (row: ImportRowValues): MatchProbe => ({
  sourceRecordId: row.sourceRecordId,
  aadhaarBidx: row.aadhaarBidx,
  dateOfBirth: row.dateOfBirth,
  nameKey: row.nameKey,
  mobile: row.mobile,
  email: row.email,
});

/* Request hash for idempotency: the body with the Aadhaar number replaced by its blind index, keys sorted. */
function requestHashOf(body: Record<string, unknown>, aadhaarBidx: string | null): string {
  const copy: Record<string, unknown> = { ...body, aadhaar_number: body.aadhaar_number ? `bidx:${aadhaarBidx ?? 'invalid'}` : null };
  const sorted = Object.fromEntries(
    Object.keys(copy)
      .sort()
      .map((k) => [k, copy[k] ?? null]),
  );
  return crypto.createHash('sha256').update(JSON.stringify(sorted)).digest('hex');
}

/* The student columns of an LMS student (shared by create and a DIFFERENT_PERSON review decision). */
export function studentValuesOf(row: ImportRowValues, refs: { lmsTenantCode: string; lmsLearnerRef: string }) {
  return {
    sourceRecordId: row.sourceRecordId,
    firstName: row.firstName,
    lastName: row.lastName,
    fatherName: row.fatherName,
    motherName: row.motherName,
    email: row.email,
    dateOfBirth: row.dateOfBirth,
    /* Not part of the LMS set (N-7): empty until Amrut staff complete them. */
    currentAddress: row.currentAddress ?? '',
    religion: row.religion ?? '',
    caste: row.caste ?? '',
    mobile: row.mobile,
    centreCode: row.centreCode,
    regionId: row.regionId ?? null,
    casteId: row.casteId ?? null,
    educationId: row.educationId ?? null,
    trackCode: row.trackCode,
    trackSourceValue: row.trackSourceValue ?? '',
    educationQualification: row.educationQualification ?? '',
    status: STUDENT_STATUS.RECEIVED,
    externalStatus: LMS_EXTERNAL_STATUS,
    approvedAt: null,
    evidenceRef: null,
    declarationAccepted: null,
    documents: {},
    importBatchId: null,
    source: LMS_STUDENT_SOURCE,
    ...profileOf(row),
    sourceExtra: { 'LMS tenant': refs.lmsTenantCode, 'LMS learner reference': refs.lmsLearnerRef },
  };
}

/* Inserts a student created from the LMS (code LMS-000001…, a registration number like every other student). */
export async function insertLmsStudent(
  m: EntityManager,
  values: ReturnType<typeof studentValuesOf>,
  protectedFields: { aadhaarEnc: Buffer | null; aadhaarBidx: string | null; aadhaarLast4: string | null },
  sourceChecksum: string,
  id?: string,
): Promise<Student> {
  const seq: { n: string }[] = await m.query(`SELECT nextval('students_lms_code_seq') AS n`);
  const registrationNumber = await allocateRegistrationNumber(m);
  const repo = m.getRepository(Student);
  return repo.save(
    repo.create({
      ...(id ? { id } : {}),
      ...values,
      ...protectedFields,
      code: LMS_CODE_PREFIX + String(seq[0].n).padStart(6, '0'),
      registrationNumber,
      sourceChecksum,
    }),
  );
}

const codeOf = async (m: EntityManager, id: string): Promise<string> =>
  (await m.getRepository(Student).findOne({ where: { id }, select: { id: true, code: true } }))?.code ?? '';

/* What a stored request answers now (a REVIEW answer follows the review's decision once it is made). */
async function answerOfRequest(m: EntityManager, r: Pick<LmsStudentRequest, 'result' | 'studentId' | 'reviewId'>): Promise<CreateAnswer> {
  if (r.result === 'REVIEW' && r.reviewId) {
    const review = await m.getRepository(LmsStudentReview).findOneByOrFail({ id: r.reviewId });
    if (review.status === 'DECIDED' && review.studentId) {
      const code = await codeOf(m, review.studentId);
      return review.decision === 'SAME_PERSON'
        ? { status: 200, body: { result: 'MATCHED', student_id: review.studentId, student_code: code } }
        : { status: 201, body: { result: 'CREATED', student_id: review.studentId, student_code: code } };
    }
    return { status: 202, body: { result: 'REVIEW', student_id: review.id } };
  }
  const code = await codeOf(m, r.studentId as string);
  return r.result === 'CREATED'
    ? { status: 201, body: { result: 'CREATED', student_id: r.studentId as string, student_code: code } }
    : { status: 200, body: { result: 'MATCHED', student_id: r.studentId as string, student_code: code } };
}

export const lmsStudentService = {
  /* §2: duplicate check before creating; the import's tiers. */
  async match(input: unknown): Promise<MatchAnswer> {
    const body = asObject(input);
    const fields = ['source_record_id', 'aadhaar_number', 'first_name', 'last_name', 'date_of_birth', 'mobile_number', 'email'];
    const errors: FieldError[] = typeErrors(body, fields);
    for (const f of ['first_name', 'last_name', 'date_of_birth'])
      if (!errors.some((e) => e.field === f) && !String(body[f] ?? '').trim()) errors.push({ field: f, code: 'required' });
    if (errors.length) throw LmsApiError.validation(errors);
    const [masters, geography] = await loadContext();
    const { row } = normaliseLmsStudent(body, masters, geography, { requireAll: false });
    const outcome = await matchStudent(probeOf(row));
    const result = resultOf(outcome);
    const student = result === 'NONE' ? null : outcome.student;
    return { result, tier: outcome.tier, student_id: student?.id ?? null, student_code: student?.code ?? null };
  },

  /*
   * §3: create-or-match, idempotent per (LMS tenant, Idempotency-Key), and per LMS learner: a learner already answered
   * gets the same student. MATCH → 200 MATCHED (nothing created); T1 conflict or T2 → 202 REVIEW (held for Amrut's
   * same-person / different-person decision); otherwise → 201 CREATED (source LMS, code LMS-000001…).
   */
  async create(input: unknown, idempotencyKey: string | undefined, apiKeyId: string | null, req?: Request): Promise<CreateAnswer> {
    if (!idempotencyKey || !IDEMPOTENCY_KEY_RE.test(idempotencyKey))
      throw LmsApiError.validation([{ field: 'Idempotency-Key', code: idempotencyKey ? 'invalid' : 'required' }]);
    const body = asObject(input);
    const all = [...LMS_REQUIRED_FIELDS, ...LMS_OPTIONAL_FIELDS, 'lms_tenant_code', 'lms_learner_ref'];
    const errors = typeErrors(body, all);
    const tenant = String(body.lms_tenant_code ?? '').trim();
    const learnerRef = String(body.lms_learner_ref ?? '').trim();
    if (!errors.some((e) => e.field === 'lms_tenant_code') && !TENANT_RE.test(tenant))
      errors.push({ field: 'lms_tenant_code', code: tenant ? 'invalid' : 'required' });
    if (!errors.some((e) => e.field === 'lms_learner_ref') && !REF_RE.test(learnerRef))
      errors.push({ field: 'lms_learner_ref', code: learnerRef ? 'invalid' : 'required' });
    const [masters, geography] = await loadContext();
    const typed = new Set(errors.map((e) => e.field));
    const norm = normaliseLmsStudent(body, masters, geography);
    for (const e of norm.errors) if (!typed.has(e.field)) errors.push(e);
    if (errors.length) throw LmsApiError.validation(errors);
    const { row, raw } = norm;
    const requestHash = requestHashOf(body, row.aadhaarBidx);

    const outcome = await AppDataSource.transaction(async (m) => {
      await m.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [CREATE_LOCK]);
      const requests = m.getRepository(LmsStudentRequest);
      const replay = await requests.findOne({ where: { lmsTenantCode: tenant, idempotencyKey } });
      if (replay) {
        if (replay.requestHash !== requestHash)
          throw new LmsApiError(
            422,
            LMS_API_CODES.IDEMPOTENCY_KEY_REUSED,
            'This Idempotency-Key was already used for a different request',
            [{ field: 'Idempotency-Key', code: 'reused' }],
          );
        return { answer: await answerOfRequest(m, replay), audit: null };
      }
      const record = (
        r: Omit<LmsStudentRequest, 'id' | 'createdAt' | 'lmsTenantCode' | 'idempotencyKey' | 'requestHash' | 'lmsLearnerRef' | 'apiKeyId'>,
      ) => requests.insert({ ...r, lmsTenantCode: tenant, idempotencyKey, requestHash, lmsLearnerRef: learnerRef, apiKeyId });

      /* The same LMS learner again (a new Idempotency-Key): the same student or the same pending review. */
      const earlier = await requests.findOne({ where: { lmsTenantCode: tenant, lmsLearnerRef: learnerRef }, order: { createdAt: 'DESC' } });
      if (earlier) {
        await record({ result: earlier.result, tier: earlier.tier, studentId: earlier.studentId, reviewId: earlier.reviewId });
        return { answer: await answerOfRequest(m, earlier), audit: null };
      }

      const found = await matchStudent(probeOf(row), m);
      const result = resultOf(found);
      if (result === 'MATCH' && found.student) {
        await record({ result: 'MATCHED', tier: found.tier, studentId: found.student.id, reviewId: null });
        return {
          answer: {
            status: 200,
            body: { result: 'MATCHED', student_id: found.student.id, student_code: found.student.code },
          } as CreateAnswer,
          audit: {
            action: LMS_AUDIT.MATCHED,
            resource: 'student',
            resourceId: found.student.id,
            details: { code: found.student.code, tier: found.tier },
          },
        };
      }
      if (result === 'POSSIBLE' && found.student) {
        const { aadhaarEnc, aadhaarBidx, aadhaarLast4, ...data } = row;
        const review = await m.getRepository(LmsStudentReview).save(
          m.getRepository(LmsStudentReview).create({
            lmsTenantCode: tenant,
            lmsLearnerRef: learnerRef,
            status: 'PENDING',
            matchStudentId: found.student.id,
            matchTier: found.tier as string,
            matchNote: (found.note ?? '').slice(0, 300),
            data: { ...data, sourceChecksum: rowChecksum({ ...raw, aadhaar_number: aadhaarBidx ?? '' }) } as unknown as Record<
              string,
              unknown
            >,
            aadhaarEnc,
            aadhaarBidx,
            aadhaarLast4,
            apiKeyId,
          }),
        );
        await record({ result: 'REVIEW', tier: found.tier, studentId: null, reviewId: review.id });
        return {
          answer: { status: 202, body: { result: 'REVIEW', student_id: review.id } } as CreateAnswer,
          audit: {
            action: LMS_AUDIT.REVIEW,
            resource: 'lms_student_review',
            resourceId: review.id,
            details: { tier: found.tier, matchCode: found.student.code },
          },
        };
      }
      const student = await insertLmsStudent(
        m,
        studentValuesOf(row, { lmsTenantCode: tenant, lmsLearnerRef: learnerRef }),
        { aadhaarEnc: row.aadhaarEnc, aadhaarBidx: row.aadhaarBidx, aadhaarLast4: row.aadhaarLast4 },
        rowChecksum({ ...raw, aadhaar_number: row.aadhaarBidx ?? '' }),
      );
      await record({ result: 'CREATED', tier: found.tier, studentId: student.id, reviewId: null });
      return {
        answer: { status: 201, body: { result: 'CREATED', student_id: student.id, student_code: student.code } } as CreateAnswer,
        audit: {
          action: LMS_AUDIT.CREATED,
          resource: 'student',
          resourceId: student.id,
          details: { code: student.code, tier: found.tier },
        },
      };
    });
    if (outcome.audit) {
      await auditService.record(req, {
        ...outcome.audit,
        actorUserId: null,
        details: { ...outcome.audit.details, lmsTenantCode: tenant, apiKeyId },
      });
    }
    return outcome.answer;
  },

  /*
   * §4: a profile correction requested in the LMS. Only the person's own details (LMS_PATCHABLE_FIELDS), normalised by
   * the import's rules. 404 for an unknown student; 409 STALE when `source_updated_at` is older than Amrut's last
   * change to the student. A correction that changes nothing is UPDATED (a retry is safe).
   */
  async update(studentId: string, input: unknown, apiKeyId: string | null, req?: Request): Promise<{ result: 'UPDATED' }> {
    const body = asObject(input);
    const changed = Object.keys(body).filter((k) => k !== 'source_updated_at');
    const errors: FieldError[] = [];
    const at = typeof body.source_updated_at === 'string' ? new Date(body.source_updated_at) : null;
    if (!at || Number.isNaN(at.getTime()) || !/^\d{4}-\d{2}-\d{2}T/.test(String(body.source_updated_at)))
      errors.push({ field: 'source_updated_at', code: body.source_updated_at === undefined ? 'required' : 'invalid' });
    for (const k of changed) if (!(LMS_PATCHABLE_FIELDS as readonly string[]).includes(k)) errors.push({ field: k, code: 'not_allowed' });
    if (!changed.length && !errors.length) errors.push({ field: 'body', code: 'no_changes' });
    errors.push(...typeErrors(body, changed).filter((e) => !errors.some((x) => x.field === e.field)));
    if (errors.length) throw LmsApiError.validation(errors);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(studentId))
      throw new LmsApiError(404, LMS_API_CODES.NOT_FOUND, 'Student not found');

    const [masters, geography] = await loadContext();
    await AppDataSource.transaction(async (m) => {
      const repo = m.getRepository(Student);
      const student = await repo.findOne({ where: { id: studentId, isDelete: false }, lock: { mode: 'pessimistic_write' } });
      if (!student) throw new LmsApiError(404, LMS_API_CODES.NOT_FOUND, 'Student not found');

      /* District and taluka are looked up together: a taluka alone is matched within the student's district. */
      const probe: Record<string, unknown> = { ...body };
      if (changed.includes('taluka') && !changed.includes('district')) probe.district = student.districtName ?? '';
      const { row, errors: issues } = normaliseLmsStudent(probe, masters, geography, { only: changed });
      if (issues.length) throw LmsApiError.validation(issues);

      const next: Partial<Student> = {};
      const set = <K extends keyof Student>(k: K, v: Student[K]) => {
        if (student[k] !== v) next[k] = v;
      };
      for (const f of changed) {
        switch (f) {
          case 'first_name':
            set('firstName', row.firstName);
            break;
          case 'last_name':
            set('lastName', row.lastName);
            break;
          case 'father_name':
            set('fatherName', row.fatherName);
            break;
          case 'mother_name':
            set('motherName', row.motherName);
            break;
          case 'email':
            set('email', row.email);
            break;
          case 'date_of_birth':
            set('dateOfBirth', row.dateOfBirth);
            break;
          case 'mobile_number':
            set('mobile', row.mobile);
            break;
          case 'gender':
            set('gender', row.gender);
            break;
          case 'marital_status':
            set('maritalStatus', row.maritalStatus);
            break;
          case 'permanent_address':
            set('permanentAddress', row.permanentAddress);
            break;
          case 'landmark':
            set('landmark', row.landmark);
            break;
          case 'district':
            set('districtName', row.districtName);
            set('districtId', row.districtId);
            break;
          case 'taluka':
            set('talukaName', row.talukaName);
            set('talukaId', row.talukaId);
            break;
          case 'division':
            set('division', row.division);
            break;
          case 'pin_code':
            set('pinCode', row.pinCode);
            break;
          case 'alternate_mobile_number':
            set('alternateMobile', row.alternateMobile);
            break;
          case 'alternate_email':
            set('alternateEmail', row.alternateEmail);
            break;
        }
      }
      const fields = Object.keys(next);
      if (!fields.length) return { fields };
      if ((at as Date).getTime() < student.updatedAt.getTime())
        throw new LmsApiError(409, LMS_API_CODES.STALE, 'The correction is older than Amrut’s copy');
      await repo.update({ id: student.id }, next);
      await auditService.recordInTx(m, req, {
        action: LMS_AUDIT.UPDATED,
        resource: 'student',
        resourceId: student.id,
        actorUserId: null,
        details: { code: student.code, fields: changed, apiKeyId },
      });
      return { fields };
    });
    return { result: 'UPDATED' };
  },
};
