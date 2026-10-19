import type { Request } from 'express';
import { QueryFailedError } from 'typeorm';
import { ERROR_CODES, HTTP_STATUS } from '../../../constants/api-response.constants';
import { AppDataSource } from '../../../config/database.config';
import { logger } from '../../../observability/logger';
import { PG_ERROR } from '../../../shared/constants/app.constants';
import { AppError } from '../../../shared/errors/app-error';
import { auditService } from '../../audit';
import { rowChecksum, validateCandidate } from '../import/row-validator';
import { Student } from '../register/student.entity';
import { REGISTRATION_EXTERNAL_STATUS, STUDENT_SOURCE, STUDENT_STATUS } from '../student.constants';
import type { RegistrationBody } from './registration.validation';

export const REGISTRATION_MESSAGES = {
  CREATED: 'Registration submitted successfully',
  DUPLICATE: 'A registration with this Aadhaar number already exists',
} as const;

export interface RegistrationResult {
  registration_id: string;
  status: string;
}

const isUniqueViolation = (err: unknown) =>
  err instanceof QueryFailedError && (err.driverError as { code?: string }).code === PG_ERROR.UNIQUE_VIOLATION;

const duplicate = () => new AppError(HTTP_STATUS.CONFLICT, REGISTRATION_MESSAGES.DUPLICATE, ERROR_CODES.CONFLICT);

export const registrationService = {
  /*
   * Public registration: the same validation and normalisation as the import (validateCandidate), stored in the
   * students register as REGISTRATION_PENDING. Never approved, never linked to a batch, centre allocation or LMS.
   * Duplicates: same Aadhaar as any student or registration → 409 (an advisory lock plus a unique index stop
   * concurrent submissions); same name + date of birth + mobile → stored, and flagged in the audit log for review.
   */
  async register(req: Request, body: RegistrationBody): Promise<RegistrationResult> {
    const raw: Record<string, string> = Object.fromEntries(
      Object.entries(body).map(([k, v]) => [k, k === 'declaration_accepted' ? 'Yes' : String(v)]),
    );
    const { fields, issues } = validateCandidate(raw);
    /* Unlike a reviewed import, a public registration cannot carry waivable issues: every issue is a rejection. */
    if (issues.length) throw AppError.validation(issues.map((i) => ({ field: `body.${i.field}`, message: i.message })));
    const bidx = fields.aadhaarBidx as string;

    let result: { student: Student; possibleDuplicateOf: string | null };
    try {
      result = await AppDataSource.transaction(async (m) => {
        await m.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [bidx]);
        const repo = m.getRepository(Student);
        if (await repo.exists({ where: { aadhaarBidx: bidx, isDelete: false } })) throw duplicate();

        const similar = await repo
          .createQueryBuilder('s')
          .select(['s.id', 's.code'])
          .where('s.isDelete = false AND s.dateOfBirth = :dob AND s.mobile = :mobile', { dob: fields.dateOfBirth, mobile: fields.mobile })
          .andWhere(`lower(s.firstName || ' ' || s.lastName) = :nameKey`, { nameKey: fields.nameKey })
          .getOne();

        const seq = await m.query(`SELECT nextval('student_registrations_code_seq') AS n`);
        const { nameKey: _nameKey, ...data } = fields;
        const student = await repo.save(
          repo.create({
            ...data,
            code: 'REG-' + String(seq[0].n).padStart(6, '0'),
            sourceRecordId: null,
            /* Checksum over the submitted values with the Aadhaar replaced by its blind index (no plaintext). */
            sourceChecksum: rowChecksum({ ...raw, aadhaar_number: bidx }),
            externalStatus: REGISTRATION_EXTERNAL_STATUS,
            approvedAt: null,
            evidenceRef: null,
            documents: {},
            status: STUDENT_STATUS.REGISTRATION_PENDING,
            source: STUDENT_SOURCE.PUBLIC_REGISTRATION,
            importBatchId: null,
          }),
        );
        return { student, possibleDuplicateOf: similar?.code ?? null };
      });
    } catch (err) {
      /* Lost a race with a concurrent submission of the same Aadhaar. */
      if (isUniqueViolation(err)) throw duplicate();
      throw err;
    }

    const { student, possibleDuplicateOf } = result;
    /* No personal data in the audit log: only the reference and the duplicate flag. */
    await auditService.record(req, {
      action: 'student.registration.create',
      resource: 'student',
      resourceId: student.id,
      actorUserId: null,
      details: { code: student.code, possibleDuplicateOf },
    });
    if (possibleDuplicateOf) logger.info({ code: student.code, possibleDuplicateOf }, 'registration flagged as possible duplicate');
    return { registration_id: student.code, status: student.status };
  },
};
