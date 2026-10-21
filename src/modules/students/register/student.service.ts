import { AppDataSource } from '../../../config/database.config';
import { MESSAGES } from '../../../constants/api-response.constants';
import { CENTRES, DOCUMENTS, IMPORT_COLUMNS, TRACKS } from '../student.constants';
import { Student } from './student.entity';
import { AppError } from '../../../shared/errors/app-error';
import { maskAadhaar, maskEmail, maskMobile } from '../aadhaar';
import { templateCsv } from './import-template';

const trackName = (code: string | null) => TRACKS.find((t) => t.code === code)?.name ?? null;
const centreName = (code: string | null) => CENTRES.find((c) => c.code === code)?.name ?? null;

/* Register view of a student: protected values are generated masked on the server and never sent in clear. */
export function publicStudent(s: Student, detail = false) {
  const base = {
    id: s.id,
    code: s.code,
    sourceRecordId: s.sourceRecordId,
    name: `${s.firstName} ${s.lastName}`,
    centreCode: s.centreCode,
    centreName: centreName(s.centreCode),
    trackCode: s.trackCode,
    trackName: trackName(s.trackCode),
    trackToBeConfirmed: !s.trackCode,
    status: s.status,
    mobile: maskMobile(s.mobile),
    email: maskEmail(s.email),
    aadhaar: maskAadhaar(s.aadhaarLast4),
    approvedAt: s.approvedAt,
    importBatchId: s.importBatchId,
    /* IMPORT or PUBLIC_REGISTRATION (one students table), and the registration number of registrations. */
    source: s.source,
    registrationNumber: s.registrationNumber,
    createdAt: s.createdAt,
  };
  if (!detail) return base;
  return {
    ...base,
    firstName: s.firstName,
    lastName: s.lastName,
    fatherName: s.fatherName,
    motherName: s.motherName,
    dateOfBirth: s.dateOfBirth,
    religion: s.religion,
    caste: s.caste,
    educationQualification: s.educationQualification,
    trackSourceValue: s.trackSourceValue,
    externalStatus: s.externalStatus,
    evidenceRef: s.evidenceRef,
    declarationAccepted: s.declarationAccepted,
    documents: DOCUMENTS.map((d) => ({
      key: d.key,
      label: d.label,
      required: d.required,
      ...(s.documents[d.key] ?? { supplied: false, barcode: null }),
    })),
  };
}

export class StudentService {
  private repo() {
    return AppDataSource.getRepository(Student);
  }

  async list(q: { page: number; limit: number; search?: string; centre?: string; track?: string; batch?: string; source?: string }) {
    const qb = this.repo().createQueryBuilder('s').where('s.isDelete = false');
    if (q.centre) qb.andWhere('s.centreCode = :centre', { centre: q.centre });
    if (q.track === 'TBC') qb.andWhere('s.trackCode IS NULL');
    else if (q.track) qb.andWhere('s.trackCode = :track', { track: q.track });
    if (q.batch) qb.andWhere('s.importBatchId = :batch', { batch: q.batch });
    if (q.source) qb.andWhere('s.source = :source', { source: q.source });
    if (q.search) {
      const t = q.search.trim();
      const s = `%${t.replace(/[%_\\]/g, '\\$&')}%`;
      /* Mobile is searchable by its last four digits only. */
      qb.andWhere(
        `(s.code ILIKE :s OR s.registrationNumber LIKE :s OR s.sourceRecordId ILIKE :s OR (s.firstName || ' ' || s.lastName) ILIKE :s OR s.email ILIKE :s ${/^\d{4}$/.test(t) ? 'OR right(s.mobile, 4) = :last4' : ''})`,
        { s, last4: t },
      );
    }
    const [items, total] = await qb
      .orderBy('s.createdAt', 'DESC')
      .addOrderBy('s.code', 'DESC')
      .skip((q.page - 1) * q.limit)
      .take(q.limit)
      .getManyAndCount();
    return { items: items.map((s) => publicStudent(s)), total };
  }

  async get(id: string) {
    const s = await this.repo().findOne({ where: { id, isDelete: false } });
    if (!s) throw AppError.notFound(MESSAGES.notFound('Student'));
    return publicStudent(s, true);
  }

  /* Templates: see import-template.ts (CSV, Excel with instructions, matching sample documents ZIP). */
  template(): string {
    return templateCsv();
  }

  reference() {
    return {
      columns: IMPORT_COLUMNS.map((c) => ({ field: c.field, label: c.label, required: c.required })),
      tracks: TRACKS.map(({ code, name, aliases }) => ({ code, name, aliases })),
      centres: CENTRES,
    };
  }
}

export const studentService = new StudentService();
