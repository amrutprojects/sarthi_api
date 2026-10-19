import { AppDataSource } from '../../config/database.config';
import { CENTRES, DOCUMENTS, IMPORT_COLUMNS, TRACKS } from '../../constants/student.constants';
import { Student } from '../../entities/student.entity';
import { AppError } from '../../utils/app-error';
import { maskAadhaar, maskEmail, maskMobile, withVerhoeffDigit } from '../../utils/student-crypto';

const trackName = (code: string | null) => TRACKS.find((t) => t.code === code)?.name ?? null;
const centreName = (code: string | null) => CENTRES.find((c) => c.code === code)?.name ?? null;

/* Register view of a student: protected values are generated masked on the server and never sent in clear. */
export function publicStudent(s: Student, detail = false) {
  const base = {
    id: s.id, code: s.code, sourceRecordId: s.sourceRecordId, name: `${s.firstName} ${s.lastName}`,
    centreCode: s.centreCode, centreName: centreName(s.centreCode),
    trackCode: s.trackCode, trackName: trackName(s.trackCode), trackToBeConfirmed: !s.trackCode,
    status: s.status, mobile: maskMobile(s.mobile), email: maskEmail(s.email), aadhaar: maskAadhaar(s.aadhaarLast4),
    approvedAt: s.approvedAt, importBatchId: s.importBatchId, createdAt: s.createdAt,
  };
  if (!detail) return base;
  return {
    ...base,
    firstName: s.firstName, lastName: s.lastName, fatherName: s.fatherName, motherName: s.motherName,
    dateOfBirth: s.dateOfBirth, religion: s.religion, caste: s.caste, educationQualification: s.educationQualification,
    trackSourceValue: s.trackSourceValue, externalStatus: s.externalStatus, evidenceRef: s.evidenceRef,
    declarationAccepted: s.declarationAccepted,
    documents: DOCUMENTS.map((d) => ({ key: d.key, label: d.label, required: d.required, ...(s.documents[d.key] ?? { supplied: false, barcode: null }) })),
  };
}

export class StudentService {
  private repo() { return AppDataSource.getRepository(Student); }

  async list(q: { page: number; limit: number; search?: string; centre?: string; track?: string; batch?: string }) {
    const qb = this.repo().createQueryBuilder('s').where('s.isDelete = false');
    if (q.centre) qb.andWhere('s.centreCode = :centre', { centre: q.centre });
    if (q.track === 'TBC') qb.andWhere('s.trackCode IS NULL');
    else if (q.track) qb.andWhere('s.trackCode = :track', { track: q.track });
    if (q.batch) qb.andWhere('s.importBatchId = :batch', { batch: q.batch });
    if (q.search) {
      const t = q.search.trim();
      const s = `%${t.replace(/[%_\\]/g, '\\$&')}%`;
      /* Mobile is searchable by its last four digits only. */
      qb.andWhere(`(s.code ILIKE :s OR s.sourceRecordId ILIKE :s OR (s.firstName || ' ' || s.lastName) ILIKE :s OR s.email ILIKE :s ${/^\d{4}$/.test(t) ? 'OR right(s.mobile, 4) = :last4' : ''})`, { s, last4: t });
    }
    const [items, total] = await qb.orderBy('s.createdAt', 'DESC').addOrderBy('s.code', 'DESC').skip((q.page - 1) * q.limit).take(q.limit).getManyAndCount();
    return { items: items.map((s) => publicStudent(s)), total };
  }

  async get(id: string) {
    const s = await this.repo().findOne({ where: { id, isDelete: false } });
    if (!s) throw AppError.notFound('Student not found');
    return publicStudent(s, true);
  }

  /* CSV template: header row with the internal column names and two entirely synthetic example rows. */
  template(): string {
    const header = IMPORT_COLUMNS.map((c) => c.field);
    const example = (n: number, first: string, last: string, track: string, centre: string): string[] => {
      const v: Record<string, string> = {
        source_record_id: `MA-SYN-${String(n).padStart(6, '0')}`, first_name: first, last_name: last,
        father_name: `Ramesh ${last}`, mother_name: `Sunita ${last}`, email: `${first.toLowerCase()}.${last.toLowerCase()}@example.invalid`,
        date_of_birth: '2003-04-12', current_address: 'Flat 0, Test Lane, Sample Nagar',
        aadhaar_number: withVerhoeffDigit(`23456789${String(100 + n).padStart(3, '0')}`), mobile_number: `90000000${String(n).padStart(2, '0')}`,
        religion: 'हिंदू', caste: 'मराठी', course_centre: centre, technology: track, education_qualification: 'Graduate',
        approval_status: 'APPROVED', approved_at: '2026-01-10T06:30:00Z', evidence_ref: `MA-APR-${n}`, declaration_accepted: 'Yes',
      };
      for (const d of DOCUMENTS) {
        v[`doc_${d.key.toLowerCase()}`] = d.required ? 'Yes' : 'No';
        if (d.barcode) v[`doc_${d.key.toLowerCase()}_barcode`] = d.barcode === 'required' ? `BC-${d.key}-${n}` : '';
      }
      return header.map((h) => v[h] ?? '');
    };
    const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
    const lines = [header, example(1, 'Asha', 'Synthetic', 'Cyber Security', 'PUN'), example(2, 'Vikram', 'Example', 'AI-ML Engineer', 'Nashik')];
    return String.fromCharCode(0xfeff) + lines.map((l) => l.map(esc).join(',')).join('\r\n') + '\r\n';
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
