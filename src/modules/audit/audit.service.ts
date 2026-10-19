import type { Request } from 'express';
import type { EntityManager } from 'typeorm';
import { logger } from '../../observability/logger';
import type { AuditOutcome } from './audit-log.entity';
import { auditLogRepository, type AuditEntryInput } from './audit-log.repository';

export interface AuditEvent {
  action: string;
  resource: string;
  resourceId?: string | null;
  outcome?: AuditOutcome;
  details?: Record<string, unknown>;
  /* Overrides the actor taken from req.auth (e.g. failed logins have no authenticated actor). */
  actorUserId?: string | null;
}

/* Keys that must never be written to the audit log, at any depth. */
const SENSITIVE = /pass(word)?|secret|token|authorization|cookie|hash/i;

function scrub(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrub);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([k]) => !SENSITIVE.test(k))
        .map(([k, v]) => [k, scrub(v)]),
    );
  }
  return value;
}

export class AuditService {
  private toEntry(req: Request | undefined, e: AuditEvent): AuditEntryInput {
    return {
      actorUserId: e.actorUserId !== undefined ? e.actorUserId : (req?.auth?.id ?? null),
      action: e.action,
      resource: e.resource,
      resourceId: e.resourceId ?? null,
      requestId: req ? String(req.id) : null,
      outcome: e.outcome ?? 'SUCCESS',
      ipAddress: req?.ip ?? null,
      details: e.details ? (scrub(e.details) as Record<string, unknown>) : null,
    };
  }

  /* Inside a transaction: the audit row commits or rolls back with the change it describes. */
  recordInTx(manager: EntityManager, req: Request | undefined, e: AuditEvent): Promise<void> {
    return auditLogRepository.insert(this.toEntry(req, e), manager);
  }

  /* Best-effort record (e.g. denied requests); a logging failure never breaks the request. */
  async record(req: Request | undefined, e: AuditEvent): Promise<void> {
    try {
      await auditLogRepository.insert(this.toEntry(req, e));
    } catch (err) {
      logger.error({ err, action: e.action, requestId: req?.id }, 'failed to write audit log');
    }
  }
}

export const auditService = new AuditService();
