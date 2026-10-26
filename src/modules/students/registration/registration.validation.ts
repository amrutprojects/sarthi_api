import { z } from 'zod';
import { uuid } from '../../../shared/validation/common.validation';
import { verhoeffValid } from '../aadhaar';
import { RELIGIONS } from '../student.constants';

/*
 * Request validation for the public registration (422 with one message per field). Unknown keys such as status,
 * approval_status, source_record_id or code are rejected. validateCandidate (shared with the bulk import) runs
 * afterwards in the service and normalises the values; the master ids are checked there against active records
 * (GET /regions/options, /castes/options, /education/options, /document-types/options).
 */
const required = (label: string) => ({
  required_error: `${label} is required`,
  invalid_type_error: `${label} must be text`,
});

/* Trimmed, non-empty text up to `max` characters. */
export const text = (label: string, max: number) =>
  z.string(required(label)).trim().min(1, `${label} is required`).max(max, `${label} must be at most ${max} characters`);

const NAME_RE = /^[\p{L}\p{M}][\p{L}\p{M} .'-]*$/u;
export const personName = (label: string, max: number) =>
  text(label, max).refine((v) => !v || NAME_RE.test(v), `${label} may contain only letters, spaces and . ' -`);

const masterId = (label: string) =>
  z
    .string(required(label))
    .min(1, `${label} is required`)
    .pipe(uuid.describe(`${label} master id (active)`));

/* A real calendar date, YYYY-MM-DD, in the past, for an applicant aged 14 to 100. */
function validDob(v: string, ctx: z.RefinementCtx) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Date of birth must be in YYYY-MM-DD format' });
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3])
    return ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Date of birth is not a real date' });
  const now = new Date();
  const age =
    now.getUTCFullYear() - d.getUTCFullYear() - (now < new Date(Date.UTC(now.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())) ? 1 : 0);
  if (d > now) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Date of birth cannot be in the future' });
  else if (age < 14 || age > 100) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Applicant must be between 14 and 100 years old' });
}

export const registrationBody = z
  .object({
    first_name: personName('First name', 100),
    last_name: personName('Last name', 100),
    father_name: personName('Father name', 150),
    mother_name: personName('Mother name', 150),
    email: text('Email', 254).email('Email address is not valid'),
    date_of_birth: text('Date of birth', 10).superRefine(validDob).describe('YYYY-MM-DD'),
    current_address: text('Current address', 500),
    aadhaar_number: text('Aadhaar number', 20)
      .refine((v) => {
        const d = v.replace(/[\s-]/g, '');
        return /^[2-9]\d{11}$/.test(d) && verhoeffValid(d);
      }, 'Aadhaar number must be 12 digits with a valid checksum')
      .describe('12 digits; spaces or hyphens allowed'),
    mobile_number: text('Mobile number', 20)
      .refine(
        (v) =>
          /^[6-9]\d{9}$/.test(
            v
              .replace(/[\s()-]/g, '')
              .replace(/^\+?91(?=\d{10}$)/, '')
              .replace(/^0(?=\d{10}$)/, ''),
          ),
        'Mobile number must be a 10-digit Indian number starting 6–9',
      )
      .describe('10-digit Indian mobile; +91 / 0 prefix allowed'),
    religion: text('Religion', 60).refine((v) => RELIGIONS.includes(v.normalize('NFC')), 'Religion is not in the reference list'),
    caste_id: masterId('Caste'),
    region_id: masterId('Region (course centre)'),
    technology: text('Technology', 120).describe('Track code (T01–T12) or track name'),
    education_id: masterId('Education'),
    documents: z
      .array(z.object({ document_type_id: masterId('Document type') }).strict(), { invalid_type_error: 'Documents must be a list' })
      .max(50, 'At most 50 documents')
      .refine((a) => new Set(a.map((d) => d.document_type_id)).size === a.length, 'Each document type may be listed only once')
      .optional()
      .describe('Documents the candidate declares; files are not uploaded through this endpoint'),
    declaration_accepted: z.literal(true, { errorMap: () => ({ message: 'The declaration must be accepted' }) }),
  })
  .strict();

export const createRegistrationSchema = { body: registrationBody };
export type RegistrationBody = z.infer<typeof registrationBody>;
