import type { EntityManager } from 'typeorm';
import { AppDataSource } from '../../config/database.config';
import { AuditLog, type AuditOutcome } from './audit-log.entity';
import { buildMeta, toSkipTake, type Paginated } from '../../shared/utils/pagination';

export interface AuditEntryInput {
  actorUserId?: string | null;
  action: string;
  resource: string;
  resourceId?: string | null;
  requestId?: string | null;
  outcome: AuditOutcome;
  ipAddress?: string | null;
  details?: Record<string, unknown> | null;
}

/* Audit log is append-only: this repository only inserts and reads. */
export class AuditLogRepository {
  private repo(manager?: EntityManager) {
    return (manager ?? AppDataSource.manager).getRepository(AuditLog);
  }

  async insert(entry: AuditEntryInput, manager?: EntityManager): Promise<void> {
    const repo = this.repo(manager);
    /* save() of a new entity is always an INSERT (the table is append-only). */
    await repo.save(repo.create({
      actorUserId: entry.actorUserId ?? null,
      action: entry.action,
      resource: entry.resource,
      resourceId: entry.resourceId ?? null,
      requestId: entry.requestId ?? null,
      outcome: entry.outcome,
      ipAddress: entry.ipAddress ?? null,
      details: entry.details ?? null,
    }));
  }

  async list(q: { page: number; limit: number; action?: string; actorUserId?: string; resource?: string; resourceId?: string }): Promise<Paginated<AuditLog>> {
    const qb = this.repo().createQueryBuilder('a');
    if (q.action) qb.andWhere('a.action = :action', { action: q.action });
    if (q.actorUserId) qb.andWhere('a.actorUserId = :actor', { actor: q.actorUserId });
    if (q.resource) qb.andWhere('a.resource = :resource', { resource: q.resource });
    if (q.resourceId) qb.andWhere('a.resourceId = :rid', { rid: q.resourceId });
    const { skip, take } = toSkipTake(q);
    const [items, total] = await qb.orderBy('a.createdAt', 'DESC').skip(skip).take(take).getManyAndCount();
    return { items, meta: buildMeta(q, total) };
  }
}

export const auditLogRepository = new AuditLogRepository();
