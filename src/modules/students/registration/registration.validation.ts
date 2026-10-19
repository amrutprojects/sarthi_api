import { z } from 'zod';

/*
 * Shape check only: the body must be a JSON object with exactly the registration fields (unknown keys such as
 * status, approval_status, source_record_id or code are rejected). The business rules — formats, reference
 * lists, Aadhaar checksum, normalisation — come from validateCandidate, shared with the bulk import.
 */
const text = (max: number) => z.string().max(max);

export const registrationBody = z
  .object({
    first_name: text(100),
    last_name: text(100),
    father_name: text(150),
    mother_name: text(150),
    email: text(254),
    date_of_birth: text(10).describe('YYYY-MM-DD'),
    current_address: text(500),
    aadhaar_number: text(20).describe('12 digits; spaces or hyphens allowed'),
    mobile_number: text(20).describe('10-digit Indian mobile; +91 / 0 prefix allowed'),
    religion: text(60),
    caste: text(80),
    course_centre: text(60).describe('Centre code (e.g. PUN) or district name'),
    technology: text(120).describe('Track code (T01–T12) or track name'),
    education_qualification: text(150),
    declaration_accepted: z.literal(true, { errorMap: () => ({ message: 'The declaration must be accepted' }) }),
  })
  .strict();

export const createRegistrationSchema = { body: registrationBody };
export type RegistrationBody = z.infer<typeof registrationBody>;
