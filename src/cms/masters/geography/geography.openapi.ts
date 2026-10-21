import { z } from 'zod';
import { documentEndpoint, envelope } from '../../shared/openapi/registry';
import { parentIdParams } from '../../shared/validation/common.validation';

/* Public geography feed (geography.routes.ts): active, non-deleted rows only, projected to id / name / code. */
const tag = 'Public geography';
const option = z.object({ id: z.string().uuid(), name: z.string(), code: z.string().nullable() });

documentEndpoint({
  method: 'get',
  path: '/public/geography/states',
  tag,
  summary: 'Active states, A to Z (unauthenticated)',
  permission: 'public',
  response: envelope(z.array(option)),
});
documentEndpoint({
  method: 'get',
  path: '/public/geography/states/:stateId/districts',
  tag,
  summary: 'Active districts of a state (unauthenticated)',
  permission: 'public',
  request: { params: parentIdParams('stateId') },
  response: envelope(z.array(option.extend({ stateId: z.string().uuid() }))),
  errors: [404],
});
documentEndpoint({
  method: 'get',
  path: '/public/geography/districts/:districtId/talukas',
  tag,
  summary: 'Active talukas of a district (unauthenticated)',
  permission: 'public',
  request: { params: parentIdParams('districtId') },
  response: envelope(z.array(option.extend({ districtId: z.string().uuid() }))),
  errors: [404],
});
