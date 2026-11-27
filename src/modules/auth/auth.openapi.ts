import { z } from 'zod';
import { documentEndpoint, envelope } from '../../shared/openapi/registry';
import { RoleRefDto, UserDto } from '../users';
import { loginSchema } from './auth.validation';

const tag = 'Auth';
const LoginDto = z.object({
  accessToken: z.string().optional().describe('Only with request header X-Auth-Mode: bearer; browsers get the HttpOnly cookie instead'),
  tokenType: z.literal('Bearer'),
  expiresIn: z.number().int(),
  expiresAt: z.string().datetime(),
  csrfToken: z.string().describe('Send as X-CSRF-Token on state-changing requests made with the session cookie'),
  user: UserDto,
});
const MeDto = UserDto.extend({
  roles: z.array(RoleRefDto),
  permissions: z.array(z.string()),
  hiddenMenus: z.array(z.string()),
  portal: z
    .enum(['admin', 'website', 'ipp'])
    .describe(
      'website: the account holds the Website Admin role and works in the CMS menu only; ipp: every active role of the account ' +
        'is an IPP officer role (Divisional Officer, COEP, Head Officer) and it works in IPP Approvals (Applications) only; admin: the full panel',
    ),
  csrfToken: z.string(),
});

documentEndpoint({
  method: 'post',
  path: '/auth/login',
  tag,
  summary: 'Sign in',
  permission: 'public',
  status: 200,
  description:
    'Sets the HttpOnly session cookie. Rate limited per IP. The same error is returned for an unknown email, a wrong password and a disabled account.',
  request: { body: loginSchema.body },
  response: envelope(LoginDto),
  errors: [401],
});
documentEndpoint({
  method: 'post',
  path: '/auth/logout',
  tag,
  summary: 'Sign out (revokes the session, clears the cookie)',
  permission: null,
  status: 200,
  response: envelope(z.null()),
});
documentEndpoint({
  method: 'get',
  path: '/auth/me',
  tag,
  summary: 'Current user, effective permissions, hidden menus, workspace and CSRF token',
  permission: null,
  response: envelope(MeDto),
});
documentEndpoint({
  method: 'get',
  path: '/auth/permissions',
  tag,
  summary: 'Effective role and permission codes',
  permission: null,
  response: envelope(z.object({ roles: z.array(z.string()), permissions: z.array(z.string()) })),
});
