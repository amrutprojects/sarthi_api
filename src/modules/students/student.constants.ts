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
/*
 * Spellings of an option that the source portals write differently (vowel length, English). The import reads them as
 * the option itself; anything else is still "not in the reference list".
 */
export const RELIGION_SPELLINGS: Record<string, string> = { हिंदु: 'हिंदू', hindu: 'हिंदू' };
/*
 * AMRUT's target group: the 26 castes, in the official order and spelling ("सद्यस्थितीत अमृतच्या लक्षित गटात अशा
 * एकूण 26 जातींचा समावेश आहे"). The Marathi name is the master's `name`; the English name is shown on the English
 * website. The caste master is brought to this list by migration 1796600000000; this copy seeds new databases.
 */
export const CASTE_LIST: { name: string; nameEn: string }[] = [
  { name: 'ब्राह्मण', nameEn: 'Brahmin' },
  { name: 'कायस्थ', nameEn: 'Kayastha' },
  { name: 'कोमटी/ वैश्य', nameEn: 'Komati / Vaishya' },
  { name: 'मारवाडी', nameEn: 'Marwari' },
  { name: 'पटेल', nameEn: 'Patel' },
  { name: 'राजपूत', nameEn: 'Rajput' },
  { name: 'यलमार', nameEn: 'Yelmar' },
  { name: 'अय्यंगार', nameEn: 'Iyengar / Ayyangar' },
  { name: 'राजपुरोहित', nameEn: 'Rajpurohit' },
  { name: 'पाटीदार', nameEn: 'Patidar' },
  { name: 'नायर', nameEn: 'Nair' },
  { name: 'नायडू', nameEn: 'Naidu' },
  { name: 'कम्मा', nameEn: 'Kamma' },
  { name: 'कानबी', nameEn: 'Kanbi' },
  { name: 'सिंधी', nameEn: 'Sindhi' },
  { name: 'बनिया', nameEn: 'Bania' },
  { name: 'बंगाली', nameEn: 'Bengali' },
  { name: 'त्यागी', nameEn: 'Tyagi' },
  { name: 'सेनगूनथर', nameEn: 'Sengunthar' },
  { name: 'गुजराती', nameEn: 'Gujarati' },
  { name: 'जाट', nameEn: 'Jat' },
  { name: 'लोहाना', nameEn: 'Lohana' },
  { name: 'हिंदू नेपाळी', nameEn: 'Hindu Nepali' },
  { name: 'भूमिहार', nameEn: 'Bhumihar' },
  { name: 'हिंदू / वीरशैव लिंगायत', nameEn: 'Hindu / Veershaiv Lingayat' },
  { name: 'अग्रवाल', nameEn: 'Agrawal' },
];
export const CASTES = CASTE_LIST.map((c) => c.name);
/*
 * Earlier spellings of a caste (the master's names before migration 1796600000000, which the source portals' exports
 * still use). The import reads them as the caste itself. 'मराठी' and 'ठाकूर' are not here: they are not in the list.
 */
export const CASTE_SPELLINGS: Record<string, string> = {
  'कोमटी/वैश्य': 'कोमटी/ वैश्य',
  सेनगुप्तर: 'सेनगूनथर',
  गुजराथी: 'गुजराती',
  लोहाणा: 'लोहाना',
  'हिंदू वेरशैव लिंगायत': 'हिंदू / वीरशैव लिंगायत',
};

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
 * Source statuses that end an application (never imported: correct at the source or reject the row). Any other
 * non-empty status (PENDING, SUBMITTED, UNDER_REVIEW, …) is an application still under review at the source: the
 * row raises NOT_APPROVED, which a reviewer may accept; the student is then added as pending approval
 * (status REGISTRATION_PENDING, never offered for a batch) until an approved record of the same source ID is imported.
 * Statuses are compared upper-cased with spaces and hyphens as underscores.
 */
export const CLOSED_SOURCE_STATUSES = ['REJECTED', 'CANCELLED', 'CANCELED', 'WITHDRAWN', 'DECLINED', 'DISQUALIFIED', 'INELIGIBLE'];

/*
 * Time zone of source date-times written without one ("2026-10-27 05:59:32", as the approver dashboard exports them):
 * the source portals run on India Standard Time. A value with "Z" or an offset keeps its own zone; a date alone is
 * read as UTC midnight (as before).
 */
export const SOURCE_TIME_ZONE_OFFSET = '+05:30';

/*
 * District names as the Marathi source forms write them (and the former English names), by district code. The
 * import matches a district by its master code or English name first, then by these; a match also gives the course
 * centre (region) when the file has no course centre column, since region codes are the district codes.
 */
export const DISTRICT_ALIASES: Record<string, string[]> = {
  NDB: ['नंदुरबार'],
  DHU: ['धुळे'],
  JAL: ['जळगाव', 'जळगांव'],
  BUL: ['बुलढाणा', 'बुलडाणा', 'Buldana'],
  AKO: ['अकोला'],
  AMR: ['अमरावती'],
  NAG: ['नागपूर', 'नागपुर'],
  BHA: ['भंडारा'],
  GON: ['गोंदिया'],
  PAL: ['पालघर'],
  NAS: ['नाशिक', 'नासिक', 'Nasik'],
  WAS: ['वाशिम'],
  YAV: ['यवतमाळ'],
  WAR: ['वर्धा'],
  CHA: ['चंद्रपूर', 'चंद्रपुर'],
  GAD: ['गडचिरोली'],
  MUS: ['मुंबई उपनगर', 'Mumbai Suburban District'],
  THA: ['ठाणे'],
  CSN: ['छत्रपती संभाजीनगर', 'औरंगाबाद', 'Aurangabad'],
  JLN: ['जालना'],
  HIN: ['हिंगोली'],
  PAR: ['परभणी'],
  NAN: ['नांदेड'],
  MUC: ['मुंबई शहर', 'मुंबई', 'Mumbai'],
  RAI: ['रायगड'],
  PUN: ['पुणे', 'Poona'],
  AHL: ['अहिल्यानगर', 'अहमदनगर', 'Ahmednagar', 'Ahmadnagar'],
  BEE: ['बीड'],
  LAT: ['लातूर'],
  DHA: ['धाराशिव', 'उस्मानाबाद', 'Osmanabad'],
  RAT: ['रत्नागिरी'],
  SAT: ['सातारा'],
  SOL: ['सोलापूर', 'सोलापुर'],
  SIN: ['सिंधुदुर्ग'],
  KOL: ['कोल्हापूर', 'कोल्हापुर'],
  SAN: ['सांगली'],
};

/*
 * The source's own wording for the student profile options (the EDP option lists are the canonical values). A value
 * outside these is kept as supplied and raised as REF_UNKNOWN (waivable).
 */
export const GENDER_SPELLINGS: Record<string, string> = {
  male: 'Male',
  m: 'Male',
  पुरुष: 'Male',
  female: 'Female',
  f: 'Female',
  स्त्री: 'Female',
  महिला: 'Female',
  transgender: 'Transgender',
  tg: 'Transgender',
  'third gender': 'Transgender',
  तृतीयपंथी: 'Transgender',
};
export const MARITAL_STATUS_SPELLINGS: Record<string, string> = {
  unmarried: 'Unmarried',
  single: 'Unmarried',
  'not married': 'Unmarried',
  अविवाहित: 'Unmarried',
  married: 'Married',
  विवाहित: 'Married',
};

/*
 * Import columns: internal name → accepted header aliases. Headers match ignoring case, spaces, underscores and
 * punctuation ("applicationId" = "Application ID" = "application_id"). The template file uses the internal names;
 * the external forms' labels are accepted too (the approver dashboard export maps column for column).
 * `required`: the column must be in the file. `alternative`: required unless another column stands in for it (see
 * REQUIRED_COLUMN_GROUPS). `template: false`: an alternative layout's column, left out of the template.
 */
export interface ImportColumn {
  field: string;
  label: string;
  required: boolean;
  aliases: string[];
  alternative?: string;
  template?: false;
}
export const IMPORT_COLUMNS: ImportColumn[] = [
  {
    field: 'source_record_id',
    label: 'Source record ID',
    required: true,
    aliases: ['source record id', 'application id', 'registration id', 'application no', 'application number'],
  },
  {
    field: 'first_name',
    label: 'First Name',
    required: false,
    alternative: 'required unless Full Name is given',
    aliases: ['first name'],
  },
  {
    field: 'last_name',
    label: 'Last Name',
    required: false,
    alternative: 'required unless Full Name is given',
    aliases: ['last name', 'surname'],
  },
  {
    field: 'full_name',
    label: 'Full Name (split into first and last name)',
    required: false,
    alternative: 'instead of First Name + Last Name',
    aliases: ['full name', 'name', 'student name', 'candidate name'],
    template: false,
  },
  {
    field: 'applicant_name',
    label: 'Applicant name (used when Full Name is empty)',
    required: false,
    aliases: ['applicant name'],
    template: false,
  },
  { field: 'father_name', label: 'Father Name', required: true, aliases: ['father name', "father's name"] },
  { field: 'mother_name', label: 'Mother Name', required: true, aliases: ['mother name', "mother's name"] },
  { field: 'email', label: 'Email', required: true, aliases: ['email', 'email id', 'e-mail'] },
  { field: 'date_of_birth', label: 'Date of Birth (YYYY-MM-DD)', required: true, aliases: ['date of birth', 'dob'] },
  { field: 'gender', label: 'Gender', required: false, aliases: ['gender', 'sex'] },
  { field: 'marital_status', label: 'Marital Status', required: false, aliases: ['marital status'] },
  { field: 'current_address', label: 'Current Address', required: true, aliases: ['current address', 'address'] },
  { field: 'permanent_address', label: 'Permanent Address', required: false, aliases: ['permanent address'] },
  { field: 'landmark', label: 'Landmark', required: false, aliases: ['landmark'] },
  {
    field: 'district',
    label: 'District',
    required: false,
    alternative: 'gives the course centre when there is no Course Centre column',
    aliases: ['district', 'district name'],
  },
  {
    field: 'address_district',
    label: 'Address district (used when District is empty)',
    required: false,
    aliases: ['address district', 'distrct'],
    template: false,
  },
  { field: 'taluka', label: 'Taluka', required: false, aliases: ['taluka', 'tehsil', 'taluka name'] },
  { field: 'division', label: 'Division', required: false, aliases: ['division', 'revenue division'] },
  { field: 'pin_code', label: 'Pin Code', required: false, aliases: ['pin code', 'pincode', 'pin', 'postal code'] },
  {
    field: 'aadhaar_number',
    label: 'Aadhaar Number',
    required: true,
    aliases: ['aadhaar number', 'aadhaar', 'aadhar number', 'aadhar', 'adhaar number', 'adhaar'],
  },
  {
    field: 'mobile_number',
    label: 'Mobile Number',
    required: false,
    alternative: 'required unless Primary Mobile Number is given',
    aliases: ['mobile number', 'mobile', 'mobile no'],
  },
  {
    field: 'primary_mobile_number',
    label: 'Primary Mobile Number (used before Mobile Number)',
    required: false,
    aliases: ['primary mobile number', 'primary mobile', 'registered mobile number'],
    template: false,
  },
  {
    field: 'alternate_mobile_number',
    label: 'Alternate Mobile Number',
    required: false,
    aliases: ['alternate mobile number', 'alternate mobile', 'alternative mobile number', 'alternate number'],
  },
  {
    field: 'alternate_email',
    label: 'Alternate Email',
    required: false,
    aliases: ['alternate email', 'alternate email id', 'alernate email', 'alternative email'],
  },
  { field: 'religion', label: 'Religion', required: true, aliases: ['religion'] },
  { field: 'caste', label: 'Caste', required: true, aliases: ['caste'] },
  {
    field: 'disability_status',
    label: 'Disabled person (Yes/No)',
    required: false,
    aliases: ['are you a disabled person', 'disability', 'disabled', 'disability status', 'person with disability'],
  },
  {
    field: 'disability_type',
    label: 'Disability type',
    required: false,
    aliases: ['specify disability if applicable', 'disability type', 'type of disability', 'specify disability'],
  },
  {
    field: 'disability_certificate_number',
    label: 'Disability certificate number',
    required: false,
    aliases: ['disability certificate number', 'disability certificate no', 'udid number'],
  },
  {
    field: 'course_centre',
    label: 'Course Centre',
    required: false,
    alternative: 'required unless District is given',
    aliases: ['course centre', 'course center', 'centre', 'center'],
  },
  {
    field: 'technology',
    label: 'Technology / Third Module Selection',
    required: true,
    aliases: [
      'technology',
      'technology / third module selection',
      'third module selection',
      'track',
      'course type',
      'course name',
      'course',
    ],
  },
  {
    field: 'education_qualification',
    label: 'Education Qualification',
    required: true,
    aliases: ['education qualification', 'qualification', 'educational qualification', 'highest qualification'],
  },
  {
    field: 'qualification_name',
    label: 'Name of Qualification',
    required: false,
    aliases: ['name of qualification', 'qualification name'],
  },
  {
    field: 'qualification_stream',
    label: 'Subject / Stream / Branch',
    required: false,
    aliases: ['subject/stream/branch', 'stream', 'branch', 'subject', 'specialisation', 'specialization'],
  },
  {
    field: 'qualification_board',
    label: 'Board / University Name',
    required: false,
    aliases: ['board / university name', 'board/university', 'board', 'university', 'university name', 'board name'],
  },
  {
    field: 'qualification_completed_on',
    label: 'Date of Qualification Completion (YYYY-MM-DD)',
    required: false,
    aliases: ['date of qualification completion', 'qualification completion date', 'completion date', 'passing date', 'date of passing'],
  },
  {
    field: 'score',
    label: 'Percentage / CGPA',
    required: false,
    aliases: ['percentage / cgpa', 'percentage', 'cgpa', 'score', 'marks', 'percentage/cgpa'],
  },
  { field: 'qualification_class', label: 'Class / Grade', required: false, aliases: ['class / grade', 'class', 'grade', 'class/grade'] },
  {
    field: 'approval_status',
    label: 'Approval status',
    required: true,
    aliases: ['approval status', 'external status', 'status', 'application status'],
  },
  {
    field: 'approved_at',
    label: 'Approved at (ISO date-time)',
    required: false,
    alternative: 'for an approved row: required unless Last Updated is given',
    aliases: ['approved at', 'approval date', 'approved on'],
  },
  { field: 'scheme_name', label: 'Scheme name', required: false, aliases: ['scheme name', 'scheme'] },
  {
    field: 'submitted_at',
    label: 'Submitted at (source date-time)',
    required: false,
    aliases: ['submission date', 'submitted at', 'submitted on', 'application date', 'date of submission'],
  },
  {
    field: 'source_updated_at',
    label: 'Last updated at (source date-time; the approval date of an approved row without Approved at)',
    required: false,
    aliases: ['last updated', 'last updated at', 'updated at', 'updated on', 'last modified'],
  },
  { field: 'source_remarks', label: 'Source remarks', required: false, aliases: ['remarks', 'remark', 'comments', 'approver remarks'] },
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

/*
 * Columns required in one of several forms: the file must contain every field of at least one option. The message
 * names the group when none is present.
 */
export const REQUIRED_COLUMN_GROUPS: { label: string; anyOf: string[][] }[] = [
  { label: 'First Name and Last Name (or Full Name)', anyOf: [['first_name', 'last_name'], ['full_name'], ['applicant_name']] },
  { label: 'Mobile Number (or Primary Mobile Number)', anyOf: [['mobile_number'], ['primary_mobile_number']] },
  { label: 'Course Centre (or District)', anyOf: [['course_centre'], ['district'], ['address_district']] },
];

/* Columns recognised but ignored in Version 1.0 (presence is logged on the batch). */
export const IGNORED_COLUMNS = ['caste description'];

/*
 * Any other column is kept, as supplied, in the student's other source values (nothing in the file is lost) — except
 * a column whose header looks like an identity number: those are never stored outside the protected Aadhaar fields.
 */
export const SENSITIVE_COLUMN_RE = /a+d+h?a+r|\buid\b|\bpan\s*(no|number|card)\b|passport|password|\botp\b/i;

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
  NOT_APPROVED: {
    waivable: true,
    label: 'Not yet approved at the source (if accepted, the student is added as pending approval, not eligible for a batch)',
  },
  FORMAT_INVALID: { waivable: true, label: 'Value has an invalid format (if accepted, the field is left empty; the value is kept)' },
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

/*
 * students.status: RECEIVED = finalised from an approved import; REGISTRATION_PENDING = awaiting approval: a public
 * registration, or an imported application the source had not approved yet (NOT_APPROVED accepted by a reviewer).
 */
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
