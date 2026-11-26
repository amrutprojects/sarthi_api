import type { Request } from 'express';
import type { EntityManager } from 'typeorm';
import { AppDataSource } from '../../config/database.config';
import { auditService } from '../../modules/audit';
import type { Student } from '../../modules/students';
import { AUDIT_ACTIONS } from '../../shared/constants/app.constants';
import { AppError } from '../../shared/errors/app-error';
import type { Paginated } from '../../shared/utils/pagination';
import { Batch } from '../batch/batch.model';
import { countRefs, plural } from '../shared/master-refs';
import type { AssignmentReason } from '../shared/master.constants';
import { TrainingCentre } from '../training-centre/training-centre.model';
import { BatchAssignment } from './batch-assignment.model';
import { ASSIGNABLE_STUDENT_STATUSES, batchAssignmentRepository as repo } from './batch-assignment.repository';
import type {
  BatchAssignmentListQuery, CreateBatchAssignmentInput, PublicBatchAssignmentDetail, StudentOption, UpdateBatchAssignmentInput,
} from './batch-assignment.types';
import { assertNoDependencies } from '../../shared/dependencies/dependencies';
import { BATCH_ASSIGNMENT_DEPENDENCIES } from '../masters.dependencies';

const fullName = (s: { firstName: string; lastName: string }) => [s.firstName, s.lastName].filter(Boolean).join(' ');

/* Requires batch, centre and student to be joined (BatchAssignmentRepository.withRefs). */
const toPublic = (a: BatchAssignment): PublicBatchAssignmentDetail => ({
  id: a.id,
  batchId: a.batchId,
  batchName: a.batch.name,
  batchCode: a.batch.code,
  batchIsActive: a.batch.isActive,
  batchStatus: a.batch.batchStatus,
  centreId: a.batch.centreId,
  centreName: a.batch.centre.name,
  centreCode: a.batch.centre.code,
  studentId: a.studentId,
  studentCode: a.student.code,
  studentName: fullName(a.student),
  studentPreferredCentreCode: a.student.centreCode,
  reasonCode: a.reasonCode,
  remarks: a.remarks,
  assignedAt: a.assignedAt,
  isActive: a.isActive,
  createdAt: a.createdAt,
  updatedAt: a.updatedAt,
});

const REASON_MESSAGE = "The batch's centre differs from the student's preferred centre; select a reason";

/*
 * Only a registered student may hold a seat; a public registration stays out until it is approved. Today that
 * happens at import finalisation, when an approved import row is reconciled onto it as the same person: the
 * registration then becomes RECEIVED.
 */
const isAssignable = (s: Pick<Student, 'status'>) => ASSIGNABLE_STUDENT_STATUSES.includes(s.status);
const NOT_REGISTERED_MESSAGE = 'The selected student is a pending registration';

/*
 * Assign Batch (AMRUT_KALASH_02 Table 41): one student allocated to one programme batch.
 *
 * Rules, all re-checked on the server whatever the form offered:
 * - the student exists, is not deleted, is active and is a registered student (status RECEIVED: never a
 *   pending public registration); at most one non-deleted assignment per student (also a partial unique index);
 * - the batch exists, is not deleted, is active, is OPEN, and its centre is active;
 * - an active assignment holds a seat, and a batch's active assignments never exceed its capacity. Seats
 *   are counted while the batch row is locked FOR UPDATE, so concurrent saves cannot overfill a batch;
 * - a reason is required when the batch's centre is not the student's preferred centre.
 * Moving to another batch re-runs the batch, seat and reason checks; the student never changes.
 *
 * Lock order, the same in every write so no two of them can deadlock: the assignment row first
 * (lockAssignment: concurrent writes to one assignment run one after the other and each sees the other's
 * result), then the student row FOR SHARE (findStudent; create, restore and re-activation), then batch
 * rows (two of them in id order on a move). The Batch Master locks only batch and centre rows and never
 * assignment rows; a student delete locks only the student row (FOR UPDATE) and refuses while an
 * assignment references it.
 */
export class BatchAssignmentService {
  async list(q: BatchAssignmentListQuery): Promise<Paginated<PublicBatchAssignmentDetail>> {
    /* A filter naming an unknown batch or centre is a client error, not an empty list that looks like real data. */
    if (q.batchId && !(await AppDataSource.getRepository(Batch).exists({ where: { id: q.batchId, isDelete: false } }))) {
      throw AppError.badRequest('The selected batch does not exist', [{ field: 'batchId', message: 'Unknown batch' }]);
    }
    if (q.centreId && !(await AppDataSource.getRepository(TrainingCentre).exists({ where: { id: q.centreId, isDelete: false } }))) {
      throw AppError.badRequest('The selected training centre does not exist', [{ field: 'centreId', message: 'Unknown training centre' }]);
    }
    const page = await repo.list(q);
    return { items: page.items.map(toPublic), meta: page.meta };
  }

  async get(id: string): Promise<PublicBatchAssignmentDetail> {
    const assignment = await repo.findByIdWithRefs(id);
    if (!assignment) throw AppError.notFound('Batch assignment not found');
    return toPublic(assignment);
  }

  /* Student search feed of the form. Narrow on purpose: code, name, preferred centre, current batch. */
  async studentOptions(search: string): Promise<StudentOption[]> {
    const rows = await repo.searchStudents(search, 20);
    return rows.map((r) => ({
      id: r.id,
      code: r.code,
      name: fullName(r),
      centreCode: r.centreCode,
      assignedBatchCode: r.assignedBatchCode,
    }));
  }

  /*
   * The student must exist, not be deleted, be active and be a registered student (not a pending
   * registration). 400 on studentId otherwise. The student row stays locked FOR SHARE until commit, so it
   * cannot be deleted while this assignment is being saved.
   */
  private async assertUsableStudent(m: EntityManager, studentId: string): Promise<Student> {
    const student = await repo.findStudent(studentId, { manager: m });
    if (!student) throw AppError.badRequest('The selected student does not exist', [{ field: 'studentId', message: 'Unknown student' }]);
    if (!student.isActive) {
      throw AppError.badRequest('The selected student is inactive', [{ field: 'studentId', message: 'Choose an active student' }]);
    }
    if (!isAssignable(student)) {
      throw AppError.badRequest(NOT_REGISTERED_MESSAGE, [{ field: 'studentId', message: 'Only registered students can be assigned' }]);
    }
    return student;
  }

  /* One non-deleted assignment per student. */
  private async assertOnePerStudent(m: EntityManager, studentId: string, excludeId?: string): Promise<void> {
    const existing = await repo.findForStudent(studentId, { excludeId, manager: m });
    if (existing) throw AppError.conflict(`This student is already assigned to batch ${existing.batch.code}`);
  }

  /*
   * The batch a student may be put into: exists, not deleted, active, OPEN, centre active. The batch row
   * is locked here (and stays locked until commit) so the seat count that follows is reliable.
   */
  private async assertAssignableBatch(m: EntityManager, batchId: string): Promise<{ batch: Batch; centre: TrainingCentre }> {
    const fail = (message: string, fieldMessage: string) => AppError.badRequest(message, [{ field: 'batchId', message: fieldMessage }]);
    const batch = await repo.lockBatch(batchId, m);
    if (!batch) throw fail('The selected batch does not exist', 'Unknown batch');
    if (!batch.isActive) throw fail(`Batch ${batch.code} is inactive`, 'Choose an active batch');
    if (batch.batchStatus !== 'OPEN') {
      throw fail(`Batch ${batch.code} is not open for assignment`, `Batch ${batch.code} is ${batch.batchStatus.toLowerCase()}; only an open batch takes students`);
    }
    const centre = await m.getRepository(TrainingCentre).findOne({ where: { id: batch.centreId, isDelete: false } });
    if (!centre || !centre.isActive) {
      throw fail(`The training centre of batch ${batch.code} is inactive`, `The centre of batch ${batch.code} is inactive`);
    }
    return { batch, centre };
  }

  /* Call only while holding the batch lock (lockBatch). */
  private async assertSeat(m: EntityManager, batch: Batch): Promise<void> {
    const taken = await countRefs(m, BatchAssignment, 'batchId', batch.id, { activeOnly: true });
    if (taken >= batch.capacity) throw AppError.conflict(`Batch ${batch.code} is full (${plural(batch.capacity, 'seat')})`);
  }

  /* A reason is required when the student asked for a different centre than the batch's. */
  private assertReason(student: Pick<Student, 'centreCode'> | null, centre: TrainingCentre, reasonCode: AssignmentReason | null): void {
    const preferred = student?.centreCode?.trim().toUpperCase();
    if (preferred && preferred !== centre.code.toUpperCase() && !reasonCode) {
      throw AppError.badRequest(REASON_MESSAGE, [{ field: 'reasonCode', message: REASON_MESSAGE }]);
    }
  }

  async create(input: CreateBatchAssignmentInput, req?: Request): Promise<PublicBatchAssignmentDetail> {
    const id = await AppDataSource.transaction(async (m) => {
      const student = await this.assertUsableStudent(m, input.studentId);
      await this.assertOnePerStudent(m, student.id);
      const { batch, centre } = await this.assertAssignableBatch(m, input.batchId);
      const isActive = input.isActive ?? true;
      /* Only an active assignment holds a seat. */
      if (isActive) await this.assertSeat(m, batch);
      const reasonCode = input.reasonCode ?? null;
      this.assertReason(student, centre, reasonCode);

      const assignment = await repo.create(
        { batchId: batch.id, studentId: student.id, reasonCode, remarks: input.remarks ?? null, isActive },
        m,
      );
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.BATCH_ASSIGNMENT_CREATE,
        resource: 'batch-assignment',
        resourceId: assignment.id,
        details: { studentId: student.id, studentCode: student.code, batchId: batch.id, batchCode: batch.code, reasonCode, isActive },
      });
      return assignment.id;
    });
    return this.get(id);
  }

  async update(id: string, input: UpdateBatchAssignmentInput, req?: Request): Promise<PublicBatchAssignmentDetail> {
    await AppDataSource.transaction(async (m) => {
      /* Locked, so isActive and batchId below are current even if a status change raced this edit. */
      const assignment = await repo.lockAssignment(id, m);
      if (!assignment) throw AppError.notFound('Batch assignment not found');

      const batchId = input.batchId ?? assignment.batchId;
      const moved = batchId !== assignment.batchId;
      const reasonCode = input.reasonCode !== undefined ? input.reasonCode : assignment.reasonCode;

      /* A move re-runs the batch, seat and reason checks; clearing or changing the reason re-runs the reason check. */
      if (moved || input.reasonCode !== undefined) {
        let centre: TrainingCentre;
        if (moved) {
          /* Source and target batch, in id order; assertAssignableBatch then re-reads the target under its lock. */
          await repo.lockBatches([assignment.batchId, batchId], m);
          const target = await this.assertAssignableBatch(m, batchId);
          if (assignment.isActive) await this.assertSeat(m, target.batch);
          centre = target.centre;
        } else {
          const batch = await m.getRepository(Batch).findOneByOrFail({ id: assignment.batchId });
          centre = await m.getRepository(TrainingCentre).findOneByOrFail({ id: batch.centreId });
        }
        this.assertReason(await repo.findStudent(assignment.studentId, { includeDeleted: true, manager: m }), centre, reasonCode);
      }

      /* assignedAt records when the student was put into the batch they are in now. */
      await repo.update(id, { ...input, batchId, reasonCode, ...(moved ? { assignedAt: new Date() } : {}) }, m);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.BATCH_ASSIGNMENT_UPDATE,
        resource: 'batch-assignment',
        resourceId: id,
        details: { fields: Object.keys(input), movedBatch: moved ? { from: assignment.batchId, to: batchId } : undefined, reasonCode },
      });
    });
    return this.get(id);
  }

  /*
   * Deactivating frees the seat and is never blocked. Re-activating takes a seat again, so it re-checks the
   * capacity under the batch lock, and is refused in a cancelled batch (a cancelled batch holds no students)
   * or when the student is no longer a registered student.
   */
  async setStatus(id: string, isActive: boolean, req?: Request): Promise<PublicBatchAssignmentDetail> {
    await AppDataSource.transaction(async (m) => {
      /* Locked, so the batch checked below is the one the assignment is in now, even after a concurrent move. */
      const assignment = await repo.lockAssignment(id, m);
      if (!assignment) throw AppError.notFound('Batch assignment not found');
      if (isActive && !assignment.isActive) {
        /* Defence in depth: create already refuses these students; the student row is read FOR SHARE. */
        const student = await repo.findStudent(assignment.studentId, { manager: m });
        if (!student) throw AppError.conflict('The student of this assignment has been removed from the register');
        if (!isAssignable(student)) throw AppError.conflict(`${NOT_REGISTERED_MESSAGE}; only registered students can hold a seat`);
        const batch = await repo.lockBatch(assignment.batchId, m);
        if (!batch) throw AppError.conflict('The batch of this assignment no longer exists. Move the student to another batch.');
        if (batch.batchStatus === 'CANCELLED') {
          throw AppError.conflict(`Batch ${batch.code} is cancelled. Move the student to another batch instead.`);
        }
        await this.assertSeat(m, batch);
      }
      await repo.update(id, { isActive }, m);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.BATCH_ASSIGNMENT_STATUS,
        resource: 'batch-assignment',
        resourceId: id,
        details: { isActive, studentId: assignment.studentId, batchId: assignment.batchId },
      });
    });
    return this.get(id);
  }

  /* Soft-deletes the assignment, which frees the seat; the row is kept for audit history. */
  async remove(id: string, req?: Request): Promise<void> {
    await AppDataSource.transaction(async (m) => {
      const assignment = await repo.lockAssignment(id, m);
      if (!assignment) throw AppError.notFound('Batch assignment not found');
      await assertNoDependencies(BATCH_ASSIGNMENT_DEPENDENCIES, id, m);
      await repo.softDelete(id, m);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.BATCH_ASSIGNMENT_DELETE,
        resource: 'batch-assignment',
        resourceId: id,
        details: { studentId: assignment.studentId, batchId: assignment.batchId },
      });
    });
  }

  /*
   * Brings a soft-deleted assignment back, inactive. Refused when the student has been given another
   * assignment meanwhile, when the student or the batch has been removed, or when the student is not a
   * registered student. No free seat is needed: an inactive assignment holds none, and re-activating it
   * (setStatus) checks the capacity then.
   */
  async restore(id: string, req?: Request): Promise<PublicBatchAssignmentDetail> {
    await AppDataSource.transaction(async (m) => {
      const existing = await repo.lockAssignment(id, m, { includeDeleted: true });
      if (!existing) throw AppError.notFound('Batch assignment not found');
      if (!existing.isDelete) throw AppError.conflict('Batch assignment is not deleted');
      /* Read FOR SHARE: the student cannot be deleted while this assignment comes back. */
      const student = await repo.findStudent(existing.studentId, { manager: m });
      if (!student) throw AppError.conflict('The student of this assignment has been removed from the register');
      if (!isAssignable(student)) throw AppError.conflict(`${NOT_REGISTERED_MESSAGE}; only registered students can be assigned`);
      await this.assertOnePerStudent(m, existing.studentId, id);
      /* Locked, so the Batch Master cannot delete the batch while this assignment comes back to it. */
      if (!(await repo.lockBatch(existing.batchId, m))) {
        throw AppError.conflict('The batch of this assignment has been deleted. Create a new assignment instead.');
      }
      await repo.restore(id, m);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.BATCH_ASSIGNMENT_RESTORE,
        resource: 'batch-assignment',
        resourceId: id,
        details: { studentId: existing.studentId, batchId: existing.batchId },
      });
    });
    return this.get(id);
  }
}

export const batchAssignmentService = new BatchAssignmentService();
