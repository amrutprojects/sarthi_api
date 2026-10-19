import type { Request } from 'express';
import { QueryFailedError } from 'typeorm';
import { ERROR_CODES, HTTP_STATUS } from '../../../constants/api-response.constants';
import { AppDataSource } from '../../../config/database.config';
import { logger } from '../../../observability/logger';
import { PG_ERROR } from '../../../shared/constants/app.constants';
import { AppError } from '../../../shared/errors/app-error';
import { auditService } from '../../audit';
import { mastersService, type MasterKey, type MasterLookup, type MasterRef } from '../../masters';
import { rowChecksum, validateCandidate } from '../import/row-validator';
import { Student } from '../register/student.entity';
import { documentStorage } from '../documents/document-storage';
import { StudentDocument } from '../documents/student-document.entity';
import { REGISTRATION_EXTERNAL_STATUS, REGISTRATION_MASTER_FIELDS, STUDENT_SOURCE, STUDENT_STATUS } from '../student.constants';
import type { RegistrationBody } from './registration.validation';

export const REGISTRATION_MESSAGES = {
  CREATED: 'Registration submitted successfully',
  DUPLICATE: 'A registration with this Aadhaar number already exists',
} as const;

export interface RegistrationResult {
  registration_id: string;
  status: string;
}

/* A document file already checked (type sniffed from content, size, extension) and ready to store. */
export interface PreparedDocument {
  code: string;
  documentTypeId: string;
  data: Buffer;
  ext: string;
  mimeType: string;
  originalName: string;
  sha256: string;
  barcode: string | null;
}

/* Admin-entered registration: who entered it, and the uploaded documents (stored in the same transaction). */
export interface AdminRegistrationContext {
  actorUserId: string;
  files: PreparedDocument[];
}

const isUniqueViolation = (err: unknown) =>
  err instanceof QueryFailedError && (err.driverError as { code?: string }).code === PG_ERROR.UNIQUE_VIOLATION;

const duplicate = () => new AppError(HTTP_STATUS.CONFLICT, REGISTRATION_MESSAGES.DUPLICATE, ERROR_CODES.CONFLICT);

const MASTER_FIELDS: [field: 'region_id' | 'caste_id' | 'education_id', key: MasterKey, label: string][] = [
  ['region_id', 'region', 'Region'],
  ['caste_id', 'caste', 'Caste'],
  ['education_id', 'education', 'Education'],
];

/* Every referenced master record must exist, be active and not deleted (the lookup holds only those); else a field error. */
function resolveMasters(
  masters: MasterLookup,
  ids: Record<'region_id' | 'caste_id' | 'education_id', string>,
  declared: { document_type_id: string }[],
): Partial<Record<MasterKey, MasterRef>> & { documentTypes: MasterRef[]; errors: { field: string; message: string }[] } {
  const errors: { field: string; message: string }[] = [];
  const found: Partial<Record<MasterKey, MasterRef>> = {};
  for (const [field, key, label] of MASTER_FIELDS) {
    const ref = masters.byId(key, ids[field]);
    if (ref) found[key] = ref;
    else errors.push({ field: `body.${field}`, message: `${label} not found or inactive` });
  }
  const documentTypes: MasterRef[] = [];
  declared.forEach((d, i) => {
    const ref = masters.byId('documentType', d.document_type_id);
    if (!ref) errors.push({ field: `body.documents.${i}.document_type_id`, message: 'Document type not found or inactive' });
    else if (!documentTypes.includes(ref)) documentTypes.push(ref);
  });
  return { ...found, documentTypes, errors };
}

export const registrationService = {
  /*
   * Public registration: the same validation and normalisation as the import (validateCandidate), stored in the
   * students register as REGISTRATION_PENDING. Never approved, never linked to a batch, centre allocation or LMS.
   * Duplicates: same Aadhaar as any student or registration → 409 (an advisory lock plus a unique index stop
   * concurrent submissions); same name + date of birth + mobile → stored, and flagged in the audit log for review.
   */
  async register(
    req: Request,
    body: RegistrationBody,
    admin?: AdminRegistrationContext,
  ): Promise<RegistrationResult & { studentId: string }> {
    const masters = await mastersService.loadLookup();
    const { region_id, caste_id, education_id, documents: declared, ...rest } = body;
    const refs = resolveMasters(masters, { region_id, caste_id, education_id }, declared ?? []);

    /* The master values go through validateCandidate like an import row's text, so both paths store the same thing. */
    const raw: Record<string, string> = {
      ...Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, k === 'declaration_accepted' ? 'Yes' : String(v)])),
      course_centre: refs.region?.code ?? '',
      caste: refs.caste?.name ?? '',
      education_qualification: refs.education?.name ?? '',
    };
    const { fields, issues } = validateCandidate(raw, masters);
    /* Unlike a reviewed import, a public registration cannot carry waivable issues: every issue is a rejection. */
    const errors = [
      ...refs.errors,
      ...issues.filter((i) => !(i.field in REGISTRATION_MASTER_FIELDS)).map((i) => ({ field: `body.${i.field}`, message: i.message })),
    ];
    if (errors.length) throw AppError.validation(errors);
    const bidx = fields.aadhaarBidx as string;
    const documents: Record<string, { supplied: boolean; barcode: string | null; documentTypeId: string }> = Object.fromEntries(
      refs.documentTypes.map((t) => [t.code, { supplied: false, barcode: null, documentTypeId: t.id }]),
    );
    for (const f of admin?.files ?? []) documents[f.code] = { supplied: true, barcode: f.barcode, documentTypeId: f.documentTypeId };

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
            documents,
            status: STUDENT_STATUS.REGISTRATION_PENDING,
            source: STUDENT_SOURCE.PUBLIC_REGISTRATION,
            importBatchId: null,
          }),
        );
        /* Files are written inside the transaction: if one fails, the registration is not created. */
        for (const f of admin?.files ?? []) {
          const storageKey = documentStorage.studentKey(student.code, `${f.code}.${f.ext}`);
          await documentStorage.write(storageKey, f.data);
          await m.getRepository(StudentDocument).insert({
            batchId: null,
            importRowId: null,
            studentId: student.id,
            docType: f.code,
            storageKey,
            sourcePath: null,
            originalName: f.originalName.slice(0, 255),
            mimeType: f.mimeType,
            sizeBytes: f.data.length,
            sha256: f.sha256,
            uploadedById: admin!.actorUserId,
          });
        }
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
      actorUserId: admin?.actorUserId ?? null,
      details: { code: student.code, possibleDuplicateOf, channel: admin ? 'ADMIN' : 'PUBLIC', files: admin?.files.length ?? 0 },
    });
    if (possibleDuplicateOf) logger.info({ code: student.code, possibleDuplicateOf }, 'registration flagged as possible duplicate');
    return { registration_id: student.code, status: student.status, studentId: student.id };
  },
};
