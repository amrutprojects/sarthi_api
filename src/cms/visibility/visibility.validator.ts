import { z } from 'zod';
import { SECTION_KEYS, type SectionKey } from './visibility.types';

/* The tab key in the path. An unknown key is a 422 naming the field, like any other bad input. */
export const sectionKeySchema = {
  params: z
    .object({
      key: z.enum(SECTION_KEYS, { errorMap: () => ({ message: `Section must be one of: ${SECTION_KEYS.join(', ')}` }) }),
    })
    .strict(),
};

/* The switch's one value. Strict: this endpoint writes the flag and nothing else. */
export const updateVisibilitySchema = {
  params: sectionKeySchema.params,
  body: z
    .object({
      visible: z.boolean({ required_error: 'visible is required', invalid_type_error: 'visible must be true or false' }),
    })
    .strict(),
};

export type SectionKeyParams = { key: SectionKey };
export type UpdateVisibilityBody = z.infer<typeof updateVisibilitySchema.body>;
