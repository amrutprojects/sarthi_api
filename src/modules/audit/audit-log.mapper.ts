import type { AuditLog } from './audit-log.entity';

/* API shape of an audit entry (no ORM relations, no internal columns). */
export const toAuditLogDto = (a: AuditLog) => ({
  id: a.id,
  createdAt: a.createdAt,
  actorUserId: a.actorUserId,
  action: a.action,
  resource: a.resource,
  resourceId: a.resourceId,
  requestId: a.requestId,
  outcome: a.outcome,
  ipAddress: a.ipAddress,
  details: a.details,
});
