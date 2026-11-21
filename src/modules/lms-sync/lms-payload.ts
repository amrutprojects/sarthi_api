import crypto from 'crypto';

/*
 * Amrut student → LMS `StudentRecord` (POST /tenant/v1/students, schema_version 1; LMS OpenAPI docs/openapi/tenant-v1.json).
 *
 * Privacy rule (M1, LMS contract): the sync never sends the Aadhaar number, caste, religion, disability (status, type,
 * certificate number), the current address, the source's free-text remarks or any document file. Documents travel as
 * true/false flags only (and never the caste-certificate flag). The LMS schema is strict (unknown fields refused), so
 * only the keys in SENT_FIELDS are ever produced, and empty values are left out.
 */

/* The row the worker reads (students joined with the district / taluka masters). Dates are pre-formatted by SQL. */
export interface StudentSyncRow {
  id: string;
  code: string;
  firstName: string;
  lastName: string;
  fatherName: string;
  motherName: string;
  email: string | null;
  dateOfBirth: string | null;
  gender: string | null;
  maritalStatus: string | null;
  permanentAddress: string | null;
  landmark: string | null;
  districtName: string | null;
  talukaName: string | null;
  division: string | null;
  pinCode: string | null;
  mobile: string | null;
  alternateMobile: string | null;
  alternateEmail: string | null;
  centreCode: string | null;
  trackCode: string | null;
  trackSourceValue: string | null;
  educationQualification: string | null;
  qualificationName: string | null;
  qualificationStream: string | null;
  qualificationBoard: string | null;
  qualificationCompletedOn: string | null;
  score: string | null;
  gradingType: string | null;
  qualificationClass: string | null;
  externalStatus: string | null;
  approvedAt: Date | string | null;
  schemeName: string | null;
  sourceSubmittedAt: Date | string | null;
  evidenceRef: string | null;
  declarationAccepted: boolean | null;
  documents: Record<string, { supplied?: boolean } | undefined> | null;
}

/* Every key the sync may put in a record (a subset of the LMS StudentRecord schema). */
export const SENT_FIELDS = [
  'external_student_id',
  'source_record_id',
  'source_updated_at',
  'first_name',
  'last_name',
  'father_name',
  'mother_name',
  'email',
  'date_of_birth',
  'gender',
  'marital_status',
  'permanent_address',
  'landmark',
  'district',
  'taluka',
  'division',
  'pin_code',
  'mobile_number',
  'alternate_mobile_number',
  'alternate_email',
  'course_centre',
  'technology',
  'education_qualification',
  'qualification_name',
  'qualification_stream',
  'qualification_board',
  'qualification_completed_on',
  'score',
  'score_type',
  'qualification_class',
  'approval_status',
  'approved_at',
  'scheme_name',
  'submitted_at',
  'evidence_ref',
  'declaration_accepted',
  'documents_supplied',
] as const;

/* Fields of the LMS schema the sync must never send (restricted personal data, free text, files). */
export const RESTRICTED_FIELDS = [
  'aadhaar_number',
  'religion',
  'caste',
  'disability_status',
  'disability_type',
  'disability_certificate_number',
  'current_address',
  'source_remarks',
] as const;

/* Required by the LMS in every record besides external_student_id and source_updated_at. */
export const LMS_REQUIRED_FIELDS = [
  'first_name',
  'last_name',
  'father_name',
  'mother_name',
  'email',
  'date_of_birth',
  'gender',
  'permanent_address',
  'landmark',
  'district',
  'taluka',
  'division',
  'pin_code',
  'mobile_number',
] as const;

/* Document flags the sync sends (Amrut document key → LMS flag). The caste certificate flag is never sent. */
const DOCUMENT_FLAGS: Record<string, string> = {
  PHOTO: 'doc_photo',
  SIGNATURE: 'doc_signature',
  INCOME_EWS: 'doc_income_ews',
  DOMICILE: 'doc_domicile',
  AADHAAR_CARD: 'doc_aadhaar_card',
  PAN_CARD: 'doc_pan_card',
  SCHOOL_LEAVING: 'doc_school_leaving',
  NAME_CHANGE: 'doc_name_change',
  EDU_CERT: 'doc_edu_cert',
  OTHER: 'doc_other',
  FITNESS: 'doc_fitness',
  SELF_DECLARATION: 'doc_self_declaration',
};

export type LmsStudentRecord = Partial<Record<(typeof SENT_FIELDS)[number], string | boolean | Record<string, boolean>>> & {
  external_student_id: string;
};

const text = (v: string | null | undefined): string | undefined => {
  if (v === null || v === undefined) return undefined;
  const t = String(v).trim();
  return t ? t : undefined;
};
const iso = (v: Date | string | null | undefined): string | undefined => {
  if (v === null || v === undefined || v === '') return undefined;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
};

/*
 * The record without source_updated_at (added at send time; it is not part of the checksum, so a students row
 * touched without a data change is not sent again).
 */
export function buildLmsRecord(s: StudentSyncRow): LmsStudentRecord {
  const documents: Record<string, boolean> = {};
  for (const [key, flag] of Object.entries(DOCUMENT_FLAGS)) {
    const d = s.documents?.[key];
    if (d && typeof d.supplied === 'boolean') documents[flag] = d.supplied;
  }
  const candidate: Record<string, string | boolean | Record<string, boolean> | undefined> = {
    external_student_id: s.id,
    source_record_id: text(s.code),
    first_name: text(s.firstName),
    last_name: text(s.lastName),
    father_name: text(s.fatherName),
    mother_name: text(s.motherName),
    email: text(s.email),
    date_of_birth: text(s.dateOfBirth),
    gender: text(s.gender),
    marital_status: text(s.maritalStatus),
    permanent_address: text(s.permanentAddress),
    landmark: text(s.landmark),
    district: text(s.districtName),
    taluka: text(s.talukaName),
    division: text(s.division),
    pin_code: text(s.pinCode),
    mobile_number: text(s.mobile),
    alternate_mobile_number: text(s.alternateMobile),
    alternate_email: text(s.alternateEmail),
    course_centre: text(s.centreCode),
    technology: text(s.trackCode) ?? text(s.trackSourceValue),
    education_qualification: text(s.educationQualification),
    qualification_name: text(s.qualificationName),
    qualification_stream: text(s.qualificationStream),
    qualification_board: text(s.qualificationBoard),
    qualification_completed_on: text(s.qualificationCompletedOn),
    score: text(s.score),
    score_type: text(s.gradingType),
    qualification_class: text(s.qualificationClass),
    approval_status: text(s.externalStatus),
    approved_at: iso(s.approvedAt),
    scheme_name: text(s.schemeName),
    submitted_at: iso(s.sourceSubmittedAt),
    evidence_ref: text(s.evidenceRef),
    declaration_accepted: typeof s.declarationAccepted === 'boolean' ? s.declarationAccepted : undefined,
    documents_supplied: Object.keys(documents).length ? documents : undefined,
  };
  const record: Record<string, string | boolean | Record<string, boolean>> = {};
  /* Whitelist: only SENT_FIELDS, in a fixed order, never anything else. */
  for (const key of SENT_FIELDS) {
    const v = candidate[key];
    if (v !== undefined) record[key] = v;
  }
  return record as LmsStudentRecord;
}

/* Required LMS fields that are empty for this student (the record is not sent until they are filled in Amrut). */
export const missingRequiredFields = (record: LmsStudentRecord): string[] => LMS_REQUIRED_FIELDS.filter((f) => record[f] === undefined);

/* Canonical JSON (keys sorted at every depth) so the checksum does not depend on key order. */
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .filter((k) => obj[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`)
    .join(',')}}`;
}

/* SHA-256 (hex) of the record without source_updated_at. */
export function recordChecksum(record: LmsStudentRecord): string {
  const { source_updated_at: _ignored, ...rest } = record;
  void _ignored;
  return crypto.createHash('sha256').update(canonical(rest)).digest('hex');
}

/* Idempotency-Key of one send: derived from the body, so a re-send of the same body replays the LMS's first answer. */
export const idempotencyKeyFor = (body: unknown): string =>
  `amrut-sync-${crypto.createHash('sha256').update(canonical(body)).digest('hex').slice(0, 48)}`;
