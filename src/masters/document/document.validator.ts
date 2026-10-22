import { z } from 'zod';
import { idParams, optionalText, optionalUuid, statusBody, uuid } from '../../shared/validation/common.validation';
import { listQueryAscSchema } from '../../shared/utils/pagination';
import { DOCUMENT_CATEGORIES, VERIFICATION_STATUSES } from '../shared/master.constants';

/*
 * Create and update arrive as multipart/form-data (the file travels with the metadata), so every text
 * field is a string: '' clears an optional value (the optional* helpers turn it into null) and the status
 * comes as 'true' / 'false'. The file itself is checked by content in document.storage.ts, not here.
 */

/*
 * Any printable text: titles are free-form ("MoU – Pune Centre 2026/27"). Trimmed, inner whitespace
 * collapsed, control characters refused. The same trim rule and minimum length are a CHECK on the table.
 */
const documentTitle = z
  .string({ required_error: 'Title is required', invalid_type_error: 'Title is required' })
  .trim()
  .transform((s) => s.replace(/\s+/g, ' '))
  .pipe(
    z
      .string()
      .min(3, 'Must be at least 3 characters')
      .max(150, 'Must be at most 150 characters')
      .regex(/^\P{Cc}*$/u, 'Use printable characters only'),
  );

const documentCategory = z.enum(DOCUMENT_CATEGORIES, {
  errorMap: () => ({ message: 'Choose a category from the list' }),
});

/* 'true' / 'false' from a form field, or a real boolean from a JSON body. */
const formBoolean = z.preprocess(
  (v) => (v === 'true' ? true : v === 'false' ? false : v),
  z.boolean({ invalid_type_error: 'Must be true or false' }),
);

export const listDocumentsSchema = {
  query: listQueryAscSchema(['title', 'category', 'verificationStatus', 'fileSize', 'createdAt', 'updatedAt'] as const).extend({
    category: z.enum(DOCUMENT_CATEGORIES).optional(),
    verificationStatus: z.enum(VERIFICATION_STATUSES).optional(),
    stateId: uuid.optional(),
    districtId: uuid.optional(),
    centreId: uuid.optional(),
  }),
};

export const documentIdSchema = { params: idParams };

export const createDocumentSchema = {
  body: z
    .object({
      title: documentTitle,
      category: documentCategory,
      description: optionalText(500),
      districtId: optionalUuid,
      centreId: optionalUuid,
      isActive: formBoolean.optional(),
    })
    .strict(),
};

/*
 * Every field is optional. The "at least one change" rule lives in the controller rather than in a
 * .refine() here, because a request that only replaces the file has an empty body and is still a change.
 */
export const updateDocumentSchema = {
  params: idParams,
  body: z
    .object({
      title: documentTitle.optional(),
      category: documentCategory.optional(),
      description: optionalText(500),
      districtId: optionalUuid,
      centreId: optionalUuid,
    })
    .strict(),
};

export const documentStatusSchema = { params: idParams, body: statusBody };

/*
 * Verify or reject. A rejection must say why (5–300 characters); a verification may carry a short note.
 * sha256 is the hash of the file the approver reviewed (as shown on the page they decided from): the
 * decision only lands on that exact file, so a file replaced in the meantime is never verified unseen.
 */
const reviewedSha256 = z
  .string({ required_error: 'Reload the document and review it again', invalid_type_error: 'Reload the document and review it again' })
  .regex(/^[0-9a-f]{64}$/, 'Reload the document and review it again');

export const verifyDocumentSchema = {
  params: idParams,
  body: z
    .object({
      status: z.enum(['VERIFIED', 'REJECTED'], { errorMap: () => ({ message: 'Choose VERIFIED or REJECTED' }) }),
      reason: optionalText(300),
      sha256: reviewedSha256,
    })
    .strict()
    .superRefine((b, ctx) => {
      if (b.status === 'REJECTED' && (!b.reason || b.reason.length < 5)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['reason'], message: 'Give the reason for rejecting (5 to 300 characters)' });
      }
    }),
};

export type ListDocumentsQuery = z.infer<typeof listDocumentsSchema.query>;
export type CreateDocumentBody = z.infer<typeof createDocumentSchema.body>;
export type UpdateDocumentBody = z.infer<typeof updateDocumentSchema.body>;
export type VerifyDocumentBody = z.infer<typeof verifyDocumentSchema.body>;
