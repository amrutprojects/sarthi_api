import type { MasterLookup } from '../../masters';
import type { GeographyLookup } from '../import/geography';
import { validateRow, type ImportRowValues, type RowIssue } from '../import/row-validator';

/*
 * The LMS's student body (contract amrut-student-api.md §3, Part 1 names) → Amrut's normalised student values.
 *
 * Normalisation is the import's own: validateRow is called as it is, on a row built from the LMS fields, so names,
 * email, mobile (+91…), date of birth, Aadhaar (encrypted + blind index), gender spellings, PIN code, district and
 * taluka (geography masters), course centre and track come out exactly as an imported row would.
 *
 * What differs is which fields are required (N-7): an LMS student has the LMS mandatory set (Part 2), not the
 * import's — no Aadhaar, religion, caste, current address, course centre, technology, education, source record ID,
 * approval evidence or documents are required. A value that is sent must still be valid.
 */

/* Amrut's mandatory set for a student created from the LMS (the simulator's REQUIRED list, contract §3). */
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

/* Optional fields the LMS may send (the LMS's AMRUT_OPTIONAL_FIELDS, plus source_record_id). */
export const LMS_OPTIONAL_FIELDS = [
  'source_record_id',
  'aadhaar_number',
  'marital_status',
  'alternate_mobile_number',
  'alternate_email',
  'course_centre',
  'technology',
  'scheme_name',
  'education_qualification',
  'qualification_name',
  'qualification_stream',
  'qualification_board',
  'qualification_completed_on',
  'score',
  'score_type',
  'qualification_class',
] as const;

/* Fields the LMS may correct with PATCH (§4): the person's own details; never the Aadhaar number or the source ID. */
export const LMS_PATCHABLE_FIELDS = [
  'first_name',
  'last_name',
  'father_name',
  'mother_name',
  'email',
  'date_of_birth',
  'mobile_number',
  'gender',
  'marital_status',
  'permanent_address',
  'landmark',
  'district',
  'taluka',
  'division',
  'pin_code',
  'alternate_mobile_number',
  'alternate_email',
] as const;

/* A `{field, code}` pair of a 400 answer (contract §3: codes only, never a value). */
export interface FieldError {
  field: string;
  code: string;
}

/*
 * Issues of validateRow that do not apply to an LMS student: the import's requirements outside the LMS set, and
 * "kept as supplied" notices (REF_UNKNOWN on gender / marital status / course centre / track / education: the value
 * is stored as the import would store it after acceptance).
 */
const IMPORT_ONLY_FIELDS = new Set([
  'source_record_id',
  'approval_status',
  'approved_at',
  'religion',
  'caste',
  'current_address',
  'course_centre',
  'technology',
  'education_qualification',
]);
const relevant = (i: RowIssue, sent: Set<string>): boolean => {
  if (i.field.startsWith('doc_')) return false;
  if (i.code === 'REF_UNKNOWN' || i.code === 'NOT_APPROVED' || i.code === 'TRACK_NOT_OFFERED') return false;
  if (i.field === 'source_record_id') return i.code === 'TEXT_TOO_LONG' && sent.has('source_record_id');
  if (IMPORT_ONLY_FIELDS.has(i.field)) return false;
  if (i.code === 'REQUIRED') return (LMS_REQUIRED_FIELDS as readonly string[]).includes(i.field);
  return true;
};

const str = (v: unknown): string =>
  v === null || v === undefined ? '' : typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';

/* Fields sent with a value of a type that cannot be a student field (objects, arrays, booleans). */
export function typeErrors(body: Record<string, unknown>, fields: readonly string[]): FieldError[] {
  return fields
    .filter((f) => body[f] !== undefined && body[f] !== null && typeof body[f] !== 'string' && typeof body[f] !== 'number')
    .map((field) => ({ field, code: 'invalid_type' }));
}

export interface NormalisedLmsStudent {
  row: ImportRowValues;
  /* The row as validateRow read it (for the student's source checksum). */
  raw: Record<string, string>;
  errors: FieldError[];
}

/* Builds the import-shaped row from LMS fields and runs the import's validation on it. */
export function normaliseLmsStudent(
  body: Record<string, unknown>,
  masters: MasterLookup,
  geography: GeographyLookup,
  opts: { requireAll?: boolean; only?: readonly string[] } = {},
): NormalisedLmsStudent {
  const fields = [...LMS_REQUIRED_FIELDS, ...LMS_OPTIONAL_FIELDS];
  const raw: Record<string, string> = {};
  for (const f of fields) raw[f] = str(body[f]).trim();
  /* score_type is the LMS's own label of the score; the import reads the grading from the score itself. */
  delete raw.score_type;
  const { row, issues } = validateRow(raw, masters, { geography });
  const sent = new Set(fields.filter((f) => str(body[f]).trim() !== ''));
  const errors: FieldError[] = [];
  const seen = new Set<string>();
  const push = (field: string, code: string) => {
    if (seen.has(field)) return;
    seen.add(field);
    errors.push({ field, code });
  };
  for (const i of issues) {
    if (opts.only && !opts.only.includes(i.field)) continue;
    if (relevant(i, sent)) push(i.field, i.code.toLowerCase());
  }
  /* Required by the LMS set although optional in the import (gender, address, district, taluka, division, PIN…). */
  if (opts.requireAll !== false) {
    for (const f of LMS_REQUIRED_FIELDS) if (!sent.has(f) && (!opts.only || opts.only.includes(f))) push(f, 'required');
  }
  return { row, raw, errors };
}

/* The student columns of the profile part of a normalised row (as the import's profileColumns, without source dates). */
export function profileOf(d: ImportRowValues) {
  return {
    gender: d.gender ?? null,
    maritalStatus: d.maritalStatus ?? null,
    permanentAddress: d.permanentAddress ?? null,
    landmark: d.landmark ?? null,
    districtId: d.districtId ?? null,
    talukaId: d.talukaId ?? null,
    districtName: d.districtName ?? null,
    talukaName: d.talukaName ?? null,
    division: d.division ?? null,
    pinCode: d.pinCode ?? null,
    alternateMobile: d.alternateMobile ?? null,
    alternateEmail: d.alternateEmail ?? null,
    qualificationName: d.qualificationName ?? null,
    qualificationStream: d.qualificationStream ?? null,
    qualificationBoard: d.qualificationBoard ?? null,
    qualificationCompletedOn: d.qualificationCompletedOn ?? null,
    gradingType: d.gradingType ?? null,
    cgpaScale: d.cgpaScale ?? null,
    score: d.score ?? null,
    qualificationClass: d.qualificationClass ?? null,
    schemeName: d.schemeName ?? null,
  };
}
