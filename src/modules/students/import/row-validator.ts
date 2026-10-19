import crypto from 'crypto';
import { APPROVED_STATUS, CASTES, CENTRES, DOCUMENTS, RELIGIONS, TRACKS, TRACKS_NOT_OFFERED, type IssueCode } from '../student.constants';
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
  trackCode: string | null;
  trackSourceValue: string;
  educationQualification: string;
  approvalStatus: string;
  approvedAt: string | null;
  evidenceRef: string | null;
  declarationAccepted: boolean | null;
  documents: Record<string, { supplied: boolean; barcode: string | null }>;
  /* For matching only (Tier 2): lower-case, single-spaced full name. */
  nameKey: string;
}

const collapse = (v: string) => v.replace(/\s+/g, ' ').trim();
const nfc = (v: string) => v.normalize('NFC').trim();
const yes = (v: string) => /^(y|yes|true|1|uploaded|available|supplied)$/i.test(v.trim());
const NAME_RE = /^[\p{L}\p{M}][\p{L}\p{M} .'-]*$/u;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const keyify = (v: string) => v.toLowerCase().replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const TRACK_BY_ALIAS = new Map<string, string>();
for (const t of TRACKS) {
  TRACK_BY_ALIAS.set(keyify(t.code), t.code);
  for (const a of [t.name, ...t.aliases]) TRACK_BY_ALIAS.set(keyify(a), t.code);
}
const NOT_OFFERED = new Set(TRACKS_NOT_OFFERED.map(keyify));
const CENTRE_BY_KEY = new Map<string, string>();
for (const c of CENTRES) {
  CENTRE_BY_KEY.set(keyify(c.code), c.code);
  CENTRE_BY_KEY.set(keyify(c.name), c.code);
}

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

/* Applies the validation and normalisation rules of Table 81 to one source row. */
export function validateRow(raw: Record<string, string>): { row: NormalisedRow; issues: RowIssue[] } {
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

  const sourceRecordId = collapse(get('source_record_id')) || null;
  if (!sourceRecordId) add('source_record_id', 'SRC_ID_MISSING', 'Source record ID is required');
  else if (sourceRecordId.length > 64) add('source_record_id', 'TEXT_TOO_LONG', 'Source record ID is longer than 64 characters');

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

  const caste = nfc(get('caste'));
  if (!caste) add('caste', 'REQUIRED', 'Caste is required');
  else if (!CASTES.includes(caste)) add('caste', 'REF_UNKNOWN', 'Caste is not one of the 27 supplied options');

  const centreRaw = collapse(get('course_centre'));
  const centreCode = centreRaw ? (CENTRE_BY_KEY.get(keyify(centreRaw)) ?? null) : null;
  if (!centreRaw) add('course_centre', 'REQUIRED', 'Course centre is required');
  else if (!centreCode) add('course_centre', 'REF_UNKNOWN', 'Course centre does not match a district / centre code or name');

  const trackSourceValue = collapse(get('technology'));
  const trackCode = trackSourceValue ? (TRACK_BY_ALIAS.get(keyify(trackSourceValue)) ?? null) : null;
  if (!trackSourceValue) add('technology', 'REQUIRED', 'Technology / third module selection is required');
  else if (!trackCode) {
    if (NOT_OFFERED.has(keyify(trackSourceValue)))
      add('technology', 'TRACK_NOT_OFFERED', `"${trackSourceValue}" is not an approved Module 3 track`);
    else add('technology', 'REF_UNKNOWN', 'Technology option does not match an approved track');
  }

  /* Qualification list is To Be Confirmed: accepted as text. */
  const educationQualification = text('education_qualification', 'Education qualification', 150);

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

  const declRaw = get('declaration_accepted').trim();
  const declarationAccepted = declRaw ? yes(declRaw) : null;

  const documents: NormalisedRow['documents'] = {};
  for (const d of DOCUMENTS) {
    const k = d.key.toLowerCase();
    const supplied = yes(get(`doc_${k}`));
    const barcode = d.barcode ? collapse(get(`doc_${k}_barcode`)).slice(0, 64) || null : null;
    documents[d.key] = { supplied, barcode };
    if (d.required && !supplied) add(`doc_${k}`, 'DOC_MISSING', `${d.label} not supplied`);
    if (d.barcode === 'required' && supplied && !barcode) add(`doc_${k}_barcode`, 'REQUIRED', `${d.label} barcode is required`);
  }

  return {
    issues,
    row: {
      sourceRecordId,
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
      trackCode,
      trackSourceValue,
      educationQualification,
      approvalStatus,
      approvedAt,
      evidenceRef,
      declarationAccepted,
      documents,
      nameKey: `${firstName} ${lastName}`.toLowerCase().replace(/\s+/g, ' ').trim(),
    },
  };
}
