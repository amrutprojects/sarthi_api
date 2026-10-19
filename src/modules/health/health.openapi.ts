import { z } from 'zod';
import { documentEndpoint, envelope } from '../../shared/openapi/registry';

const tag = 'Health';
const Ready = envelope(
  z.object({
    status: z.enum(['ok', 'degraded']),
    database: z.enum(['up', 'down']),
    migrations: z.enum(['current', 'pending', 'unknown']),
    uptimeSeconds: z.number(),
  }),
);

documentEndpoint({
  method: 'get',
  path: '/health',
  tag,
  summary: 'Readiness (alias of /health/ready)',
  permission: 'public',
  response: Ready,
  errors: [503],
});
documentEndpoint({
  method: 'get',
  path: '/health/live',
  tag,
  summary: 'Liveness: process is serving HTTP (no dependency checks)',
  permission: 'public',
  response: envelope(z.object({ status: z.literal('ok'), uptimeSeconds: z.number() })),
});
documentEndpoint({
  method: 'get',
  path: '/health/ready',
  tag,
  summary: 'Readiness: database reachable and migrations current; 503 otherwise',
  permission: 'public',
  response: Ready,
  errors: [503],
});
