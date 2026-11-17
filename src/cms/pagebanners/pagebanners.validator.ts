import { z } from 'zod';
import { optionalPair } from '../cms.text.validation';
import { PAGE_BANNER_KEYS, type PageBannerKey } from './pagebanners.types';

/*
 * PUT /cms/page-banners/:key. An unknown key is a 422 naming the field, like any other bad input. The body
 * is strict: the title, the subtitle, or both, and nothing else; a key left out is left as it is.
 *
 * Both follow the shared CMS text rules (trimmed, no control characters): both languages or neither, and
 * `null`, or both blank, resets to the website's default. The title is one line (line breaks collapse);
 * the subtitle may keep its line breaks.
 */
export const updatePageBannerSchema = {
  params: z
    .object({
      key: z.enum(PAGE_BANNER_KEYS, { errorMap: () => ({ message: `Page must be one of: ${PAGE_BANNER_KEYS.join(', ')}` }) }),
    })
    .strict(),
  body: z
    .object({
      title: optionalPair('Title', 150).nullable().optional(),
      subtitle: optionalPair('Subtitle', 300, true).nullable().optional(),
    })
    .strict()
    .refine((b) => b.title !== undefined || b.subtitle !== undefined, 'Send title, subtitle or both'),
};

export type PageBannerKeyParams = { key: PageBannerKey };
export type UpdatePageBannerBody = z.infer<typeof updatePageBannerSchema.body>;
