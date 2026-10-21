import type { EntityManager, SelectQueryBuilder } from 'typeorm';
import { Brackets } from 'typeorm';
import { AppDataSource } from '../../config/database.config';
import { BaseRepository } from '../../database/base.repository';
import { Student, STUDENT_STATUS } from '../../modules/students';
import { buildMeta, likePattern, toSkipTake, type Paginated } from '../../shared/utils/pagination';
import { Batch } from '../batch/batch.model';
import { BatchAssignment } from './batch-assignment.model';
import type { BatchAssignmentListQuery, BatchAssignmentSortField } from './batch-assignment.types';

/* sortBy to SQL columns. The student name sorts by first then last name. */
const SORT_SQL: Record<BatchAssignmentSortField, string[]> = {
  studentName: ['s.firstName', 's.lastName'],
  studentCode: ['s.code'],
  batchName: ['b.name'],
  centreName: ['c.name'],
  assignedAt: ['ba.assignedAt'],
  createdAt: ['ba.createdAt'],
  updatedAt: ['ba.updatedAt'],
};

/*
 * The only student columns this module ever reads. The student register also holds Aadhaar (encrypted)
 * and other personal fields; they are never selected here, so they cannot leak into a response.
 */
const STUDENT_COLUMNS = ['s.id', 's.code', 's.firstName', 's.lastName', 's.centreCode', 's.isActive'];

/*
 * Student statuses that may hold a batch seat. An allow-list, so it fails closed: a public registration
 * (REGISTRATION_PENDING) is never offered or assigned, and any status added later (under review, rejected)
 * stays out until it is listed here. A registration is approved, and becomes RECEIVED, when an approved import
 * row is reconciled onto it as the same person and that import batch is finalised (ImportService.finalise).
 * Add the approved status when the approval workflow exists.
 */
export const ASSIGNABLE_STUDENT_STATUSES: readonly string[] = [STUDENT_STATUS.RECEIVED];

export interface StudentOptionRow {
  id: string;
  code: string;
  firstName: string;
  lastName: string;
  centreCode: string | null;
  assignedBatchCode: string | null;
}

export class BatchAssignmentRepository extends BaseRepository<BatchAssignment> {
  constructor() {
    super(BatchAssignment);
  }

  /* Assignments are always read with batch, centre and (a narrow slice of) the student. */
  private withRefs(manager?: EntityManager): SelectQueryBuilder<BatchAssignment> {
    return this.query('ba', manager)
      .innerJoinAndSelect('ba.batch', 'b')
      .innerJoinAndSelect('b.centre', 'c')
      .innerJoin('ba.student', 's')
      .addSelect(STUDENT_COLUMNS);
  }

  findByIdWithRefs(id: string, manager?: EntityManager): Promise<BatchAssignment | null> {
    return this.withRefs(manager).andWhere('ba.id = :id', { id }).getOne();
  }

  /* The student's non-deleted assignment (at most one: partial unique index), with its batch for the message. */
  findForStudent(studentId: string, opts: { excludeId?: string; manager?: EntityManager } = {}): Promise<BatchAssignment | null> {
    const qb = this.query('ba', opts.manager).innerJoinAndSelect('ba.batch', 'b').andWhere('ba.studentId = :studentId', { studentId });
    if (opts.excludeId) qb.andWhere('ba.id <> :excludeId', { excludeId: opts.excludeId });
    return qb.getOne();
  }

  /*
   * The assignment row, locked FOR UPDATE until the transaction ends. Every write to an existing
   * assignment takes this lock FIRST (then its batch rows), so two writes to the same assignment run one
   * after the other, and the second decides from the row as the first left it: a re-activation and a move
   * into a full batch can no longer both pass their seat checks. A waiting SELECT … FOR UPDATE returns the
   * latest committed row, or nothing when it was deleted meanwhile. includeDeleted is for restore only.
   */
  lockAssignment(id: string, manager: EntityManager, opts: { includeDeleted?: boolean } = {}): Promise<BatchAssignment | null> {
    const qb = manager.getRepository(BatchAssignment).createQueryBuilder('ba').setLock('pessimistic_write').where('ba.id = :id', { id });
    if (!opts.includeDeleted) qb.andWhere('ba.isDelete = false');
    return qb.getOne();
  }

  /*
   * The batch row, locked FOR UPDATE until the transaction ends (SELECT … FOR UPDATE). Seats are counted
   * only while holding this lock, so two assignments saved at the same moment cannot both take the last
   * seat, and a concurrent capacity change in the Batch Master waits for us.
   */
  lockBatch(batchId: string, manager: EntityManager): Promise<Batch | null> {
    return manager
      .getRepository(Batch)
      .createQueryBuilder('b')
      .setLock('pessimistic_write')
      .where('b.id = :id', { id: batchId })
      .andWhere('b.isDelete = false')
      .getOne();
  }

  /*
   * Several batch rows locked FOR UPDATE one by one, always in id order. Two moves in opposite directions
   * between the same pair of batches then queue on the lower id instead of deadlocking. Locking a row this
   * transaction already holds is free, so lockBatch may be called on them afterwards.
   */
  async lockBatches(batchIds: string[], manager: EntityManager): Promise<void> {
    for (const id of [...new Set(batchIds)].sort()) await this.lockBatch(id, manager);
  }

  /*
   * Student fields the rules need (preferred centre, active flag, register status). Never the personal
   * columns. Inside a transaction the non-deleted student is read FOR SHARE and stays locked until commit,
   * so a concurrent student delete (which locks the student FOR UPDATE, then counts its assignments) runs
   * either wholly before us (we then find no student) or wholly after us (it then counts our assignment).
   */
  findStudent(studentId: string, opts: { includeDeleted?: boolean; manager?: EntityManager } = {}): Promise<Student | null> {
    return (opts.manager ?? AppDataSource.manager).getRepository(Student).findOne({
      where: opts.includeDeleted ? { id: studentId } : { id: studentId, isDelete: false },
      select: { id: true, code: true, firstName: true, lastName: true, centreCode: true, status: true, isActive: true, isDelete: true },
      ...(opts.manager && !opts.includeDeleted ? { lock: { mode: 'pessimistic_read' as const } } : {}),
    });
  }

  async list(q: BatchAssignmentListQuery): Promise<Paginated<BatchAssignment>> {
    const qb = this.withRefs();
    if (q.batchId) qb.andWhere('ba.batchId = :batchId', { batchId: q.batchId });
    if (q.centreId) qb.andWhere('b.centreId = :centreId', { centreId: q.centreId });
    if (q.reasonCode) qb.andWhere('ba.reasonCode = :reasonCode', { reasonCode: q.reasonCode });
    if (q.search) {
      const term = likePattern(q.search);
      qb.andWhere(new Brackets((w) => w
        .where('s.code ILIKE :term', { term })
        .orWhere('s.firstName ILIKE :term', { term })
        .orWhere('s.lastName ILIKE :term', { term })
        .orWhere("concat(s.firstName, ' ', s.lastName) ILIKE :term", { term })
        .orWhere('b.name ILIKE :term', { term })
        .orWhere('b.code ILIKE :term', { term })));
    }
    if (q.isActive !== undefined) qb.andWhere('ba.isActive = :isActive', { isActive: q.isActive });
    const [first, ...rest] = SORT_SQL[q.sortBy];
    qb.orderBy(first, q.sortOrder);
    for (const col of rest) qb.addOrderBy(col, q.sortOrder);
    const { skip, take } = toSkipTake(q);
    const [items, total] = await qb.addOrderBy('ba.id').skip(skip).take(take).getManyAndCount();
    return { items, meta: buildMeta(q, total) };
  }

  /*
   * Student search for the Assign Batch form: code or name, non-deleted students with an assignable status
   * (never a pending registration), at most 20 rows, each with the code of the batch the student already
   * holds (if any) so the form can say so.
   */
  searchStudents(search: string, limit = 20): Promise<StudentOptionRow[]> {
    const term = likePattern(search);
    return AppDataSource.getRepository(Student)
      .createQueryBuilder('s')
      .leftJoin(BatchAssignment, 'ba', 'ba.studentId = s.id AND ba.isDelete = false')
      .leftJoin(Batch, 'b', 'b.id = ba.batchId')
      .select('s.id', 'id')
      .addSelect('s.code', 'code')
      .addSelect('s.firstName', 'firstName')
      .addSelect('s.lastName', 'lastName')
      .addSelect('s.centreCode', 'centreCode')
      .addSelect('b.code', 'assignedBatchCode')
      .where('s.isDelete = false')
      .andWhere('s.status IN (:...assignable)', { assignable: ASSIGNABLE_STUDENT_STATUSES })
      .andWhere(new Brackets((w) => w
        .where('s.code ILIKE :term', { term })
        .orWhere('s.firstName ILIKE :term', { term })
        .orWhere('s.lastName ILIKE :term', { term })
        .orWhere("concat(s.firstName, ' ', s.lastName) ILIKE :term", { term })))
      .orderBy('s.firstName', 'ASC')
      .addOrderBy('s.lastName', 'ASC')
      .addOrderBy('s.code', 'ASC')
      .limit(limit)
      .getRawMany<StudentOptionRow>();
  }
}

export const batchAssignmentRepository = new BatchAssignmentRepository();
