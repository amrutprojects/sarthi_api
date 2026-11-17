import { z } from 'zod';
import { listQuerySchema } from '../../../shared/utils/pagination';
import { barcodeMap } from '../registration/registration-admin.validation';
import { personName, registrationBody, text } from '../registration/registration.validation';
import { TRACKS } from '../student.constants';
import { uuid } from '../../../shared/validation/common.validation';
import {
  EDP_ADMIN_ROLES,
  EDP_BASIC_FIELDS,
  EDP_CGPA_SCALES,
  EDP_GENDERS,
  EDP_GRADING_TYPES,
  EDP_MARITAL_STATUSES,
  EDP_QUALIFICATION_CLASSES,
  EDP_YES_NO,
  EDP_FOLLOW_UP_NOTE_MAX,
  EDP_FOLLOW_UP_STATUS,
  EDP_HELP_FIELDS,
  EDP_FORM_FIELDS,
  EDP_MAIN_FIELDS,
  EDP_STAGES,
  type EdpFollowUpStatus,
  type EdpStage,
} from './edp.constants';

const pick = <K extends string>(keys: readonly K[]) => Object.fromEntries(keys.map((k) => [k, true])) as { [P in K]: true };

const email = z
  .string({ required_error: 'Email is required', invalid_type_error: 'Email must be text' })
  .trim()
  .toLowerCase()
  .min(1, 'Email is required')
  .max(254, 'Email must be at most 254 characters')
  .email('Enter a valid email address');

/* Portal password: 8–72 characters (bcrypt's limit) with at least one letter and one digit. */
const password = z
  .string({ required_error: 'Password is required', invalid_type_error: 'Password must be text' })
  .min(8, 'Password must be at least 8 characters')
  .max(72, 'Password must be at most 72 characters')
  .regex(/[A-Za-z]/, 'Password must contain a letter')
  .regex(/[0-9]/, 'Password must contain a digit');

const confirmPassword = z.string({ required_error: 'Please re-enter the password' }).min(1, 'Please re-enter the password');
const passwordsMatch = (v: { password: string; confirm_password: string }, ctx: z.RefinementCtx) => {
  if (v.password !== v.confirm_password)
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['confirm_password'], message: 'Passwords do not match' });
};

export const signupBody = z
  .object({
    first_name: personName('First name', 100),
    middle_name: z
      .string({ invalid_type_error: 'Middle name must be text' })
      .trim()
      .max(100, 'Middle name must be at most 100 characters')
      .refine((v) => !v || /^[\p{L}\p{M}][\p{L}\p{M} .'-]*$/u.test(v), "Middle name may contain only letters, spaces and . ' -")
      .optional(),
    last_name: personName('Last name', 100),
    email,
    mobile_number: registrationBody.shape.mobile_number,
    password,
    confirm_password: confirmPassword,
  })
  .strict()
  .superRefine(passwordsMatch);
export type SignupBody = z.infer<typeof signupBody>;

/* The token of an emailed password reset link; whether it is valid is the database's answer, not its form's. */
const resetToken = z
  .string({ required_error: 'The password reset link is incomplete', invalid_type_error: 'The password reset link is incomplete' })
  .trim()
  .min(1, 'The password reset link is incomplete')
  .max(200, 'This password reset link is not valid');
export const resetTokenBody = z.object({ token: resetToken }).strict();
/* A new password from a reset link: the sign-up's password rules. */
export const resetPasswordBody = z
  .object({ token: resetToken, password, confirm_password: confirmPassword })
  .strict()
  .superRefine(passwordsMatch);
export type ResetPasswordBody = z.infer<typeof resetPasswordBody>;

/* The emailed code, with the password chosen at sign-up (the code proves the inbox, the password who signed up). */
export const otpBody = z
  .object({
    email,
    otp: z
      .string({ required_error: 'OTP is required' })
      .trim()
      .regex(/^\d{6}$/, 'Enter the 6-digit OTP'),
    password: z.string({ required_error: 'Password is required' }).min(1, 'Password is required').max(200),
  })
  .strict();
export const emailBody = z.object({ email }).strict();
export const loginBody = z
  .object({ email, password: z.string({ required_error: 'Password is required' }).min(1, 'Password is required').max(200) })
  .strict();

/* The portal's own fields. Values arrive as strings (the draft is JSON); an optional one may be '' (= not given). */
const req = (label: string) => ({ required_error: `${label} is required`, invalid_type_error: `${label} must be text` });
const oneOf = (label: string, values: readonly string[]) =>
  z
    .string(req(label))
    .trim()
    .refine(
      (v) => values.includes(v),
      (v) => ({ message: v ? `Select a valid ${label.toLowerCase()}` : `${label} is required` }),
    );
const id = (label: string) => z.string(req(label)).trim().min(1, `${label} is required`).pipe(uuid);
const optionalString = (label: string, max: number) =>
  z
    .string({ invalid_type_error: `${label} must be text` })
    .trim()
    .max(max, `${label} must be at most ${max} characters`)
    .optional();

/* As registrationBody's mobile_number: +91 / 0 prefix, spaces, dashes and brackets allowed, then 10 digits starting 6–9. */
export const normaliseMobile = (v: string) =>
  v
    .replace(/[\s()-]/g, '')
    .replace(/^\+?91(?=\d{10}$)/, '')
    .replace(/^0(?=\d{10}$)/, '');
const MOBILE_RE = /^[6-9]\d{9}$/;

/* A real calendar date, YYYY-MM-DD, not in the future. */
function pastDate(label: string) {
  return z
    .string(req(label))
    .trim()
    .min(1, `${label} is required`)
    .superRefine((v, ctx) => {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
      if (!m) return ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${label} must be in YYYY-MM-DD format` });
      const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
      if (d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3])
        return ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${label} is not a real date` });
      if (+m[1] < 1940) return ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${label} is too far in the past` });
      if (d.getTime() > Date.now()) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${label} cannot be in the future` });
    });
}

const basicExtra = z.object({
  gender: oneOf('Gender', EDP_GENDERS),
  marital_status: oneOf('Marital status', EDP_MARITAL_STATUSES),
  permanent_address: text('Permanent address', 500),
  landmark: optionalString('Landmark', 150),
  district_id: id('District'),
  taluka_id: id('Taluka'),
  pin_code: z
    .string(req('PIN code'))
    .trim()
    .min(1, 'PIN code is required')
    .regex(/^[1-9]\d{5}$/, 'PIN code must be exactly 6 digits'),
  alternate_mobile_number: optionalString('Alternate mobile number', 20).refine(
    (v) => !v || MOBILE_RE.test(normaliseMobile(v)),
    'Alternate mobile number must be a 10-digit Indian number starting 6–9',
  ),
  alternate_email: optionalString('Alternate email', 254).refine(
    (v) => !v || z.string().email().safeParse(v).success,
    'Enter a valid alternate email address',
  ),
  disability_status: oneOf('Disability status', EDP_YES_NO),
  disability_type: optionalString('Disability type', 100),
  disability_certificate_number: optionalString('Disability certificate number', 50),
});

/* Rules across fields of step 1: details required only when they apply; alternates must differ from the primary ones. */
function basicRules(v: z.infer<typeof basicExtra> & { mobile_number?: string; email?: string }, ctx: z.RefinementCtx) {
  const issue = (path: string, message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
  if (v.disability_status === 'Yes') {
    if (!v.disability_type) issue('disability_type', 'Disability type is required');
    if (!v.disability_certificate_number) issue('disability_certificate_number', 'Disability certificate number is required');
    else if (!/^[A-Za-z0-9/-]{4,50}$/.test(v.disability_certificate_number))
      issue('disability_certificate_number', 'Certificate number may contain only letters, digits, / and - (4–50 characters)');
  }
  if (v.alternate_mobile_number && v.mobile_number && normaliseMobile(v.alternate_mobile_number) === normaliseMobile(v.mobile_number))
    issue('alternate_mobile_number', 'Alternate mobile number must be different from the mobile number');
  if (v.alternate_email && v.email && v.alternate_email.toLowerCase() === v.email.toLowerCase())
    issue('alternate_email', 'Alternate email must be different from the email address');
}

const SCORE_RE = /^\d{1,3}(\.\d{1,2})?$/;
const mainExtra = z.object({
  centre_id: id('Center name'),
  qualification_name: text('Name of qualification', 150),
  qualification_stream: text('Subject / stream / branch', 150),
  qualification_board: text('Board / university name', 200),
  qualification_completed_on: pastDate('Date of qualification completion'),
  grading_type: oneOf(
    'Grading type',
    EDP_GRADING_TYPES.map((g) => g.code),
  ),
  cgpa_scale: z.string({ invalid_type_error: 'CGPA scale must be text' }).trim().optional(),
  score: z
    .string(req('Percentage / CGPA'))
    .trim()
    .min(1, 'Percentage / CGPA is required')
    .regex(SCORE_RE, 'Enter a number with at most 2 decimal places'),
  qualification_class: oneOf('Class / grade', EDP_QUALIFICATION_CLASSES),
});

/* The score's range depends on the grading type: 0–100 for a percentage, 0–scale for a CGPA. */
function mainRules(v: z.infer<typeof mainExtra>, ctx: z.RefinementCtx) {
  const issue = (path: string, message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
  const score = Number(v.score);
  if (v.grading_type === 'PERCENTAGE' && SCORE_RE.test(v.score) && score > 100) issue('score', 'Percentage must be between 0 and 100');
  if (v.grading_type === 'CGPA') {
    const scale = Number(v.cgpa_scale);
    if (!v.cgpa_scale) issue('cgpa_scale', 'CGPA scale is required');
    else if (!(EDP_CGPA_SCALES as readonly number[]).includes(scale)) issue('cgpa_scale', 'Select a valid CGPA scale');
    else if (SCORE_RE.test(v.score) && score > scale) issue('score', `CGPA must be between 0 and ${scale}`);
  }
}

/* Step 1 (Basic Details) and step 2 (Main Form): the admin form's fields and rules plus the portal's own; technology is a track code. */
const basicObject = registrationBody.pick(pick(EDP_BASIC_FIELDS)).merge(basicExtra).strict();
const mainObject = registrationBody
  .pick(pick(EDP_MAIN_FIELDS))
  .extend({
    technology: z
      .string({ required_error: 'Technology is required' })
      .trim()
      .refine((v) => TRACKS.some((t) => t.code === v), 'Select a technology from the list'),
  })
  .merge(mainExtra)
  .strict();
export const basicStep = basicObject.superRefine(basicRules);
export const mainStep = mainObject.superRefine(mainRules);
export const fullForm = basicObject
  .merge(mainObject)
  .strict()
  .superRefine((v, ctx) => {
    basicRules(v, ctx);
    mainRules(v, ctx);
  });
export type EdpForm = z.infer<typeof fullForm>;
export const EDP_REGISTRATION_FIELDS = Object.keys(registrationBody.shape) as (keyof typeof registrationBody.shape)[];

export const stepParams = z.object({ step: z.enum(['1', '2', '3']).transform(Number) });
/*
 * A step's values. complete=false saves them as typed (resume later, no checks beyond size); complete=true checks the
 * step as the admin form does and moves the application on to the next step. Step 3 carries the barcodes.
 */
export const saveStepBody = z
  .object({
    complete: z.boolean().default(false),
    data: z.record(z.string().max(600, 'Value is too long')).refine((d) => Object.keys(d).length <= 40, 'Too many values'),
  })
  .strict();
export type SaveStepBody = z.infer<typeof saveStepBody>;
export const FORM_FIELD_SET = new Set<string>(EDP_FORM_FIELDS);

export const docTypeParams = z.object({ docType: z.string().regex(/^[A-Za-z0-9_]{1,40}$/, 'Unknown document type') });
/* ?download=1: send the file as a download (attachment) instead of opening it. */
export const fileDownloadQuery = z.object({ download: z.enum(['0', '1']).optional() });

/* Final submission (once; it cannot be changed afterwards): the declaration, plus barcodes per document type code. */
export const submitBody = z
  .object({
    declaration_accepted: z.literal(true, { errorMap: () => ({ message: 'The declaration must be accepted' }) }),
    barcodes: barcodeMap.optional(),
  })
  .strict();
export type SubmitBody = z.infer<typeof submitBody>;

const FOLLOW_UP_CODES = Object.keys(EDP_FOLLOW_UP_STATUS) as [EdpFollowUpStatus, ...EdpFollowUpStatus[]];

export const manageListQuery = listQuerySchema(['createdAt'] as const).extend({
  stage: z.enum(Object.keys(EDP_STAGES) as [EdpStage, ...EdpStage[]]).optional(),
  /* Current follow-up status; NONE = not followed up yet. */
  follow_up: z.enum([...FOLLOW_UP_CODES, 'NONE']).optional(),
});
export type ManageListQuery = z.infer<typeof manageListQuery>;

export const applicantParams = z.object({ id: uuid });

/* A tracking panel user added by an ADMIN: name, sign-in email, a password with the portal's rules, and the role. */
export const newUserBody = z
  .object({
    name: z
      .string({ required_error: 'Name is required', invalid_type_error: 'Name must be text' })
      .trim()
      .min(2, 'Name must be at least 2 characters')
      .max(150, 'Name must be at most 150 characters'),
    email,
    password,
    role: z.enum(EDP_ADMIN_ROLES, { errorMap: () => ({ message: 'Choose Admin or Viewer' }) }),
  })
  .strict();
export type NewUserBody = z.infer<typeof newUserBody>;
/* The support contact line: the message (may use {email} and {mobile}), the email and the mobile number. */
const blankToNull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v);
export const supportBody = z
  .object({
    message: z
      .string({ required_error: 'Message is required', invalid_type_error: 'Message must be text' })
      .trim()
      .min(10, 'Message must be at least 10 characters')
      .max(500, 'Message must be at most 500 characters'),
    email: z.preprocess(blankToNull, z.string().trim().toLowerCase().email('Enter a valid email address').max(254).nullable().optional()),
    mobile: z.preprocess(
      blankToNull,
      z
        .string()
        .trim()
        .regex(/^\+?\d[\d ()-]{5,18}\d$/, 'Enter a valid phone number, e.g. 8530092236 or +91 85300 92236')
        .nullable()
        .optional(),
    ),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.message.includes('{email}') && !v.email)
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['email'], message: 'Email is required because the message uses {email}' });
    if (v.message.includes('{mobile}') && !v.mobile)
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['mobile'], message: 'Mobile is required because the message uses {mobile}' });
  });
export type SupportBody = z.infer<typeof supportBody>;
export const userStatusBody = z.object({ is_active: z.boolean({ required_error: 'is_active is required' }) }).strict();
/*
 * Control characters other than tab and line breaks (as src/cms/hero/hero.validator.ts): PostgreSQL refuses NUL
 * outright, which would otherwise be a 500 instead of a 422 naming the field. A function: no-control-regex forbids a regex.
 */
const hasControlChars = (v: string) =>
  [...v].some((ch) => {
    const c = ch.codePointAt(0) ?? 0;
    return (c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d) || (c >= 0x7f && c <= 0x9f);
  });
export const followUpBody = z
  .object({
    status: z.enum(FOLLOW_UP_CODES, { errorMap: () => ({ message: 'Choose a follow-up status' }) }),
    note: z
      .string({ invalid_type_error: 'Note must be text' })
      .trim()
      .max(EDP_FOLLOW_UP_NOTE_MAX, `Note must be at most ${EDP_FOLLOW_UP_NOTE_MAX} characters`)
      .refine((v) => !hasControlChars(v), 'Note contains characters that cannot be saved')
      .optional(),
  })
  .strict();
export type FollowUpBody = z.infer<typeof followUpBody>;

/* Text an admin writes for the portal: trimmed, free of characters PostgreSQL cannot store. */
const content = (label: string, max: number, min = 0) =>
  z
    .string({ required_error: `${label} is required`, invalid_type_error: `${label} must be text` })
    .trim()
    .min(min, min <= 1 ? `${label} is required` : `${label} must be at least ${min} characters`)
    .max(max, `${label} must be at most ${max} characters`)
    .refine((v) => !hasControlChars(v), `${label} contains characters that cannot be saved`);

/*
 * The congratulations dialog shown once the account is created. `enabled` false keeps the text but stops showing it;
 * a blank button_label leaves the portal's own (translated) button text in place.
 */
export const welcomeBody = z
  .object({
    enabled: z.boolean({ invalid_type_error: 'enabled must be true or false' }).optional().default(true),
    title: content('Title', 120, 3),
    message: content('Message', 1000, 10),
    button_label: content('Button label', 60).optional().default(''),
  })
  .strict();
export type WelcomeBody = z.infer<typeof welcomeBody>;

/*
 * The Help button: a heading, an optional line of introduction and up to EDP_HELP_FIELDS name / value lines (Contact
 * Number, Email ID, …). A line needs both halves; blank lines are dropped, so the panel is saved with what it shows.
 */
const helpField = z
  .object({ label: content('Field name', 60).optional().default(''), value: content('Value', 200).optional().default('') })
  .strict();
export const helpBody = z
  .object({
    enabled: z.boolean({ invalid_type_error: 'enabled must be true or false' }).optional().default(true),
    title: content('Title', 120, 2).optional().default('Need help?'),
    intro: content('Intro', 300).optional().default(''),
    fields: z.array(helpField).max(EDP_HELP_FIELDS, `At most ${EDP_HELP_FIELDS} fields can be shown`).optional().default([]),
  })
  .strict()
  .superRefine((v, ctx) => {
    v.fields.forEach((f, i) => {
      if (f.value && !f.label)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['fields', i, 'label'],
          message: 'Field name is required when a value is given',
        });
      if (f.label && !f.value)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['fields', i, 'value'],
          message: 'Value is required when a field name is given',
        });
    });
    if (v.enabled && !v.fields.some((f) => f.label && f.value))
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['fields'], message: 'Add at least one contact detail to show in the Help panel' });
  });
export type HelpBody = z.infer<typeof helpBody>;
