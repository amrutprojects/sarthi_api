import { z } from 'zod';
import { documentEndpoint, envelope, registry } from '../../shared/openapi/registry';
import { idParams } from '../../shared/validation/common.validation';
import { replaceRoleLmsPermissionsSchema } from './lms-access.validation';

const tag = 'LMS roles';

export const LmsCatalogueDto = registry.register(
  'LmsCatalogue',
  z.array(
    z.object({
      group: z.string().describe('LMS sidebar group'),
      areas: z.array(
        z.object({
          area: z.string(),
          label: z.string(),
          menus: z
            .array(z.object({ label: z.string(), view: z.array(z.string()) }))
            .describe('LMS sidebar menus these codes open; holding any one of view shows the menu'),
          permissions: z.array(z.object({ code: z.string(), label: z.string(), sensitive: z.boolean(), description: z.string() })),
        }),
      ),
    }),
  ),
);
export const RoleLmsAccessDto = registry.register(
  'RoleLmsAccess',
  z.object({ roleId: z.string().uuid(), code: z.string(), name: z.string(), codes: z.array(z.string()) }),
);

documentEndpoint({
  method: 'get',
  path: '/lms-access/catalogue',
  tag,
  summary: 'LMS menus that can be ticked on an LMS role',
  description: 'The LMS permission catalogue grouped like the LMS sidebar. These codes grant nothing in the Admin Panel.',
  permission: 'roles.view',
  response: envelope(LmsCatalogueDto),
});
documentEndpoint({
  method: 'get',
  path: '/lms-access/roles/:id',
  tag,
  summary: 'LMS menus ticked on a role',
  permission: 'roles.view',
  request: { params: idParams },
  response: envelope(RoleLmsAccessDto),
  errors: [404],
});
documentEndpoint({
  method: 'put',
  path: '/lms-access/roles/:id',
  tag,
  summary: 'Replace the LMS menus ticked on an LMS role',
  description: 'Only LMS roles (platform LMS) carry LMS menus. A role you hold can be changed only by a Super Admin.',
  permission: 'permissions.assign',
  request: { params: replaceRoleLmsPermissionsSchema.params, body: replaceRoleLmsPermissionsSchema.body },
  response: envelope(RoleLmsAccessDto),
  errors: [400, 404],
});
