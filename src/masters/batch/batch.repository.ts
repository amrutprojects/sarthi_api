import type { EntityManager, SelectQueryBuilder } from 'typeorm';
import { Brackets } from 'typeorm';
import { AppDataSource } from '../../config/database.config';
import { BaseRepository } from '../../database/base.repository';
import { buildMeta, likePattern, toSkipTake, type Paginated } from '../../shared/utils/pagination';
import { BatchAssignment } from '../batch-assignment/batch-assignment.model';
import { Batch } from './batch.model';
import type { BatchAssignmentCounts, BatchListQuery, BatchSortField } from './batch.types';

/* sortBy to SQL expression, so the centre name is sortable without exposing a column name to clients. */
const SORT_SQL: Record<BatchSortField, string> = {
  name: 'b.name',
  code: 'b.code',
  centreName: 'c.name',
  startDate: 'b.startDate',
  capacity: 'b.capacity',
  batchStatus: 'b.batchStatus',
  createdAt: 'b.createdAt',
  updatedAt: 'b.updatedAt',
};

export class BatchRepository extends BaseRepository<Batch> {
  constructor() {
    super(Batch);
  }

  /* Batches are always read with their centre: every list and detail response carries the centre name. */
  private withCentre(manager?: EntityManager): SelectQueryBuilder<Batch> {
    return this.query('b', manager).innerJoinAndSelect('b.centre', 'c');
  }

  findByIdWithCentre(id: string, manager?: EntityManager): Promise<Batch | null> {
    return this.withCentre(manager).andWhere('b.id = :id', { id }).getOne();
  }

  /*
   * The batch row, locked FOR UPDATE until the transaction ends. Seat counting (here and in Assign Batch)
   * happens under this lock, so a capacity change and a new assignment can never interleave.
   */
  findByIdForUpdate(id: string, manager: EntityManager): Promise<Batch | null> {
    return manager
      .getRepository(Batch)
      .createQueryBuilder('b')
      .setLock('pessimistic_write')
      .where('b.id = :id', { id })
      .andWhere('b.isDelete = false')
      .getOne();
  }

  /* Name uniqueness is per centre, matching the (centreId, lower("name")) unique index. */
  findByNameInCentre(centreId: string, name: string, opts: { excludeId?: string; manager?: EntityManager } = {}): Promise<Batch | null> {
    const qb = this.query('b', opts.manager)
      .andWhere('b.centreId = :centreId', { centreId })
      .andWhere('lower(b.name) = lower(:name)', { name });
    if (opts.excludeId) qb.andWhere('b.id <> :excludeId', { excludeId: opts.excludeId });
    return qb.getOne();
  }

  /* Codes are unique across all centres (unique index on code, non-deleted rows). */
  findByCode(code: string, opts: { excludeId?: string; manager?: EntityManager } = {}): Promise<Batch | null> {
    const qb = this.query('b', opts.manager).andWhere('b.code = :code', { code });
    if (opts.excludeId) qb.andWhere('b.id <> :excludeId', { excludeId: opts.excludeId });
    return qb.getOne();
  }

  /*
   * Codes already taken that start with a prefix, for code generation. Soft-deleted batches count too, so
   * a generated code is never handed out again and restoring a deleted batch cannot collide with one.
   */
  async codesWithPrefix(prefix: string, opts: { excludeId?: string; manager?: EntityManager } = {}): Promise<Set<string>> {
    const qb = this.repo(opts.manager)
      .createQueryBuilder('b')
      .select('b.code', 'code')
      .where('b.code LIKE :prefix', { prefix: `${prefix.replace(/[\\%_]/g, (c) => '\\' + c)}%` });
    if (opts.excludeId) qb.andWhere('b.id <> :excludeId', { excludeId: opts.excludeId });
    const rows = await qb.getRawMany<{ code: string }>();
    return new Set(rows.map((r) => r.code));
  }

  async list(q: BatchListQuery): Promise<Paginated<Batch>> {
    const qb = this.withCentre();
    if (q.centreId) qb.andWhere('b.centreId = :centreId', { centreId: q.centreId });
    if (q.batchStatus) qb.andWhere('b.batchStatus = :batchStatus', { batchStatus: q.batchStatus });
    if (q.deliveryMode) qb.andWhere('b.deliveryMode = :deliveryMode', { deliveryMode: q.deliveryMode });
    if (q.search) {
      const term = likePattern(q.search);
      qb.andWhere(new Brackets((w) => w
        .where('b.name ILIKE :term', { term })
        .orWhere('b.code ILIKE :term', { term })
        .orWhere('b.trackName ILIKE :term', { term })
        .orWhere('c.name ILIKE :term', { term })
        .orWhere('c.code ILIKE :term', { term })));
    }
    if (q.isActive !== undefined) qb.andWhere('b.isActive = :isActive', { isActive: q.isActive });
    const { skip, take } = toSkipTake(q);
    const [items, total] = await qb.orderBy(SORT_SQL[q.sortBy], q.sortOrder).addOrderBy('b.id').skip(skip).take(take).getManyAndCount();
    return { items, meta: buildMeta(q, total) };
  }

  /*
   * Assignment counts per batch for a whole page of batches in ONE grouped query rather than counts per
   * row: assignedCount = seats held (active, non-deleted), assignmentCount = every non-deleted assignment.
   * Batches without assignments are absent from the map (0 / 0).
   */
  async assignmentCounts(batchIds: string[], manager?: EntityManager): Promise<Map<string, BatchAssignmentCounts>> {
    if (!batchIds.length) return new Map();
    const rows = await (manager ?? AppDataSource.manager)
      .getRepository(BatchAssignment)
      .createQueryBuilder('ba')
      .select('ba.batchId', 'batchId')
      .addSelect('COUNT(*) FILTER (WHERE ba.isActive = true)', 'active')
      .addSelect('COUNT(*)', 'total')
      .where('ba.batchId IN (:...batchIds)', { batchIds })
      .andWhere('ba.isDelete = false')
      .groupBy('ba.batchId')
      .getRawMany<{ batchId: string; active: string; total: string }>();
    return new Map(rows.map((r) => [r.batchId, { assignedCount: Number(r.active), assignmentCount: Number(r.total) }]));
  }

  /*
   * Batches offered in a dropdown: not deleted and active, A to Z. `assignable` narrows the list to the
   * batches a student can be assigned to: lifecycle OPEN and the centre active.
   */
  findSelectable(opts: { assignable?: boolean; manager?: EntityManager } = {}): Promise<Batch[]> {
    const qb = this.withCentre(opts.manager).andWhere('b.isActive = true');
    if (opts.assignable) {
      qb.andWhere("b.batchStatus = 'OPEN'").andWhere('c.isActive = true').andWhere('c.isDelete = false');
    }
    return qb.orderBy('b.name', 'ASC').addOrderBy('b.code', 'ASC').getMany();
  }
}

export const batchRepository = new BatchRepository();
