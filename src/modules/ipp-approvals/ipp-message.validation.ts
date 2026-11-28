import { z } from 'zod';
import { isoDate, uuid } from '../../shared/validation/common.validation';
import { storable } from './ipp-text';

/*
 * A message of IPP (contract ipp_backend/docs/SARTHI_LINK.md section 2). Keys Sarthi does not know are left out, so IPP
 * may add some. Messages of the validator never repeat a value: the answer of a refused call is kept by IPP.
 */

const text = (max: number) =>
  z
    .string()
    .transform(storable)
    .pipe(z.string().max(max, `Must be at most ${max} characters`));
const required = (max: number) =>
  z
    .string()
    .transform((v) => storable(v).trim())
    .pipe(z.string().min(1, 'Required').max(max, `Must be at most ${max} characters`));
/* Absent, null and blank all mean "none". */
const optional = (max: number) =>
  text(max)
    .nullish()
    .transform((v) => v?.trim() || null);
const oneOf = <T extends readonly [string, ...string[]]>(values: T) =>
  z.enum(values, { errorMap: () => ({ message: `One of ${values.join(', ')}` }) });

/* A moment, as ISO text. */
const moment = z
  .string()
  .max(40)
  .refine((v) => /^\d{4}-\d{2}-\d{2}/.test(v) && !Number.isNaN(Date.parse(v)), 'Enter a date and time as ISO 8601')
  .transform((v) => new Date(v).toISOString());
const optionalMoment = moment.nullish().transform((v) => v ?? null);

/* The last four digits and nothing else of the Aadhaar number; stored as XXXX-XXXX-1234. */
const aadhaarMasked = z
  .string()
  .regex(/^[Xx*]{4}[- ]?[Xx*]{4}[- ]?\d{4}$/, 'Only the masked form XXXX-XXXX-1234 is accepted')
  .transform((v) => `XXXX-XXXX-${v.slice(-4)}`)
  .nullish()
  .transform((v) => v ?? null);

const batchSchema = z.object({
  id: required(64),
  code: required(40),
  name: required(200),
  size: z.number().int().min(0).max(100_000),
  district: z.object({ code: required(40), name: required(200), state_code: optional(20) }),
  centre: z.object({ code: required(60), name: required(200) }),
  start_date: isoDate.nullish().transform((v) => v ?? null),
  end_date: isoDate.nullish().transform((v) => v ?? null),
  delivery_mode: oneOf(['OFFLINE', 'ONLINE', 'BLENDED']),
  technology: z
    .object({ code: required(60), name: required(200) })
    .nullish()
    .transform((v) => v ?? null),
  created_at: moment,
  created_by: optional(200),
  /*
   * Where the batch is (the Auditor starts and ends it). An IPP that predates it sends none: not started. A status that
   * does not agree with its times is refused.
   */
  status: oneOf(['NOT_STARTED', 'ONGOING', 'ENDED'])
    .nullish()
    .transform((v) => v ?? 'NOT_STARTED'),
  started_at: optionalMoment,
  ended_at: optionalMoment,
}).refine(
  (b) =>
    b.status === 'NOT_STARTED'
      ? !b.started_at && !b.ended_at
      : b.status === 'ONGOING'
        ? !!b.started_at && !b.ended_at
        : !!b.started_at && !!b.ended_at,
  { message: 'status must agree with started_at and ended_at', path: ['status'] },
);

const documentSchema = z.object({
  code: required(100),
  name: text(300),
  name_mr: optional(300),
  required: z.boolean(),
  kind: oneOf(['DOCUMENT', 'VIDEO']),
  file: z
    .object({ name: text(300), mime: text(150), size: z.number().int().min(0), uploaded_at: moment })
    .nullish()
    .transform((v) => v ?? null),
  verified: z.boolean(),
  verified_at: optionalMoment,
  verified_by: optional(200),
});

const applicationSchema = z.object({
  action: oneOf(['SUBMIT', 'RESUBMIT', 'UPDATE']),
  id: uuid.transform((v) => v.toLowerCase()),
  registration_id: required(40),
  registration_number: optional(60),
  name: required(200),
  email: text(254),
  mobile_number: text(30),
  aadhaar_masked: aadhaarMasked,
  district: optional(200),
  category: optional(200),
  centre: optional(200),
  technology: optional(200),
  submitted_at: moment,
  auditor_approved_at: optionalMoment,
  auditor_approved_by: optional(200),
  /* Why the Auditor approved it (IPP sends it since approval reasons; an older IPP does not): kept when 3–500 characters. */
  auditor_approval_reason: optional(500).transform((v) => (v && [...v].length >= 3 ? v : null)),
  fields: z
    .array(
      z.object({
        key: text(150),
        step: z.union([z.literal(1), z.literal(2)], { errorMap: () => ({ message: '1 or 2' }) }),
        label_en: text(500),
        label_mr: text(500),
        type: text(60),
        text: text(20_000),
      }),
    )
    .max(500),
  documents: z.array(documentSchema).max(200),
  edits: z
    .array(
      z.object({
        at: moment,
        by: optional(200),
        changes: z.array(z.object({ key: text(150), label: text(500), from: text(20_000), to: text(20_000) })).max(500),
      }),
    )
    .max(50),
});

export const ippMessageSchema = z.object({
  id: uuid.transform((v) => v.toLowerCase()),
  seq: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  sent_at: moment,
  batch: batchSchema,
  applications: z
    .array(applicationSchema)
    .max(100)
    .refine((list) => new Set(list.map((a) => a.id)).size === list.length, 'An application may be in a message only once'),
});

export type IppMessageInput = z.infer<typeof ippMessageSchema>;
export type IppMessageBatch = IppMessageInput['batch'];
export type IppMessageApplication = IppMessageInput['applications'][number];

/* A refused message says where, and no more than this many times. */
export const MESSAGE_ISSUES_MAX = 20;
