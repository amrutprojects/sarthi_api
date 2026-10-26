import { z } from 'zod';
import { listQuerySchema } from '../../../shared/utils/pagination';
import { barcodeMap } from '../registration/registration-admin.validation';
import { personName, registrationBody } from '../registration/registration.validation';
import { TRACKS } from '../student.constants';
import { uuid } from '../../../shared/validation/common.validation';
import {
  EDP_BASIC_FIELDS,
  EDP_FOLLOW_UP_NOTE_MAX,
  EDP_FOLLOW_UP_STATUS,
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

/* Step 1 (Basic Details) and step 2 (Main Form): the admin form's fields and rules; technology is a track code. */
export const basicStep = registrationBody.pick(pick(EDP_BASIC_FIELDS)).strict();
export const mainStep = registrationBody
  .pick(pick(EDP_MAIN_FIELDS))
  .extend({
    technology: z
      .string({ required_error: 'Technology is required' })
      .trim()
      .refine((v) => TRACKS.some((t) => t.code === v), 'Select a technology from the list'),
  })
  .strict();
export const fullForm = basicStep.merge(mainStep).strict();
export type EdpForm = z.infer<typeof fullForm>;

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
