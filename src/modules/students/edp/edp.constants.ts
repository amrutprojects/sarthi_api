/* ENTREPRENEURSHIP DEVELOPMENT PROGRAM (EDP) portal, edp.sumago.ai. */
export const EDP_PROGRAM_NAME = 'ENTREPRENEURSHIP DEVELOPMENT PROGRAM';
export const EDP_ORGANISATION = 'Sumago Infotech Pvt. Ltd.';

/* A form is submitted once and is final: it cannot be edited or resubmitted afterwards. */
export const EDP_APPLICATION_STATUS = {
  DRAFT: 'DRAFT',
  SUBMITTED: 'SUBMITTED',
} as const;
export type EdpApplicationStatus = (typeof EDP_APPLICATION_STATUS)[keyof typeof EDP_APPLICATION_STATUS];

/* Where a student stands, as the tracking panel shows it (derived, not stored). */
export const EDP_STAGES = {
  OTP_PENDING: 'Account created – OTP not verified',
  VERIFIED: 'OTP verified – form not started',
  BASIC_DONE: 'Step 1 filled (Basic Details)',
  MAIN_DONE: 'Step 2 filled (Main Form)',
  SUBMITTED: 'Form submitted',
} as const;
export type EdpStage = keyof typeof EDP_STAGES;

/* Follow-up statuses the EDP team records in the tracking panel (each with an optional note). */
export const EDP_FOLLOW_UP_STATUS = {
  PENDING: 'Pending follow-up',
  CALLED: 'Follow-up call',
  SECOND_CALL: 'Second follow-up',
  FORM_FILLED: 'Form filled',
} as const;
export type EdpFollowUpStatus = keyof typeof EDP_FOLLOW_UP_STATUS;
export const EDP_FOLLOW_UP_NOTE_MAX = 1000;

/* The admin form's three steps (Student Registration): the fields of steps 1 and 2; step 3 is the documents. */
export const EDP_BASIC_FIELDS = [
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
  'caste_id',
] as const;
export const EDP_MAIN_FIELDS = ['region_id', 'technology', 'education_id'] as const;
export const EDP_FORM_FIELDS = [...EDP_BASIC_FIELDS, ...EDP_MAIN_FIELDS] as const;
export type EdpFormField = (typeof EDP_FORM_FIELDS)[number];

/*
 * Document types the EDP portal does not use (Physical Fitness Certificate, Self-Declaration Form). They stay in the
 * Document Types master for the AMRUT admin panel's own form; the portal never lists, requires, accepts or shows them.
 */
export const EDP_EXCLUDED_DOCUMENT_TYPES: readonly string[] = ['FITNESS', 'SELF_DECLARATION'];
export const edpUsesDocumentType = (code: string) => !EDP_EXCLUDED_DOCUMENT_TYPES.includes(code.toUpperCase());

export const EDP_OTP_LENGTH = 6;
/* Wrong codes accepted for one emailed code before a new one must be requested. */
export const EDP_OTP_MAX_ATTEMPTS = 5;
/* Codes one account may be sent per rolling hour. */
export const EDP_OTP_MAX_SENDS_PER_HOUR = 10;

/* The Amrut admin panel user recorded as the uploader of documents that came in through the portal (inactive; cannot sign in). */
export const EDP_SYSTEM_USER = { email: 'edp-portal@system.local', name: 'EDP Portal (system)' } as const;

export const EDP_ERROR_CODES = {
  OTP_INCORRECT: 'OTP_INCORRECT',
  OTP_EXPIRED: 'OTP_EXPIRED',
  OTP_NOT_PENDING: 'OTP_NOT_PENDING',
  OTP_TOO_MANY_ATTEMPTS: 'OTP_TOO_MANY_ATTEMPTS',
  OTP_RESEND_TOO_SOON: 'OTP_RESEND_TOO_SOON',
  EMAIL_NOT_VERIFIED: 'EMAIL_NOT_VERIFIED',
  EMAIL_UNAVAILABLE: 'EMAIL_UNAVAILABLE',
  ALREADY_SUBMITTED: 'ALREADY_SUBMITTED',
  RESET_LINK_INVALID: 'RESET_LINK_INVALID',
  RESET_LINK_EXPIRED: 'RESET_LINK_EXPIRED',
  EMAIL_NOT_REGISTERED: 'EMAIL_NOT_REGISTERED',
  RESET_TOO_SOON: 'RESET_TOO_SOON',
  SIGNUP_PASSWORD_MISMATCH: 'SIGNUP_PASSWORD_MISMATCH',
} as const;

/* Forgot password: how long an emailed reset link works, and the wait before another link is emailed. */
export const EDP_RESET_LINK_MINUTES = 30;
export const EDP_RESET_RESEND_SECONDS = 60;
export const EDP_RESET_MAX_PER_HOUR = 5;

export const EDP_MESSAGES = {
  OTP_SENT: 'An OTP has been sent to your email address',
  OTP_INCORRECT: 'Incorrect OTP',
  OTP_EXPIRED: 'OTP has expired. Please request a new OTP.',
  OTP_NOT_PENDING: 'No OTP is pending for this account. Please request a new OTP.',
  OTP_TOO_MANY_ATTEMPTS: 'Too many incorrect attempts. Please request a new OTP when the current one expires.',
  SIGNUP_PASSWORD_MISMATCH:
    'This is not the password chosen when the account was created. Enter that password, or create the account again.',
  ACCOUNT_EXISTS: 'An account with this email address already exists. Please log in.',
  ACCOUNT_CREATED: 'Account created. Your email address is verified.',
  LOGIN_FAILED: 'Incorrect email or password',
  NOT_VERIFIED: 'Your email address is not verified yet. Enter the OTP sent to your email.',
  EMAIL_UNAVAILABLE: 'Email could not be sent right now. Please try again in a few minutes.',
  ALREADY_SUBMITTED: 'Your form has already been submitted. A submitted form cannot be changed.',
  SUBMITTED: 'Your form has been submitted successfully',
  RESET_LINK_SENT: `A password reset link has been sent to your email ID. The link is valid for ${EDP_RESET_LINK_MINUTES} minutes.`,
  EMAIL_NOT_REGISTERED: 'This email ID is not registered. Kindly check your email ID.',
  RESET_TOO_MANY: 'Too many password reset requests for this email ID. Please try again after an hour.',
  RESET_LINK_INVALID: 'This password reset link is not valid or has already been used. Please request a new link.',
  RESET_LINK_EXPIRED: 'This password reset link has expired. Please request a new link.',
  PASSWORD_CHANGED: 'Your password has been changed. Please log in with your new password.',
  PASSWORD_CHANGED_SIGN_IN: 'Your password was changed. Please log in again.',
} as const;
