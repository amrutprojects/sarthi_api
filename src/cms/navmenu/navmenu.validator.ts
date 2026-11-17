import { z } from 'zod';
import { NAV_MENU_KEYS, type NavMenuKey } from './navmenu.types';

/*
 * PUT /cms/nav-menu/:key. An unknown key is a 422 naming the field, like any other bad input. The body is
 * strict: this endpoint writes the one flag and nothing else.
 */
export const updateNavMenuItemSchema = {
  params: z
    .object({
      key: z.enum(NAV_MENU_KEYS, { errorMap: () => ({ message: `Menu item must be one of: ${NAV_MENU_KEYS.join(', ')}` }) }),
    })
    .strict(),
  body: z
    .object({
      show: z.boolean({ required_error: 'show is required', invalid_type_error: 'show must be true or false' }),
    })
    .strict(),
};

export type NavMenuKeyParams = { key: NavMenuKey };
export type UpdateNavMenuItemBody = z.infer<typeof updateNavMenuItemSchema.body>;
