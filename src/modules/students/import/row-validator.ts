import crypto from 'crypto';
import {
  APPROVED_STATUS,
  BARCODE_FORMAT_MESSAGE,
  BARCODE_RE,
  CASTE_SPELLINGS,
  CLOSED_SOURCE_STATUSES,
  DOCUMENTS,
  GENDER_SPELLINGS,
  IMPORT_COLUMNS,
  MARITAL_STATUS_SPELLINGS,
  RELIGION_SPELLINGS,
  RELIGIONS,
  SOURCE_TIME_ZONE_OFFSET,
  TRACKS,
  TRACKS_NOT_OFFERED,
  type IssueCode,
} from '../student.constants';
import type { MasterLookup } from '../../masters';
import { aadhaarBlindIndex, encryptAadhaar, verhoeffValid } from '../aadhaar';
import { EMPTY_GEOGRAPHY, type GeographyLookup } from './geography';

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

/*
 * The student profile and source details an import may carry (the approver dashboard's columns): the same names as
 * the students columns they are written to. Every key is null when the file has no value (or no such column).
 */
export interface ImportProfile {
  gender: string | null;
  maritalStatus: string | null;
  permanentAddress: string | null;
  landmark: string | null;
  districtId: string | null;
  talukaId: string | null;
  /* District, taluka and division as received (the ids are set only when the value matches the geography masters). */
  districtName: string | null;
  talukaName: string | null;
  division: string | null;
  pinCode: string | null;
  alternateMobile: string | null;
  alternateEmail: string | null;
  disabilityStatus: boolean | null;
  disabilityType: string | null;
  disabilityCertificateNumber: string | null;
  qualificationName: string | null;
  qualificationStream: string | null;
  qualificationBoard: string | null;
  qualificationCompletedOn: string | null;
  gradingType: string | null;
  cgpaScale: number | null;
  /* numeric(5,2) as text, e.g. "78.50". */
  score: string | null;
  qualificationClass: string | null;
  schemeName: string | null;
  sourceSubmittedAt: string | null;
  sourceUpdatedAt: string | null;
  sourceRemarks: string | null;
  /* Values of the file's other columns, and values that could not be stored in their field, by header as written. */
  sourceExtra: Record<string, string>;
  /* The course centre was taken from the district (the file has no course centre value). */
  centreFromDistrict: boolean;
  /* The first and last name were split from this column (full_name or applicant_name); null when given separately. */
  nameFrom: string | null;
}

export type ImportRowValues = NormalisedRow & ImportProfile;

/* What validateRow needs besides the row: the geography masters and the file's other columns. */
export interface ImportContext {
  geography?: GeographyLookup;
  /* This row's values of the columns no field reads (header → value). */
  extra?: Record<string, string>;
  /* field → header as written in the file (names kept values after the source's own column). */
  mapping?: Record<string, string>;
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

/*
 * ISO YYYY-MM-DD only: other formats are ambiguous (DD/MM vs MM/DD) and are never guessed. Excel dates arrive as ISO.
 * A midnight time after the date ("2003-06-06 00:00:00", as some exports write dates) is allowed.
 */
export function parseIsoDate(v: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T]00:00(?::00(?:\.0+)?)?Z?)?$/.exec(v.trim());
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}
function parseDob(v: string): string | null {
  const d = parseIsoDate(v);
  return d && new Date(`${d}T00:00:00Z`).getTime() <= Date.now() ? d : null;
}

/*
 * A source date-time, as ISO text: "YYYY-MM-DDTHH:mm[:ss][.sss]" with "Z" or an offset keeps its zone; without a zone
 * ("2026-10-27 05:59:32") it is read in the source time zone (SOURCE_TIME_ZONE_OFFSET); a date alone is UTC midnight.
 * Other forms are not guessed.
 */
export function parseSourceTimestamp(v: string): string | null {
  const t = v.trim();
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.exec(t);
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})(?::(\d{2})(\.\d{1,9})?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i.exec(t);
  if (!dateOnly && !m) return null;
  const day = dateOnly ? t : m![1];
  if (!parseIsoDate(day)) return null;
  if (m && (+m[2] > 23 || +m[3] > 59 || +(m[4] ?? 0) > 59)) return null;
  const iso = dateOnly
    ? `${day}T00:00:00Z`
    : `${day}T${m![2]}:${m![3]}:${m![4] ?? '00'}${(m![5] ?? '').slice(0, 4)}${
        m![6] ? (m![6].toUpperCase() === 'Z' ? 'Z' : m![6].replace(/^([+-]\d{2})(\d{2})$/, '$1:$2')) : SOURCE_TIME_ZONE_OFFSET
      }`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/*
 * Percentage / CGPA in one column: "78.5", "78.5%", "8.2", "8.2/10", "8.2 CGPA". A value with "%" or above 10 is a
 * percentage (at most 100); otherwise a CGPA (a scale is recorded only when written, e.g. "/10": never assumed).
 */
export function parseScore(v: string): { score: string; gradingType: 'PERCENTAGE' | 'CGPA'; cgpaScale: number | null } | null {
  const t = v.trim().replace(/,/g, '.');
  const pct = /^(\d{1,3}(?:\.\d+)?)\s*(%|percent|percentage)$/i.exec(t);
  const num = /^(\d{1,3}(?:\.\d+)?)\s*(?:\/\s*(\d{1,2}))?\s*(cgpa|gpa|cpi|sgpa)?$/i.exec(t);
  const round = (n: number) => (Math.round(n * 100) / 100).toFixed(2);
  if (pct) {
    const n = Number(pct[1]);
    return n <= 100 ? { score: round(n), gradingType: 'PERCENTAGE', cgpaScale: null } : null;
  }
  if (!num) return null;
  const n = Number(num[1]);
  const scale = num[2] ? Number(num[2]) : null;
  if (scale !== null) return [4, 5, 10].includes(scale) && n <= scale ? { score: round(n), gradingType: 'CGPA', cgpaScale: scale } : null;
  if (num[3]) return n <= 10 ? { score: round(n), gradingType: 'CGPA', cgpaScale: null } : null;
  if (n > 100) return null;
  return n > 10
    ? { score: round(n), gradingType: 'PERCENTAGE', cgpaScale: null }
    : { score: round(n), gradingType: 'CGPA', cgpaScale: null };
}

/* "NA", "N/A", "None", "Nil", "-", "Not applicable": no value. */
const notApplicable = (v: string) => /^(|na|n\.a\.?|n\/a|none|nil|-+|not applicable|no)$/i.test(v.trim());
const PIN_RE = /^[1-9]\d{5}$/;

/* Stable checksum of the source row, to skip an unchanged re-import (SKIPPED_UNCHANGED). */
export function rowChecksum(raw: Record<string, string>): string {
  const keys = Object.keys(raw).sort();
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(keys.map((k) => [k, raw[k] ?? ''])))
    .digest('hex');
}

/*
 * The fields the import read before the profile and source columns were added (migration 1796100000000). Students
 * imported before then carry the checksum of these fields only, so an unchanged file uploaded again is still
 * recognised as unchanged although it may contain columns that are read now (Gender, Remarks, District…).
 */
const LEGACY_FIELDS = new Set([
  'source_record_id',
  'first_name',
  'last_name',
  'father_name',
  'mother_name',
  'email',
  'date_of_birth',
  'current_address',
  'aadhaar_number',
  'mobile_number',
  'religion',
  'caste',
  'course_centre',
  'technology',
  'education_qualification',
  'approval_status',
  'approved_at',
  'evidence_ref',
  'declaration_accepted',
  ...IMPORT_COLUMNS.filter((c) => c.field.startsWith('doc_')).map((c) => c.field),
]);
export const legacyRowChecksum = (raw: Record<string, string>): string =>
  rowChecksum(Object.fromEntries(Object.entries(raw).filter(([k]) => LEGACY_FIELDS.has(k))));

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
  const fatherName = text('father_name', 'Father name', 150, { name: true });
  const motherName = text('mother_name', 'Mother name', 150, { name: true });
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
  // An earlier spelling of a caste (CASTE_SPELLINGS) is read as the caste itself.
  const casteSpelling = CASTE_SPELLINGS[casteRaw.replace(/\s+/g, ' ').trim()];
  const casteRef = masters.find('caste', casteRaw) ?? (casteSpelling ? masters.find('caste', casteSpelling) : null);
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

const COLUMN_LABEL = new Map(IMPORT_COLUMNS.map((c) => [c.field, c.label]));
const optionKey = (v: string) => v.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
const mobileDigits = (v: string) =>
  v
    .replace(/[\s()-]/g, '')
    .replace(/^\+?91(?=\d{10}$)/, '')
    .replace(/^0(?=\d{10}$)/, '');
/* Kept values: at most this many characters each (a free-text column cannot grow a row without bound). */
const EXTRA_VALUE_MAX = 2000;

/*
 * The source layouts' columns in the candidate's own fields (the approver dashboard export has no first/last name,
 * course centre or single mobile column): name split from Full Name, mobile from Primary Mobile Number, course centre
 * from the district, religion spellings. Returns the adapted row and what was derived.
 */
function adaptLayout(raw: Record<string, string>, masters: MasterLookup, geo: GeographyLookup, keep: (field: string, v: string) => void) {
  const get = (f: string) => (raw[f] ?? '').toString();
  const out: Record<string, string> = { ...raw };

  /* Name: first + last when given; otherwise split Full Name (or Applicant name): last word = last name. */
  let nameFrom: string | null = null;
  if (!collapse(get('first_name')) && !collapse(get('last_name'))) {
    const full = collapse(get('full_name'));
    const applicant = collapse(get('applicant_name'));
    const name = full || applicant;
    if (name) {
      nameFrom = full ? 'full_name' : 'applicant_name';
      const words = name.split(' ');
      out.last_name = words.length > 1 ? words.pop()! : '';
      out.first_name = words.join(' ');
      if (full && applicant && optionKey(full) !== optionKey(applicant)) keep('applicant_name', applicant);
    }
  }

  /*
   * Mobile: the primary (registered) number first — unless it is not a valid mobile number and the form's number is;
   * the number not used is kept when it differs.
   */
  const primary = get('primary_mobile_number').trim();
  const form = get('mobile_number').trim();
  if (primary) {
    const valid = (v: string) => /^[6-9]\d{9}$/.test(mobileDigits(v));
    const usePrimary = valid(primary) || !form || !valid(form);
    out.mobile_number = usePrimary ? primary : form;
    const other = usePrimary ? form : primary;
    if (other && mobileDigits(other) !== mobileDigits(out.mobile_number))
      keep(usePrimary ? 'mobile_number' : 'primary_mobile_number', other);
  }

  const religion = get('religion').normalize('NFC').trim();
  const spelling = RELIGION_SPELLINGS[religion] ?? RELIGION_SPELLINGS[religion.toLowerCase()];
  if (spelling) out.religion = spelling;

  /* District (or the address district) → geography master; it also gives the course centre when none is given. */
  const districtRaw = collapse(get('district')) || collapse(get('address_district'));
  const addressDistrict = collapse(get('address_district'));
  if (collapse(get('district')) && addressDistrict && optionKey(addressDistrict) !== optionKey(collapse(get('district'))))
    keep('address_district', addressDistrict);
  const district = districtRaw ? geo.district(districtRaw) : null;
  let centreFromDistrict = false;
  if (!collapse(get('course_centre')) && districtRaw) {
    out.course_centre = district ? (district.code && masters.find('region', district.code) ? district.code : district.name) : districtRaw;
    centreFromDistrict = true;
  }
  return { out, nameFrom, district, districtRaw, centreFromDistrict };
}

/*
 * Applies the validation and normalisation rules of Table 81 to one source row. Document columns are checked for the
 * active document types in the master that have an import column (doc_<code>); "required" is the type's isMandatory.
 * The student profile and source columns (gender, addresses, district, qualification details, scheme, dates, remarks)
 * are validated too: a value that cannot be stored raises a waivable issue and is kept in sourceExtra, never lost.
 */
export function validateRow(
  raw: Record<string, string>,
  masters: MasterLookup,
  ctx: ImportContext = {},
): { row: ImportRowValues; issues: RowIssue[] } {
  const geo = ctx.geography ?? EMPTY_GEOGRAPHY;
  const issues: RowIssue[] = [];
  const get = (f: string) => (raw[f] ?? '').toString();
  const add = (field: string, code: IssueCode, message: string) => issues.push({ field, code, message });
  const sourceExtra: Record<string, string> = {};
  for (const [k, v] of Object.entries(ctx.extra ?? {})) if (v.trim()) sourceExtra[k] = v.trim().slice(0, EXTRA_VALUE_MAX);
  const headerOf = (f: string) => ctx.mapping?.[f] ?? COLUMN_LABEL.get(f) ?? f;
  const keep = (f: string, v: string) => {
    if (v.trim()) sourceExtra[headerOf(f)] = v.trim().slice(0, EXTRA_VALUE_MAX);
  };

  const sourceRecordId = collapse(get('source_record_id')) || null;
  if (!sourceRecordId) add('source_record_id', 'SRC_ID_MISSING', 'Source record ID is required');
  else if (sourceRecordId.length > 64) add('source_record_id', 'TEXT_TOO_LONG', 'Source record ID is longer than 64 characters');

  const layout = adaptLayout(raw, masters, geo, keep);
  const candidate = validateCandidate(layout.out, masters);
  for (const i of candidate.issues) {
    if (layout.nameFrom && i.field === 'last_name' && i.code === 'REQUIRED')
      i.message = `${headerOf(layout.nameFrom)} has only one word: a last name is required`;
    issues.push(i);
  }

  /*
   * Approval evidence. APPROVED: approved_at (or, without it, the source's last-updated date-time) must be a valid past
   * date-time. A closed status (rejected, withdrawn…) is never imported. Any other status is still under review at
   * the source: NOT_APPROVED (waivable) — accepted, the student is added as pending approval.
   */
  const approvalStatus = collapse(get('approval_status'))
    .toUpperCase()
    .replace(/[\s-]+/g, '_');
  let approvedAt: string | null = null;
  if (!approvalStatus) add('approval_status', 'EVIDENCE_MISSING', 'Approval status is required');
  else if (approvalStatus === APPROVED_STATUS) {
    const approvedRaw = get('approved_at').trim() || get('source_updated_at').trim();
    const parsed = approvedRaw ? parseSourceTimestamp(approvedRaw) : null;
    approvedAt = parsed && new Date(parsed).getTime() <= Date.now() + 60_000 ? parsed : null;
    if (!approvedAt) add('approved_at', 'EVIDENCE_MISSING', 'Approval date is missing, invalid or in the future');
  } else if (CLOSED_SOURCE_STATUSES.includes(approvalStatus))
    add(
      'approval_status',
      'EVIDENCE_MISSING',
      `The application is ${approvalStatus} at the source; only approved applications are imported`,
    );
  else
    add(
      'approval_status',
      'NOT_APPROVED',
      `Status at the source is ${approvalStatus}, not ${APPROVED_STATUS}: if accepted, the student is added as pending approval (not eligible for a batch) until an approved record${sourceRecordId ? ` of ${sourceRecordId}` : ''} is imported`,
    );
  const evidenceRef = collapse(get('evidence_ref')).slice(0, 120) || null;

  const profile = validateProfile(raw, layout, geo, add, keep, headerOf);

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
    documents[d.key] = path ? { supplied: false, barcode, path, documentTypeId: type.id } : { supplied, barcode, documentTypeId: type.id };
    /* A path means the file is expected in the documents ZIP; the issue clears when that file is stored. */
    if (path) add(`doc_${k}`, 'DOC_MISSING', `${d.label}: waiting for "${path}" in the documents ZIP`);
    else if (required && !supplied && !raw) add(`doc_${k}`, 'DOC_MISSING', `${d.label} not supplied`);
    if (d.barcode === 'required' && (supplied || path) && !barcode) add(`doc_${k}_barcode`, 'REQUIRED', `${d.label} barcode is required`);
    if (barcode && !BARCODE_RE.test(barcode)) add(`doc_${k}_barcode`, 'BARCODE_INVALID', `${d.label} barcode ${BARCODE_FORMAT_MESSAGE}`);
  }

  return {
    issues,
    row: {
      ...candidate.fields,
      sourceRecordId,
      approvalStatus,
      approvedAt,
      evidenceRef,
      documents,
      ...profile,
      sourceExtra,
      centreFromDistrict: layout.centreFromDistrict,
      nameFrom: layout.nameFrom,
    },
  };
}

/*
 * The optional profile and source columns. Each is normalised to its students column; a value that does not fit
 * (format, length) raises FORMAT_INVALID, leaves the field empty and is kept in sourceExtra under its header; an
 * option outside the known list (gender, marital status) is stored as supplied and raised as REF_UNKNOWN.
 */
function validateProfile(
  raw: Record<string, string>,
  layout: ReturnType<typeof adaptLayout>,
  geo: GeographyLookup,
  add: (field: string, code: IssueCode, message: string) => void,
  keep: (field: string, v: string) => void,
  headerOf: (field: string) => string,
): Omit<ImportProfile, 'sourceExtra' | 'centreFromDistrict' | 'nameFrom'> {
  const get = (f: string) => (raw[f] ?? '').toString();
  const invalid = (field: string, why: string) => {
    add(field, 'FORMAT_INVALID', `${headerOf(field)} ${why}; if accepted, the field is left empty (the value is kept)`);
    keep(field, get(field));
    return null;
  };
  /* Optional text: collapsed (addresses keep their line breaks), null when empty, FORMAT_INVALID when too long. */
  const text = (field: string, max: number, opts: { lines?: boolean; na?: boolean } = {}): string | null => {
    const v = opts.lines ? get(field).trim() : collapse(get(field));
    if (!v || (opts.na && notApplicable(v))) return null;
    return v.length > max ? invalid(field, `is longer than ${max} characters`) : v;
  };
  const option = (field: string, spellings: Record<string, string>, label: string, max: number): string | null => {
    const v = collapse(get(field));
    if (!v) return null;
    const known = spellings[optionKey(v)];
    if (known) return known;
    if (v.length > max) return invalid(field, `is longer than ${max} characters`);
    add(field, 'REF_UNKNOWN', `${label} "${v}" is not one of ${[...new Set(Object.values(spellings))].join(', ')} (kept as supplied)`);
    return v;
  };
  const timestamp = (field: string): string | null => {
    const v = get(field).trim();
    if (!v) return null;
    const t = parseSourceTimestamp(v);
    if (!t) return invalid(field, 'must be a date-time as YYYY-MM-DD HH:mm:ss (or ISO 8601)');
    return new Date(t).getTime() > Date.now() + 86_400_000 ? invalid(field, 'is in the future') : t;
  };

  const districtName = layout.districtRaw ? (layout.districtRaw.length > 100 ? null : layout.districtRaw) : null;
  if (layout.districtRaw && !districtName) keep('district', layout.districtRaw);
  const talukaName = text('taluka', 100);
  const taluka = talukaName ? geo.taluka(layout.district?.id ?? null, talukaName) : null;

  const pinRaw = get('pin_code').replace(/\s+/g, '');
  const pinCode = !pinRaw ? null : PIN_RE.test(pinRaw) ? pinRaw : invalid('pin_code', 'must be a 6-digit Indian PIN code');

  const altMobileRaw = get('alternate_mobile_number').trim();
  const altDigits = mobileDigits(altMobileRaw);
  const alternateMobile =
    !altMobileRaw || notApplicable(altMobileRaw)
      ? null
      : /^[6-9]\d{9}$/.test(altDigits)
        ? '+91' + altDigits
        : invalid('alternate_mobile_number', 'must be a 10-digit Indian number starting 6–9');

  const altEmailRaw = get('alternate_email').trim().toLowerCase();
  const alternateEmail =
    !altEmailRaw || notApplicable(altEmailRaw)
      ? null
      : altEmailRaw.length <= 254 && EMAIL_RE.test(altEmailRaw)
        ? altEmailRaw
        : invalid('alternate_email', 'is not a valid email address');

  const disRaw = get('disability_status').trim();
  const disabilityStatus = !disRaw ? null : yes(disRaw) ? true : no(disRaw) ? false : invalid('disability_status', 'must be Yes or No');

  const completedRaw = get('qualification_completed_on').trim();
  const qualificationCompletedOn = !completedRaw
    ? null
    : (parseIsoDate(completedRaw) ?? invalid('qualification_completed_on', 'must be a real date as YYYY-MM-DD'));

  const scoreRaw = get('score').trim();
  const score = !scoreRaw || notApplicable(scoreRaw) ? null : parseScore(scoreRaw);
  if (scoreRaw && !notApplicable(scoreRaw) && !score)
    invalid('score', 'must be a percentage (0–100, e.g. 78.5 or 78.5%) or a CGPA (e.g. 8.2 or 8.2/10)');

  return {
    gender: option('gender', GENDER_SPELLINGS, 'Gender', 20),
    maritalStatus: option('marital_status', MARITAL_STATUS_SPELLINGS, 'Marital status', 20),
    permanentAddress: text('permanent_address', 500, { lines: true }),
    landmark: text('landmark', 150, { na: true }),
    districtId: layout.district?.id ?? null,
    talukaId: taluka?.id ?? null,
    districtName,
    talukaName,
    division: text('division', 100),
    pinCode,
    alternateMobile,
    alternateEmail,
    disabilityStatus,
    disabilityType: text('disability_type', 100, { na: true }),
    disabilityCertificateNumber: text('disability_certificate_number', 50, { na: true }),
    qualificationName: text('qualification_name', 150),
    qualificationStream: text('qualification_stream', 150, { na: true }),
    qualificationBoard: text('qualification_board', 200),
    qualificationCompletedOn,
    gradingType: score?.gradingType ?? null,
    cgpaScale: score?.cgpaScale ?? null,
    score: score?.score ?? null,
    qualificationClass: text('qualification_class', 40, { na: true }),
    schemeName: text('scheme_name', 150),
    sourceSubmittedAt: timestamp('submitted_at'),
    sourceUpdatedAt: timestamp('source_updated_at'),
    sourceRemarks: text('source_remarks', 1000, { lines: true }),
  };
}
