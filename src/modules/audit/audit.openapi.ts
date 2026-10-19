import { z } from 'zod';
import { documentEndpoint, pagedEnvelope, registry } from '../../shared/openapi/registry';
import { listAuditLogsSchema } from './audit-log.validation';

const AuditLogDto = registry.register('AuditLog', z.object({
  id: z.string().uuid(), createdAt: z.string().datetime(), actorUserId: z.string().uuid().nullable(), action: z.string(), resource: z.string(),
  resourceId: z.string().nullable(), requestId: z.string().nullable(), outcome: z.enum(['SUCCESS', 'FAILURE', 'DENIED']),
  ipAddress: z.string().nullable(), details: z.record(z.unknown()).nullable(),
}));

documentEndpoint({ method: 'get', path: '/audit-logs', tag: 'Audit', summary: 'Append-only audit log', permission: 'audit.view', request: { query: listAuditLogsSchema.query }, response: pagedEnvelope(AuditLogDto) });
