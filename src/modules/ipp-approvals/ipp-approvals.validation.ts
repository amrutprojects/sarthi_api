import { z } from 'zod';
import { listQuerySchema } from '../../shared/utils/pagination';
import { idParams, uuid } from '../../shared/validation/common.validation';
import { BULK_MAX, OFFICER_DISTRICTS_MAX, REASON_MAX, REASON_MIN, STAGES } from './ipp-approvals.constants';
import { typedText } from './ipp-text';

export const APPLICATION_VIEWS = ['TO_DECIDE', 'SENT_ON', 'SENT_BACK', 'ALL'] as const;
export type ApplicationView = (typeof APPLICATION_VIEWS)[number];

const list = <S extends readonly [string, ...string[]]>(sortable: S) => listQuerySchema(sortable).omit({ isActive: true });

export const listApplicationsSchema = {
  query: list(['stageUpdatedAt', 'name', 'registrationId'] as const).extend({
    search: z.string().trim().max(100).optional().describe('Name, registration id, mobile or email'),
    view: z
      .enum(APPLICATION_VIEWS)
      .default('TO_DECIDE')
      .describe(
        'TO_DECIDE = mine to decide now; SENT_ON = above my levels; SENT_BACK = below my levels after a rejection; ALL = what I see',
      ),
    stage: z.enum(STAGES).optional(),
    batchId: uuid.optional(),
    districtId: uuid.optional(),
  }),
};

export const listBatchesSchema = {
  query: list(['receivedAt', 'name'] as const).extend({
    search: z.string().trim().max(100).optional().describe('Code, name or centre'),
    districtId: uuid.optional(),
  }),
};

export const idSchema = { params: idParams };
export const documentSchema = { params: z.object({ id: uuid, code: z.string().min(1).max(100) }) };

const uniqueIds = (max: number) =>
  z
    .array(uuid)
    .max(max, `At most ${max}`)
    .refine((ids) => new Set(ids.map((i) => i.toLowerCase())).size === ids.length, 'The same id is there twice')
    .transform((ids) => ids.map((i) => i.toLowerCase()));

/*
 * Why the officer decides: a rejection's reason (mandatory), and an approval's (mandatory for a second approval, which the
 * service checks: 422; a first approval may have one). 3–500 characters after trimming. Counted as the reader sees them for the minimum and as JSON / IPP count them for the
 * maximum, so a reason accepted here is never refused later by the database or by IPP.
 */
const reason = z
  .string()
  .transform(typedText)
  .refine((v) => [...v].length >= REASON_MIN, `Must be at least ${REASON_MIN} characters`)
  .refine((v) => v.length <= REASON_MAX, `Must be at most ${REASON_MAX} characters`);

export const approveManySchema = {
  /* One reason for every application approved together. */
  body: z.object({ ids: uniqueIds(BULK_MAX).refine((ids) => ids.length > 0, 'At least one'), reason: reason.optional() }).strict(),
};

export const approveSchema = { params: idParams, body: z.object({ reason: reason.optional() }).strict() };
export const approveBatchSchema = { params: idParams, body: z.object({ reason: reason.optional() }).strict() };

export const rejectSchema = { params: idParams, body: z.object({ reason }).strict() };

export const headOfficeSchema = { body: z.object({ enabled: z.boolean() }).strict() };

export const officerDistrictsSchema = {
  params: z.object({ userId: uuid }),
  body: z.object({ districtIds: uniqueIds(OFFICER_DISTRICTS_MAX) }).strict(),
};

export const retrySchema = { body: z.object({ ids: uniqueIds(BULK_MAX).optional() }).strict() };

export type ListApplicationsQuery = z.infer<typeof listApplicationsSchema.query>;
export type ListBatchesQuery = z.infer<typeof listBatchesSchema.query>;
