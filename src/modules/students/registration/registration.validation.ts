import { z } from 'zod';
import { uuid } from '../../../shared/validation/common.validation';

/*
 * Shape check only: the body must be a JSON object with exactly the registration fields (unknown keys such as
 * status, approval_status, source_record_id or code are rejected). The business rules — formats, reference
 * lists, Aadhaar checksum, normalisation — come from validateCandidate, shared with the bulk import.
 * Region, caste, education and document types are referenced by the id of an active master record
 * (GET /regions/options, /castes/options, /education/options, /document-types/options).
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
    caste_id: uuid.describe('Caste master id (active)'),
    region_id: uuid.describe('Region (course centre) master id (active)'),
    technology: text(120).describe('Track code (T01–T12) or track name'),
    education_id: uuid.describe('Education master id (active)'),
    documents: z
      .array(z.object({ document_type_id: uuid.describe('Document type master id (active)') }).strict())
      .max(50)
      .optional()
      .describe('Documents the candidate declares; files are not uploaded through this endpoint'),
    declaration_accepted: z.literal(true, { errorMap: () => ({ message: 'The declaration must be accepted' }) }),
  })
  .strict();

export const createRegistrationSchema = { body: registrationBody };
export type RegistrationBody = z.infer<typeof registrationBody>;
