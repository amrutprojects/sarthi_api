import { z } from 'zod';
import { optionalPair } from '../cms.text.validation';
import { NAV_MENU_KEYS, type NavMenuKey } from './navmenu.types';

/*
 * PUT /cms/nav-menu/:key. An unknown key is a 422 naming the field, like any other bad input. The body is
 * strict: the show/hide flag, the custom name, or both, and nothing else; a key left out is left as it is.
 *
 * The name follows the shared CMS text rules (single line, trimmed, no control characters): both
 * languages or neither. `null`, or both blank, resets the item to the website's default name.
 */
export const updateNavMenuItemSchema = {
  params: z
    .object({
      key: z.enum(NAV_MENU_KEYS, { errorMap: () => ({ message: `Menu item must be one of: ${NAV_MENU_KEYS.join(', ')}` }) }),
    })
    .strict(),
  body: z
    .object({
      show: z.boolean({ invalid_type_error: 'show must be true or false' }).optional(),
      label: optionalPair('Name', 40).nullable().optional(),
    })
    .strict()
    .refine((b) => b.show !== undefined || b.label !== undefined, 'Send show, label or both'),
};

export type NavMenuKeyParams = { key: NavMenuKey };
export type UpdateNavMenuItemBody = z.infer<typeof updateNavMenuItemSchema.body>;
