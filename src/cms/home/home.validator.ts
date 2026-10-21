import { z } from 'zod';

/*
 * Home "at a glance" request contract.
 *
 * Only the district count is accepted. The other three figures on that card are summed from the
 * modules, so sending them would be sending something the server has no way to honour — `.strict()`
 * rejects them rather than accepting and silently ignoring them.
 */
export const updateHomeGlanceSchema = {
  body: z
    .object({
      districtCount: z.coerce
        .number()
        .int()
        .min(0, 'District count cannot be negative')
        .max(9999, 'District count is too large'),
    })
    .strict(),
};

export type UpdateHomeGlanceBody = z.infer<typeof updateHomeGlanceSchema.body>;
