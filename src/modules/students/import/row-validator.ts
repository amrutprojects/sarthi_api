import crypto from 'crypto';
import { APPROVED_STATUS, DOCUMENTS, RELIGIONS, TRACKS, TRACKS_NOT_OFFERED, type IssueCode } from '../student.constants';
import type { MasterLookup } from '../../masters';
import { aadhaarBlindIndex, encryptAadhaar, verhoeffValid } from '../aadhaar';

export interface RowIssue {
  field: string;
  code: IssueCode;
  message: string;
}

/* Normalised, protected values of one row, ready to be written as a student. Never contains the Aadhaar plaintext. */
export interface NormalisedRow {
  sourceRecordId: string | null;
  firstName: string;
  lastName: string;
  fatherName: string;
  motherName: string;
  email: string | null;
  dateOfBirth: string | null;
  currentAddress: string;
  aadhaarEnc: Buffer | null;
  aadhaarBidx: string | null;
  aadhaarLast4: string | null;
  mobile: string | null;
  religion: string;
  caste: string;
  centreCode: string | null;
  /* Master record ids (null when the value did not match an active record). */
  regionId: string | null;
  casteId: string | null;
  educationId: string | null;
  trackCode: string | null;
  trackSourceValue: string;
  educationQualification: string;
  approvalStatus: string;
  approvedAt: string | null;
  evidenceRef: string | null;
  declarationAccepted: boolean | null;
  /* path: where the Excel says the file is inside the documents ZIP (normalised); supplied turns true when it is stored. */
  documents: Record<string, { supplied: boolean; barcode: string | null; path?: string; documentTypeId?: string }>;
  /* For matching only (Tier 2): lower-case, single-spaced full name. */
  nameKey: string;
}

const collapse = (v: string) => v.replace(/\s+/g, ' ').trim();
const nfc = (v: string) => v.normalize('NFC').trim();
const yes = (v: string) => /^(y|yes|true|1|uploaded|available|supplied)$/i.test(v.trim());
const no = (v: string) => /^(|n|no|false|0|na|n\/a|not supplied|not available)$/i.test(v.trim());

/*
 * A document column may hold the file's path inside the documents ZIP (e.g. "MA-0001/photo.jpg" or
 * "scans\kavya\aadhaar.pdf"). Normalised to forward slashes without a leading "./" or "/"; matched
 * case-insensitively. Returns null for "Yes"/"No" style values and for unsafe paths ("..").
 */
export function zipPathFromCell(v: string): string | null {
  const t = v.trim();
  if (!t || yes(t) || no(t)) return null;
  const BACKSLASH = String.fromCharCode(92);
  if (!t.includes('/') && !t.includes(BACKSLASH) && !/\.[A-Za-z0-9]{2,5}$/.test(t)) return null;
  const p = t
    .split(BACKSLASH)
    .join('/')
    .replace(/^(\.\/)+/, '')
    .replace(/^\/+/, '')
    .replace(/\/{2,}/g, '/');
  if (!p || p.split('/').includes('..') || p.length > 300) return null;
  return p;
}
export const zipPathKey = (p: string) => p.toLowerCase();
const NAME_RE = /^[\p{L}\p{M}][\p{L}\p{M} .'-]*$/u;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const keyify = (v: string) => v.toLowerCase().replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const TRACK_BY_ALIAS = new Map<string, string>();
for (const t of TRACKS) {
  TRACK_BY_ALIAS.set(keyify(t.code), t.code);
  for (const a of [t.name, ...t.aliases]) TRACK_BY_ALIAS.set(keyify(a), t.code);
}
const NOT_OFFERED = new Set(TRACKS_NOT_OFFERED.map(keyify));

/* ISO YYYY-MM-DD only: other formats are ambiguous (DD/MM vs MM/DD) and are never guessed. Excel dates arrive as ISO. */
function parseDob(v: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v.trim());
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) return null;
  if (d.getTime() > Date.now()) return null;
  return m[0];
}

/* Stable checksum of the source row, to skip an unchanged re-import (SKIPPED_UNCHANGED). */
export function rowChecksum(raw: Record<string, string>): string {
  const keys = Object.keys(raw).sort();
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(keys.map((k) => [k, raw[k] ?? ''])))
    .digest('hex');
}

/* Personal details of one candidate (shared by the bulk import and the public registration API). */
export type CandidateFields = Pick<
  NormalisedRow,
  | 'firstName'
  | 'lastName'
  | 'fatherName'
  | 'motherName'
  | 'email'
  | 'dateOfBirth'
  | 'currentAddress'
  | 'aadhaarEnc'
  | 'aadhaarBidx'
  | 'aadhaarLast4'
  | 'mobile'
  | 'religion'
  | 'caste'
  | 'centreCode'
  | 'regionId'
  | 'casteId'
  | 'educationId'
  | 'trackCode'
  | 'trackSourceValue'
  | 'educationQualification'
  | 'declarationAccepted'
  | 'nameKey'
>;

/*
 * Validates and normalises the candidate's personal details (Table 81): names, contact, date of birth, Aadhaar,
 * reference values, track, qualification and declaration. The single source of these rules for every entry point.
 * Region (course centre), caste and education are matched against the active masters in `masters`, by code or name,
 * case-insensitively; the caller loads the lookup once (per batch or request), since this function is synchronous.
 */
export function validateCandidate(raw: Record<string, string>, masters: MasterLookup): { fields: CandidateFields; issues: RowIssue[] } {
  const issues: RowIssue[] = [];
  const get = (f: string) => (raw[f] ?? '').toString();
  const add = (field: string, code: IssueCode, message: string) => issues.push({ field, code, message });

  const text = (field: string, label: string, max: number, opts: { name?: boolean; collapseSpaces?: boolean } = {}) => {
    let v = opts.collapseSpaces === false ? get(field).trim() : collapse(get(field));
    if (!v) {
      add(field, 'REQUIRED', `${label} is required`);
      return '';
    }
    if (v.length > max) {
      add(field, 'TEXT_TOO_LONG', `${label} is longer than ${max} characters`);
      v = v.slice(0, max);
    }
    if (opts.name && !NAME_RE.test(v)) add(field, 'NAME_INVALID', `${label} may contain only letters, spaces and . ' -`);
    return v;
  };

  const firstName = text('first_name', 'First name', 100, { name: true });
  const lastName = text('last_name', 'Last name', 100, { name: true });
  const fatherName = text('father_name', 'Father name', 150);
  const motherName = text('mother_name', 'Mother name', 150);
  const currentAddress = text('current_address', 'Current address', 500, { collapseSpaces: false });

  let email: string | null = get('email').trim().toLowerCase() || null;
  if (!email) add('email', 'REQUIRED', 'Email is required');
  else if (email.length > 254 || !EMAIL_RE.test(email)) {
    add('email', 'EMAIL_INVALID', 'Email address is not valid');
    email = null;
  }

  const dobRaw = get('date_of_birth').trim();
  const dateOfBirth = dobRaw ? parseDob(dobRaw) : null;
  if (!dobRaw) add('date_of_birth', 'REQUIRED', 'Date of birth is required');
  else if (!dateOfBirth) add('date_of_birth', 'DOB_INVALID', 'Date of birth must be a real past date in YYYY-MM-DD format');

  /* Aadhaar: strip separators, 12 digits, Verhoeff; encrypt + blind index + last 4. The issue message never contains the value. */
  const aadhaarDigits = get('aadhaar_number').replace(/[\s-]/g, '');
  let aadhaarEnc: Buffer | null = null;
  let aadhaarBidx: string | null = null;
  let aadhaarLast4: string | null = null;
  if (!aadhaarDigits) add('aadhaar_number', 'REQUIRED', 'Aadhaar number is required');
  else if (!/^\d{12}$/.test(aadhaarDigits) || /^[01]/.test(aadhaarDigits) || !verhoeffValid(aadhaarDigits)) {
    add('aadhaar_number', 'AADHAAR_INVALID', 'Aadhaar number must be 12 digits with a valid checksum');
  } else {
    aadhaarEnc = encryptAadhaar(aadhaarDigits);
    aadhaarBidx = aadhaarBlindIndex(aadhaarDigits);
    aadhaarLast4 = aadhaarDigits.slice(-4);
  }

  /* Mobile: remove spaces, +91, 91 or a leading 0 → +91XXXXXXXXXX, starting 6–9. */
  let mobileDigits = get('mobile_number').replace(/[\s()-]/g, '');
  mobileDigits = mobileDigits.replace(/^\+?91(?=\d{10}$)/, '').replace(/^0(?=\d{10}$)/, '');
  let mobile: string | null = null;
  if (!mobileDigits) add('mobile_number', 'REQUIRED', 'Mobile number is required');
  else if (!/^[6-9]\d{9}$/.test(mobileDigits))
    add('mobile_number', 'MOBILE_INVALID', 'Mobile number must be a 10-digit Indian number starting 6–9');
  else mobile = '+91' + mobileDigits;

  const religion = nfc(get('religion'));
  if (!religion) add('religion', 'REQUIRED', 'Religion is required');
  else if (!RELIGIONS.includes(religion)) add('religion', 'REF_UNKNOWN', 'Religion is not in the reference list');

  const casteRaw = nfc(get('caste'));
  const casteRef = masters.find('caste', casteRaw);
  if (!casteRaw) add('caste', 'REQUIRED', 'Caste is required');
  else if (!casteRef) add('caste', 'REF_UNKNOWN', 'Caste is not an active caste in the master');
  const caste = casteRef?.name ?? casteRaw;

  const centreRaw = collapse(get('course_centre'));
  const region = centreRaw ? masters.find('region', centreRaw) : null;
  const centreCode = region?.code ?? null;
  if (!centreRaw) add('course_centre', 'REQUIRED', 'Course centre is required');
  else if (!region) add('course_centre', 'REF_UNKNOWN', 'Course centre does not match an active region code or name');

  const trackSourceValue = collapse(get('technology'));
  const trackCode = trackSourceValue ? (TRACK_BY_ALIAS.get(keyify(trackSourceValue)) ?? null) : null;
  if (!trackSourceValue) add('technology', 'REQUIRED', 'Technology / third module selection is required');
  else if (!trackCode) {
    if (NOT_OFFERED.has(keyify(trackSourceValue)))
      add('technology', 'TRACK_NOT_OFFERED', `"${trackSourceValue}" is not an approved Module 3 track`);
    else add('technology', 'REF_UNKNOWN', 'Technology option does not match an approved track');
  }

  const educationRaw = text('education_qualification', 'Education qualification', 150);
  const education = educationRaw ? masters.find('education', educationRaw) : null;
  if (educationRaw && !education)
    add('education_qualification', 'REF_UNKNOWN', 'Education qualification is not an active education in the master');
  const educationQualification = education?.name ?? educationRaw;

  const declRaw = get('declaration_accepted').trim();
  const declarationAccepted = declRaw ? yes(declRaw) : null;

  return {
    issues,
    fields: {
      firstName,
      lastName,
      fatherName,
      motherName,
      email,
      dateOfBirth,
      currentAddress,
      aadhaarEnc,
      aadhaarBidx,
      aadhaarLast4,
      mobile,
      religion,
      caste,
      centreCode,
      regionId: region?.id ?? null,
      casteId: casteRef?.id ?? null,
      educationId: education?.id ?? null,
      trackCode,
      trackSourceValue,
      educationQualification,
      declarationAccepted,
      nameKey: `${firstName} ${lastName}`.toLowerCase().replace(/\s+/g, ' ').trim(),
    },
  };
}

/*
 * Applies the validation and normalisation rules of Table 81 to one source row. Document columns are checked for the
 * active document types in the master that have an import column (doc_<code>); "required" is the type's isMandatory.
 */
export function validateRow(raw: Record<string, string>, masters: MasterLookup): { row: NormalisedRow; issues: RowIssue[] } {
  const issues: RowIssue[] = [];
  const get = (f: string) => (raw[f] ?? '').toString();
  const add = (field: string, code: IssueCode, message: string) => issues.push({ field, code, message });

  const sourceRecordId = collapse(get('source_record_id')) || null;
  if (!sourceRecordId) add('source_record_id', 'SRC_ID_MISSING', 'Source record ID is required');
  else if (sourceRecordId.length > 64) add('source_record_id', 'TEXT_TOO_LONG', 'Source record ID is longer than 64 characters');

  const candidate = validateCandidate(raw, masters);
  issues.push(...candidate.issues);

  /* Approval evidence: required and must be the source's approved value; approved_at not in the future. */
  const approvalStatus = collapse(get('approval_status')).toUpperCase();
  const approvedRaw = get('approved_at').trim();
  const approvedDate = approvedRaw ? new Date(approvedRaw) : null;
  const approvedAt =
    approvedDate && !Number.isNaN(approvedDate.getTime()) && approvedDate.getTime() <= Date.now() + 60_000
      ? approvedDate.toISOString()
      : null;
  if (approvalStatus !== APPROVED_STATUS) add('approval_status', 'EVIDENCE_MISSING', `Approval status must be ${APPROVED_STATUS}`);
  if (!approvedAt) add('approved_at', 'EVIDENCE_MISSING', 'Approval date is missing, invalid or in the future');
  const evidenceRef = collapse(get('evidence_ref')).slice(0, 120) || null;

  const documents: NormalisedRow['documents'] = {};
  for (const d of DOCUMENTS) {
    const type = masters.find('documentType', d.key);
    if (!type || type.code !== d.key) continue;
    const required = !!type.isMandatory;
    const k = d.key.toLowerCase();
    const cell = get(`doc_${k}`);
    /*
     * Only the student's own folder is accepted: the cell holds a file name ("photo.jpg", looked up in
     * <source_record_id>/) or "<source_record_id>/photo.jpg". A path into any other folder is an issue.
     */
    const raw = zipPathFromCell(cell);
    let path: string | null = null;
    if (raw && sourceRecordId) {
      const segs = raw.split('/');
      if (segs.length === 1) path = `${sourceRecordId}/${segs[0]}`;
      else if (segs.length === 2 && segs[0].toLowerCase() === sourceRecordId.toLowerCase()) path = `${sourceRecordId}/${segs[1]}`;
      else
        add(
          `doc_${k}`,
          'DOC_INVALID',
          `${d.label}: "${raw}" must be a file in the student's folder ${sourceRecordId}/ (e.g. ${sourceRecordId}/${segs[segs.length - 1]})`,
        );
    }
    const supplied = !raw && yes(cell);
    const barcode = d.barcode ? collapse(get(`doc_${k}_barcode`)).slice(0, 64) || null : null;
    documents[d.key] = path
      ? { supplied: false, barcode, path, documentTypeId: type.id }
      : { supplied, barcode, documentTypeId: type.id };
    /* A path means the file is expected in the documents ZIP; the issue clears when that file is stored. */
    if (path) add(`doc_${k}`, 'DOC_MISSING', `${d.label}: waiting for "${path}" in the documents ZIP`);
    else if (required && !supplied && !raw) add(`doc_${k}`, 'DOC_MISSING', `${d.label} not supplied`);
    if (d.barcode === 'required' && (supplied || path) && !barcode) add(`doc_${k}_barcode`, 'REQUIRED', `${d.label} barcode is required`);
  }

  return {
    issues,
    row: { ...candidate.fields, sourceRecordId, approvalStatus, approvedAt, evidenceRef, documents },
  };
}
