/*
 * Reference data and import schema for the approved-student data import
 * (Functional & Technical Specification V1.0 — A-11..A-18, chapter 14 "Field mapping for received data").
 * Values marked "To Be Confirmed" in the specification are configurable here, not hard rules.
 */

/* The twelve approved Module 3 technology tracks, with the external form's labels as aliases (Table 79). */
export const TRACKS: { code: string; name: string; aliases: string[] }[] = [
  { code: 'T01', name: 'Data Analytics & Business Intelligence', aliases: ['Data Analytics & Business Intelligence'] },
  { code: 'T02', name: 'Graphic Design & Digital Branding', aliases: ['Graphic Design & Digital Branding'] },
  { code: 'T03', name: 'Web Design & Development', aliases: ['Web Design & Development'] },
  { code: 'T04', name: 'Application Development', aliases: ['Application Development'] },
  { code: 'T05', name: 'IT Infrastructure & Smart Technologies', aliases: ['IT Infrastructure & Smart Technologies'] },
  { code: 'T06', name: 'Retail & E-Commerce Management', aliases: ['Retail & E-Commerce Management'] },
  { code: 'T07', name: 'Cyber Security', aliases: ['Cyber Security'] },
  { code: 'T08', name: 'AI/ML Engineer', aliases: ['AI/ML Engineer', 'AI-ML Engineer'] },
  { code: 'T09', name: 'Data Scientist', aliases: ['Data Scientist'] },
  {
    code: 'T10',
    name: 'Social Media Marketing / Digital Marketing',
    aliases: ['Social Media Marketing / Digital Marketing', 'Social Media & Digital Marketing'],
  },
  { code: 'T11', name: 'Blockchain', aliases: ['Blockchain'] },
  { code: 'T12', name: 'Office Process Automation (OPA)', aliases: ['Office Process Automation (OPA)', 'Office Process Automation'] },
];

/* External form options that are not approved tracks (raise TRACK_NOT_OFFERED). */
export const TRACKS_NOT_OFFERED = ['Accounting & Financial Management', 'Banking, Financial Services & Insurance'];

/* Source option lists, stored exactly as supplied (Unicode NFC); never auto-mapped. */
export const RELIGIONS = ['हिंदू'];
export const CASTES = [
  'मराठी',
  'राजपूत',
  'अय्यंगार',
  'बनिया',
  'बंगाली',
  'ठाकूर',
  'राजपुरोहित',
  'हिंदू नेपाळी',
  'नायडू',
  'सेनगुप्तर',
  'कानबी',
  'ब्राह्मण',
  'भूमिहार',
  'यलमार',
  'सिंधी',
  'त्यागी',
  'जाट',
  'नायर',
  'कायस्थ',
  'कम्मा',
  'पटेल',
  'पाटीदार',
  'गुजराथी',
  'कोमटी/वैश्य',
  'लोहाणा',
  'हिंदू वेरशैव लिंगायत',
  'अग्रवाल',
];

/* Course centre: district / location reference (the form's 25 names are To Be Confirmed, OQ-006). Matched by code or name. */
export const CENTRES: { code: string; name: string }[] = [
  ['NDB', 'Nandurbar'],
  ['DHU', 'Dhule'],
  ['JAL', 'Jalgaon'],
  ['BUL', 'Buldhana'],
  ['AKO', 'Akola'],
  ['AMR', 'Amravati'],
  ['NAG', 'Nagpur'],
  ['BHA', 'Bhandara'],
  ['GON', 'Gondia'],
  ['PAL', 'Palghar'],
  ['NAS', 'Nashik'],
  ['WAS', 'Washim'],
  ['YAV', 'Yavatmal'],
  ['WAR', 'Wardha'],
  ['CHA', 'Chandrapur'],
  ['GAD', 'Gadchiroli'],
  ['MUS', 'Mumbai Suburban'],
  ['THA', 'Thane'],
  ['CSN', 'Chhatrapati Sambhajinagar'],
  ['JLN', 'Jalna'],
  ['HIN', 'Hingoli'],
  ['PAR', 'Parbhani'],
  ['NAN', 'Nanded'],
  ['MUC', 'Mumbai City'],
  ['RAI', 'Raigad'],
  ['PUN', 'Pune'],
  ['AHL', 'Ahilyanagar'],
  ['BEE', 'Beed'],
  ['LAT', 'Latur'],
  ['DHA', 'Dharashiv'],
  ['RAT', 'Ratnagiri'],
  ['SAT', 'Satara'],
  ['SOL', 'Solapur'],
  ['SIN', 'Sindhudurg'],
  ['KOL', 'Kolhapur'],
  ['SAN', 'Sangli'],
].map(([code, name]) => ({ code, name }));

/*
 * Certificate barcode numbers (Income / EWS, Domicile): exactly 18 digits, nothing else. Only the format is checked
 * here; whether the certificate is genuine is verified separately on the issuing portal.
 */
export const BARCODE_RE = /^\d{18}$/;
export const BARCODE_FORMAT_MESSAGE = 'must be exactly 18 digits (numbers only, no spaces, letters or symbols)';

/* Documents: imported as metadata (presence flags), Table 81. */
export const DOCUMENTS: { key: string; label: string; required: boolean; barcode?: 'required' | 'optional' }[] = [
  { key: 'PHOTO', label: 'Photo', required: true },
  { key: 'SIGNATURE', label: 'Signature', required: true },
  { key: 'INCOME_EWS', label: 'Income Certificate / EWS', required: true, barcode: 'required' },
  { key: 'DOMICILE', label: 'Domicile Certificate', required: true, barcode: 'required' },
  { key: 'AADHAAR_CARD', label: 'Aadhaar Card', required: true },
  { key: 'PAN_CARD', label: 'PAN Card', required: false },
  { key: 'SCHOOL_LEAVING', label: 'School Leaving / Transfer Certificate', required: true },
  { key: 'NAME_CHANGE', label: 'Change in Name (Gazette / Marriage Certificate)', required: false },
  { key: 'EDU_CERT', label: 'Highest Education Qualification Certificate', required: true },
  { key: 'OTHER', label: 'Other Required Document', required: false },
  { key: 'FITNESS', label: 'Physical Fitness Certificate', required: true },
  { key: 'SELF_DECLARATION', label: 'Self-Declaration Form', required: true },
  { key: 'CASTE_CERT', label: 'Caste Certificate', required: true },
];

/* The source's approved value for approval_status (To Be Confirmed). */
export const APPROVED_STATUS = 'APPROVED';

/*
 * Import columns: internal name → accepted header aliases (case- and spacing-insensitive).
 * The template file uses the internal names; the external form's labels are accepted too.
 */
export const IMPORT_COLUMNS: { field: string; label: string; required: boolean; aliases: string[] }[] = [
  {
    field: 'source_record_id',
    label: 'Source record ID',
    required: true,
    aliases: ['source record id', 'application id', 'registration id'],
  },
  { field: 'first_name', label: 'First Name', required: true, aliases: ['first name'] },
  { field: 'last_name', label: 'Last Name', required: true, aliases: ['last name', 'surname'] },
  { field: 'father_name', label: 'Father Name', required: true, aliases: ['father name', "father's name"] },
  { field: 'mother_name', label: 'Mother Name', required: true, aliases: ['mother name', "mother's name"] },
  { field: 'email', label: 'Email', required: true, aliases: ['email', 'email id', 'e-mail'] },
  { field: 'date_of_birth', label: 'Date of Birth (YYYY-MM-DD)', required: true, aliases: ['date of birth', 'dob'] },
  { field: 'current_address', label: 'Current Address', required: true, aliases: ['current address', 'address'] },
  { field: 'aadhaar_number', label: 'Aadhaar Number', required: true, aliases: ['aadhaar number', 'aadhaar', 'aadhar number', 'aadhar'] },
  { field: 'mobile_number', label: 'Mobile Number', required: true, aliases: ['mobile number', 'mobile', 'mobile no'] },
  { field: 'religion', label: 'Religion', required: true, aliases: ['religion'] },
  { field: 'caste', label: 'Caste', required: true, aliases: ['caste'] },
  { field: 'course_centre', label: 'Course Centre', required: true, aliases: ['course centre', 'course center', 'centre', 'center'] },
  {
    field: 'technology',
    label: 'Technology / Third Module Selection',
    required: true,
    aliases: ['technology', 'technology / third module selection', 'third module selection', 'track'],
  },
  {
    field: 'education_qualification',
    label: 'Education Qualification',
    required: true,
    aliases: ['education qualification', 'qualification'],
  },
  { field: 'approval_status', label: 'Approval status', required: true, aliases: ['approval status', 'external status', 'status'] },
  { field: 'approved_at', label: 'Approved at (ISO date-time)', required: true, aliases: ['approved at', 'approval date', 'approved on'] },
  {
    field: 'evidence_ref',
    label: 'Approval evidence reference',
    required: false,
    aliases: ['evidence ref', 'evidence reference', 'approval reference'],
  },
  {
    field: 'declaration_accepted',
    label: 'Declaration accepted (Yes/No)',
    required: false,
    aliases: ['declaration accepted', 'declaration'],
  },
  ...DOCUMENTS.flatMap((d) => [
    { field: `doc_${d.key.toLowerCase()}`, label: `${d.label} (Yes/No)`, required: false, aliases: [d.label.toLowerCase()] },
    ...(d.barcode
      ? [
          {
            field: `doc_${d.key.toLowerCase()}_barcode`,
            label: `${d.label} Barcode`,
            required: false,
            aliases: [`${d.label.toLowerCase()} barcode`],
          },
        ]
      : []),
  ]),
];

/* Columns recognised but ignored in Version 1.0 (presence is logged on the batch). */
export const IGNORED_COLUMNS = ['caste description'];

/*
 * Issue codes. Waivable issues may be accepted by a reviewer with a reason; required identity fields,
 * Aadhaar validity and approval evidence are never waivable (A-17).
 */
export const ISSUE_CODES = {
  REQUIRED: { waivable: false, label: 'Required value missing' },
  SRC_ID_MISSING: { waivable: false, label: 'Source record ID missing' },
  EMAIL_INVALID: { waivable: false, label: 'Email address invalid' },
  DOB_INVALID: { waivable: false, label: 'Date of birth invalid or ambiguous' },
  AADHAAR_INVALID: { waivable: false, label: 'Aadhaar number invalid (12 digits, Verhoeff checksum)' },
  MOBILE_INVALID: { waivable: false, label: 'Mobile number invalid' },
  TEXT_TOO_LONG: { waivable: false, label: 'Value too long' },
  NAME_INVALID: { waivable: false, label: "Name may contain only letters, spaces and . ' -" },
  BARCODE_INVALID: { waivable: false, label: 'Certificate barcode must be exactly 18 digits' },
  EVIDENCE_MISSING: { waivable: false, label: 'Approval evidence missing or not approved' },
  REF_UNKNOWN: { waivable: true, label: 'Value not in the reference list' },
  TRACK_NOT_OFFERED: { waivable: true, label: 'Technology option is not an approved track (track to be confirmed)' },
  DOC_MISSING: { waivable: true, label: 'Required document not supplied' },
  DOC_INVALID: { waivable: true, label: 'Document file rejected (type, size or content)' },
  DUPLICATE_IN_FILE: { waivable: false, label: 'Same person appears earlier in this file' },
} as const;
export type IssueCode = keyof typeof ISSUE_CODES;

/* Where a student record came from. */
export const STUDENT_SOURCE = {
  IMPORT: 'IMPORT',
  PUBLIC_REGISTRATION: 'PUBLIC_REGISTRATION',
} as const;

/* students.status: RECEIVED = finalised from an approved import; REGISTRATION_PENDING = public registration awaiting verification. */
export const STUDENT_STATUS = {
  RECEIVED: 'RECEIVED',
  REGISTRATION_PENDING: 'REGISTRATION_PENDING',
} as const;

/* students.externalStatus for a public registration: never APPROVED until the approval workflow says so. */
export const REGISTRATION_EXTERNAL_STATUS = 'PENDING';

/* The import columns a public registration fills (the candidate's own details; no source IDs or approval). */
export const REGISTRATION_FIELDS = [
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
  'declaration_accepted',
] as const;

/* Registration takes master ids where the import takes text: import column → registration field (body). */
export const REGISTRATION_MASTER_FIELDS: Partial<Record<(typeof REGISTRATION_FIELDS)[number], string>> = {
  course_centre: 'region_id',
  caste: 'caste_id',
  education_qualification: 'education_id',
};

export const BATCH_STATUS = {
  IMPORT_PENDING: 'IMPORT_PENDING',
  IMPORT_FAILED: 'IMPORT_FAILED',
  VALIDATING: 'VALIDATING',
  VALIDATED_WITH_EXCEPTIONS: 'VALIDATED_WITH_EXCEPTIONS',
  READY_TO_FINALISE: 'READY_TO_FINALISE',
  FINALISED: 'FINALISED',
  CANCELLED: 'CANCELLED',
} as const;

export const ROW_STATUS = {
  DATA_VALIDATION_PENDING: 'DATA_VALIDATION_PENDING',
  VALID: 'VALID',
  DATA_EXCEPTION: 'DATA_EXCEPTION',
  POSSIBLE_DUPLICATE: 'POSSIBLE_DUPLICATE',
  SKIPPED_UNCHANGED: 'SKIPPED_UNCHANGED',
  ROW_REJECTED: 'ROW_REJECTED',
  RECONCILED: 'RECONCILED',
} as const;
