import type { Request } from 'express';
import type { EntityManager } from 'typeorm';
import { AppDataSource } from '../../config/database.config';
import { AUDIT_ACTIONS } from '../../shared/constants/app.constants';
import { auditService } from '../../modules/audit';
import { AppError } from '../../shared/errors/app-error';
import type { Paginated } from '../../shared/utils/pagination';
import { BatchAssignment } from '../batch-assignment/batch-assignment.model';
import { assertNoRefs, assertUsableRef, countRefs, plural } from '../shared/master-refs';
import { TrainingCentre } from '../training-centre/training-centre.model';
import type { Batch } from './batch.model';
import { batchRepository } from './batch.repository';
import type {
  BatchAssignmentCounts, BatchListQuery, BatchOption, CreateBatchInput, PublicBatchDetail, UpdateBatchInput,
} from './batch.types';

const NO_ASSIGNMENTS: BatchAssignmentCounts = { assignedCount: 0, assignmentCount: 0 };

/* Requires the centre relation to be joined (every read path in BatchRepository joins it). */
const toPublic = (b: Batch, { assignedCount, assignmentCount }: BatchAssignmentCounts): PublicBatchDetail => ({
  id: b.id,
  centreId: b.centreId,
  centreName: b.centre.name,
  centreCode: b.centre.code,
  centreIsActive: b.centre.isActive,
  name: b.name,
  code: b.code,
  trackName: b.trackName,
  capacity: b.capacity,
  startDate: b.startDate,
  endDate: b.endDate,
  deliveryMode: b.deliveryMode,
  batchStatus: b.batchStatus,
  assignedCount,
  assignmentCount,
  seatsLeft: Math.max(0, b.capacity - assignedCount),
  isActive: b.isActive,
  createdAt: b.createdAt,
  updatedAt: b.updatedAt,
});

/* Generated codes: AMK-B-{centreCode}-001, -002, … per centre. */
const codePrefix = (centreCode: string) => `AMK-B-${centreCode}-`;

/* Students holding a seat in a batch (active, non-deleted assignments). */
const seatsTaken = (m: EntityManager, batchId: string) => countRefs(m, BatchAssignment, 'batchId', batchId, { activeOnly: true });
/* Every non-deleted assignment, active or not: these pin the batch's centre and code and block deletion. */
const assignmentsOf = (m: EntityManager, batchId: string) => countRefs(m, BatchAssignment, 'batchId', batchId);

const centreLabel = 'training centre';

/*
 * Batch Master (AMRUT_KALASH_02 Table 40).
 *
 * A batch always belongs to one training centre, re-checked server-side through assertUsableRef on create,
 * on a centre change and on restore. Its name is unique within the centre and its code unique overall
 * (both also partial unique indexes); a blank code is generated as AMK-B-{centreCode}-{NNN}, and a
 * generated code is regenerated for the new centre when the batch moves.
 *
 * Once students are assigned (any non-deleted assignment, active or inactive: assignmentCount), the
 * batch's centre and code are fixed and it cannot be deleted. Its capacity may not drop below the seats
 * taken, and it cannot be cancelled while it holds active students (both: assignedCount).
 */
export class BatchService {
  async list(q: BatchListQuery): Promise<Paginated<PublicBatchDetail>> {
    /* A filter naming an unknown centre is a client error, not an empty list that looks like real data. */
    if (q.centreId && !(await AppDataSource.getRepository(TrainingCentre).exists({ where: { id: q.centreId, isDelete: false } }))) {
      throw AppError.badRequest('The selected training centre does not exist', [{ field: 'centreId', message: 'Unknown training centre' }]);
    }
    const page = await batchRepository.list(q);
    const counts = await batchRepository.assignmentCounts(page.items.map((b) => b.id));
    return { items: page.items.map((b) => toPublic(b, counts.get(b.id) ?? NO_ASSIGNMENTS)), meta: page.meta };
  }

  async get(id: string): Promise<PublicBatchDetail> {
    const batch = await batchRepository.findByIdWithCentre(id);
    if (!batch) throw AppError.notFound('Batch not found');
    const counts = await batchRepository.assignmentCounts([id]);
    return toPublic(batch, counts.get(id) ?? NO_ASSIGNMENTS);
  }

  /*
   * Dropdown feed: active, non-deleted batches, A to Z. With assignable = true only the batches Assign
   * Batch can use: lifecycle OPEN and the centre active (seats are checked when the assignment is saved).
   * Each row carries its centre's code so Assign Batch can tell in advance whether a reason is required.
   */
  async options(assignable = false): Promise<BatchOption[]> {
    const rows = await batchRepository.findSelectable({ assignable });
    return rows.map((b) => ({ id: b.id, name: b.name, code: b.code, centreCode: b.centre.code }));
  }

  /* Name must be free within the centre, code free across all batches. */
  private async assertUnique(
    centreId: string,
    input: { name?: string; code?: string },
    excludeId: string | undefined,
    m: EntityManager,
  ): Promise<void> {
    if (input.name && (await batchRepository.findByNameInCentre(centreId, input.name, { excludeId, manager: m }))) {
      throw AppError.conflict('A batch with this name already exists at the selected training centre');
    }
    if (input.code && (await batchRepository.findByCode(input.code, { excludeId, manager: m }))) {
      throw AppError.conflict('A batch with this code already exists');
    }
  }

  /* Dates are 'YYYY-MM-DD', so string order is calendar order. Same rule as the CHK_batches_dates constraint. */
  private assertDates(startDate: string, endDate: string | null): void {
    if (endDate && endDate <= startDate) {
      throw AppError.badRequest('The end date must be after the start date', [{ field: 'endDate', message: 'End date must be after the start date' }]);
    }
  }

  /*
   * Next free AMK-B-{centreCode}-{NNN}. Codes still held by soft-deleted batches count as taken, so a
   * generated code is never reused and restoring a deleted batch cannot collide with it. The centre row is
   * locked FOR UPDATE first (create, and update after a move, already hold that lock and taking it again is
   * free; an update that only regenerates takes it here), so two batches created at the same centre at the
   * same moment cannot both pick the same number.
   */
  private async generateCode(centre: TrainingCentre, excludeId: string | undefined, m: EntityManager): Promise<string> {
    await m.getRepository(TrainingCentre).createQueryBuilder('c').setLock('pessimistic_write').where('c.id = :id', { id: centre.id }).getOne();
    const prefix = codePrefix(centre.code);
    const taken = await batchRepository.codesWithPrefix(prefix, { excludeId, manager: m });
    let n = 1;
    while (taken.has(`${prefix}${String(n).padStart(3, '0')}`)) n += 1;
    return `${prefix}${String(n).padStart(3, '0')}`;
  }

  async create(input: CreateBatchInput, req?: Request): Promise<PublicBatchDetail> {
    const id = await AppDataSource.transaction(async (m) => {
      /*
       * FOR UPDATE, not FOR SHARE: a centre being deleted waits for this batch (and vice versa), and the
       * code generator needs this very lock, so no weaker lock is ever upgraded (two upgrades deadlock).
       */
      const centre = await assertUsableRef(m, TrainingCentre, input.centreId, 'centreId', centreLabel, 'pessimistic_write');
      this.assertDates(input.startDate, input.endDate ?? null);
      const code = input.code ?? (await this.generateCode(centre, undefined, m));
      await this.assertUnique(centre.id, { name: input.name, code }, undefined, m);
      const batch = await batchRepository.create(
        {
          centreId: centre.id,
          name: input.name,
          code,
          trackName: input.trackName ?? null,
          capacity: input.capacity,
          startDate: input.startDate,
          endDate: input.endDate ?? null,
          deliveryMode: input.deliveryMode,
          batchStatus: input.batchStatus ?? 'PLANNED',
          isActive: input.isActive ?? true,
        },
        m,
      );
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.BATCH_CREATE,
        resource: 'batch',
        resourceId: batch.id,
        details: { name: batch.name, code: batch.code, centreId: centre.id, centreCode: centre.code, generatedCode: !input.code },
      });
      return batch.id;
    });
    return this.get(id);
  }

  async update(id: string, input: UpdateBatchInput, req?: Request): Promise<PublicBatchDetail> {
    await AppDataSource.transaction(async (m) => {
      /* Locked: Assign Batch counts seats under the same lock, so capacity and assignments cannot race. */
      const batch = await batchRepository.findByIdForUpdate(id, m);
      if (!batch) throw AppError.notFound('Batch not found');
      const assignments = await assignmentsOf(m, id);
      const taken = await seatsTaken(m, id);

      /* The centre the batch will belong to after this update. */
      const centreId = input.centreId ?? batch.centreId;
      const moved = centreId !== batch.centreId;
      if (moved && assignments > 0) {
        throw AppError.conflict(`The training centre cannot be changed while ${plural(assignments, 'student')} ${assignments === 1 ? 'is' : 'are'} assigned to this batch`);
      }
      /* Locked FOR UPDATE for the same reasons as in create (lock order: batch row, then centre row). */
      const newCentre = moved
        ? await assertUsableRef(m, TrainingCentre, centreId, 'centreId', centreLabel, 'pessimistic_write')
        : null;

      /*
       * undefined keeps the code; null regenerates it for the batch's centre. The batch's own code is not
       * counted as taken, so clearing an already generated code and saving gives the same code back.
       *
       * A move also regenerates a code that was generated for the old centre (AMK-B-{oldCentreCode}-…)
       * unless the client sent a different code. The edit form sends the current code back unchanged, so
       * that counts as "not sent". Left alone, the code would name a centre the batch has left, and it
       * becomes immutable with the first assignment. (A move is refused while assignments exist, above.)
       */
      let regenerate = input.code === null;
      if (newCentre && (input.code === undefined || input.code === batch.code)) {
        const oldCentre = await m.getRepository(TrainingCentre).findOneByOrFail({ id: batch.centreId });
        regenerate = batch.code.startsWith(codePrefix(oldCentre.code));
      }
      let code = input.code ?? batch.code;
      if (regenerate) {
        const centre = newCentre ?? (await m.getRepository(TrainingCentre).findOneByOrFail({ id: centreId }));
        code = await this.generateCode(centre, id, m);
      }
      const codeChanged = code !== batch.code;
      if (codeChanged && assignments > 0) {
        throw AppError.conflict(`The batch code cannot be changed while ${plural(assignments, 'student')} ${assignments === 1 ? 'is' : 'are'} assigned to this batch`);
      }

      this.assertDates(input.startDate ?? batch.startDate, input.endDate !== undefined ? input.endDate : batch.endDate);

      if (input.capacity !== undefined && input.capacity < taken) {
        const message = `Capacity cannot be lower than the ${plural(taken, 'student')} already assigned`;
        throw AppError.badRequest(message, [{ field: 'capacity', message }]);
      }
      if (input.batchStatus === 'CANCELLED' && batch.batchStatus !== 'CANCELLED' && taken > 0) {
        throw AppError.conflict(`Reassign ${plural(taken, 'student')} before cancelling`);
      }

      /* A name that was free in one centre may be taken in another, so a move re-checks it. */
      await this.assertUnique(
        centreId,
        { name: input.name ?? (moved ? batch.name : undefined), code: codeChanged ? code : undefined },
        id,
        m,
      );

      await batchRepository.update(id, { ...input, centreId, code }, m);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.BATCH_UPDATE,
        resource: 'batch',
        resourceId: id,
        details: {
          fields: Object.keys(input),
          from: { name: batch.name, code: batch.code, capacity: batch.capacity, batchStatus: batch.batchStatus },
          movedCentre: moved ? { from: batch.centreId, to: centreId } : undefined,
          generatedCode: regenerate ? code : undefined,
        },
      });
    });
    return this.get(id);
  }

  /* Deactivation is never blocked: an inactive batch simply stops being offered for new assignments. */
  async setStatus(id: string, isActive: boolean, req?: Request): Promise<PublicBatchDetail> {
    await AppDataSource.transaction(async (m) => {
      const batch = await batchRepository.findById(id, { manager: m });
      if (!batch) throw AppError.notFound('Batch not found');
      await batchRepository.update(id, { isActive }, m);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.BATCH_STATUS,
        resource: 'batch',
        resourceId: id,
        details: { isActive, name: batch.name, code: batch.code },
      });
    });
    return this.get(id);
  }

  /* Soft-deletes the batch. Refused while any (active or inactive) student assignment references it. */
  async remove(id: string, req?: Request): Promise<void> {
    await AppDataSource.transaction(async (m) => {
      const batch = await batchRepository.findByIdForUpdate(id, m);
      if (!batch) throw AppError.notFound('Batch not found');
      assertNoRefs('batch', [{ count: await assignmentsOf(m, id), one: 'student assignment' }]);
      await batchRepository.softDelete(id, m);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.BATCH_DELETE,
        resource: 'batch',
        resourceId: id,
        details: { name: batch.name, code: batch.code },
      });
    });
  }

  /* Brings a soft-deleted batch back, inactive. Refused when its centre, name or code is unavailable. */
  async restore(id: string, req?: Request): Promise<PublicBatchDetail> {
    await AppDataSource.transaction(async (m) => {
      const existing = await batchRepository.findByIdIncludingDeleted(id, m);
      if (!existing) throw AppError.notFound('Batch not found');
      if (!existing.isDelete) throw AppError.conflict('Batch is not deleted');
      /* The centre may itself have been deleted or deactivated while this row was gone. */
      await assertUsableRef(m, TrainingCentre, existing.centreId, 'centreId', centreLabel);
      await this.assertUnique(existing.centreId, { name: existing.name, code: existing.code }, id, m);
      await batchRepository.restore(id, m);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.BATCH_RESTORE,
        resource: 'batch',
        resourceId: id,
        details: { name: existing.name, code: existing.code },
      });
    });
    return this.get(id);
  }
}

export const batchService = new BatchService();
