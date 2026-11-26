/*
 * Fixed values of the Form Field Configuration master (AMRUT_KALASH_03 L-38 / FR-338, F-LMS-FFC), each in
 * ONE place. The rows themselves (which field is visible, compulsory, at which stage…) are data in
 * lms_form_fields, changed at run time without a software change (BR-022, AD-12).
 */

/*
 * Forms registered as configurable (F-LMS-FFC-01). L-38: "In LMS Admin the configurable form is the Trainer
 * Profile (form code TRAINER_PROFILE); the Training Centre Profile is configured in the Admin Panel. Further
 * forms can be registered as configurable without redesign" — registering one is a new entry here plus the
 * migration seeding its standard fields; the table's CHECK only fixes the code's shape.
 *
 * Sections (F-LMS-FFC-08 "Sections of the form (A to H / verification); custom sections allowed"), in the
 * order the form shows them: F-LMS-TRN, sections A–H and sign-off.
 */
export const LMS_CONFIGURABLE_FORMS = [
  {
    code: 'TRAINER_PROFILE',
    label: 'Trainer Profile',
    specRef: 'F-LMS-TRN',
    sections: [
      { code: 'A', label: 'Basic personal details' },
      { code: 'B', label: 'Educational qualification' },
      { code: 'C', label: 'Technology expertise' },
      { code: 'D', label: 'Experience' },
      { code: 'E', label: 'Projects / implementation exposure' },
      { code: 'F', label: 'SARTHI responsibilities' },
      { code: 'G', label: 'Trainer competency snapshot' },
      { code: 'H', label: 'Professional summary' },
      { code: 'VERIFICATION', label: 'Verification and sign-off' },
    ],
  },
] as const;

export type LmsFormCode = (typeof LMS_CONFIGURABLE_FORMS)[number]['code'];
export const LMS_FORM_CODES = LMS_CONFIGURABLE_FORMS.map((f) => f.code) as [LmsFormCode, ...LmsFormCode[]];

export type LmsConfigurableForm = (typeof LMS_CONFIGURABLE_FORMS)[number];
export const findForm = (code: string): LmsConfigurableForm | undefined => LMS_CONFIGURABLE_FORMS.find((f) => f.code === code);

/* Shapes, repeated by the table's CHECK constraints. */
export const FORM_CODE_PATTERN = /^[A-Z][A-Z0-9_]{1,39}$/;
/* A custom section: upper-case code (F-LMS-FFC-08 "custom sections allowed"). */
export const SECTION_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,39}$/;
/* The key a value is stored under (trainer.custom_fields{} for custom fields, the API field otherwise). */
export const FIELD_CODE_PATTERN = /^[a-z][a-z0-9_]{1,59}$/;

/*
 * Data types a custom field can have (F-LMS-FFC-07): text, long text, number, date, yes / no, single choice,
 * multiple choice, file.
 */
export const CUSTOM_FIELD_TYPES = ['TEXT', 'LONG_TEXT', 'NUMBER', 'DATE', 'YES_NO', 'SINGLE_CHOICE', 'MULTIPLE_CHOICE', 'FILE'] as const;
export type CustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number];

/*
 * Controls of the standard fields only (F-LMS-TRN Table 39 "Type · control"): fixed by the application's
 * field catalogue, never chosen here.
 */
export const STANDARD_ONLY_FIELD_TYPES = [
  'EMAIL', 'PHONE', 'IMAGE', 'TEXT_ARRAY', 'REFERENCE', 'REFERENCE_ARRAY', 'REPEATING_GROUP', 'ENUM_ARRAY', 'GRID', 'SIGN_OFF',
] as const;

export const ALL_FIELD_TYPES = [...CUSTOM_FIELD_TYPES, ...STANDARD_ONLY_FIELD_TYPES] as const;
export type FieldDataType = (typeof ALL_FIELD_TYPES)[number];

export const CHOICE_FIELD_TYPES: readonly FieldDataType[] = ['SINGLE_CHOICE', 'MULTIPLE_CHOICE'];
export const isChoiceType = (t: string): boolean => (CHOICE_FIELD_TYPES as readonly string[]).includes(t);

/* F-LMS-FFC-07 default for a custom field. */
export const DEFAULT_CUSTOM_FIELD_TYPE: CustomFieldType = 'TEXT';

/* F-LMS-FFC-07 "file (PDF / JPG / JPEG / PNG, ≤ 5 MB)": fixed by the spec, not configurable per field. */
export const FILE_FIELD_CONSTRAINTS = {
  extensions: ['pdf', 'jpg', 'jpeg', 'png'],
  mimeTypes: ['application/pdf', 'image/jpeg', 'image/png'],
  maxBytes: 5 * 1024 * 1024,
} as const;

/*
 * F-LMS-FFC-06: when a compulsory rule applies. ON_SAVE = every save; ON_VERIFICATION = only when the profile
 * is submitted for verification / marked READY or ACTIVE. Drafts can always be saved. Default ON_VERIFICATION.
 */
export const REQUIRED_STAGES = ['ON_SAVE', 'ON_VERIFICATION'] as const;
export type RequiredStage = (typeof REQUIRED_STAGES)[number];
export const DEFAULT_REQUIRED_STAGE: RequiredStage = 'ON_VERIFICATION';

/* F-LMS-FFC-09: Internal, Personal, Restricted (default Internal; exportable by default). */
export const FIELD_SENSITIVITIES = ['INTERNAL', 'PERSONAL', 'RESTRICTED'] as const;
export type FieldSensitivity = (typeof FIELD_SENSITIVITIES)[number];
export const DEFAULT_SENSITIVITY: FieldSensitivity = 'INTERNAL';

/* F-LMS-FFC-03: label ≤ 80, help text ≤ 200 (per language). */
export const LABEL_MAX = 80;
export const HELP_TEXT_MAX = 200;

/* Option list of a choice field: input bounds of the option editor (the spec gives no count). */
export const OPTION_MAX_LENGTH = 80;
export const OPTIONS_MAX = 100;

/*
 * Upper bound of the length / number rules an administrator types. A technical input bound so a rule
 * cannot be absurd; it is not a business limit (the spec sets none for custom fields).
 */
export const RULE_LENGTH_MAX = 10_000;
export const RULE_PATTERN_MAX = 200;
