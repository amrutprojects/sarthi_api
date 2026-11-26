import type { Request } from 'express';
import type { EntityManager } from 'typeorm';
import { AppDataSource } from '../../config/database.config';
import { AUDIT_ACTIONS } from '../../shared/constants/app.constants';
import { auditService } from '../../modules/audit';
import { AppError } from '../../shared/errors/app-error';
import type { Paginated } from '../../shared/utils/pagination';
import { assertUsableRef } from '../shared/master-refs';
import { TrainingCentre } from '../training-centre/training-centre.model';
import type { CentreInfrastructure } from './centre-infrastructure.model';
import { centreInfrastructureRepository } from './centre-infrastructure.repository';
import type {
  CentreInfrastructureListQuery, CentreInfrastructureSummary, CreateCentreInfrastructureInput,
  PublicCentreInfrastructureDetail, UpdateCentreInfrastructureInput,
} from './centre-infrastructure.types';
import { assertNoDependencies } from '../../shared/dependencies/dependencies';
import { CENTRE_INFRASTRUCTURE_DEPENDENCIES } from '../masters.dependencies';

/* Requires the centre relation to be joined (every read path in CentreInfrastructureRepository joins it). */
const toPublic = (ci: CentreInfrastructure): PublicCentreInfrastructureDetail => ({
  id: ci.id,
  centreId: ci.centreId,
  centreName: ci.centre.name,
  centreCode: ci.centre.code,
  centreIsActive: ci.centre.isActive,
  maxSeatingCapacity: ci.maxSeatingCapacity,
  numberOfFloors: ci.numberOfFloors,
  trainingRooms: ci.trainingRooms,
  computerSystems: ci.computerSystems,
  internetType: ci.internetType,
  internetSpeed: ci.internetSpeed,
  hasLift: ci.hasLift,
  hasAc: ci.hasAc,
  hasWashroom: ci.hasWashroom,
  hasDrinkingWater: ci.hasDrinkingWater,
  powerBackup: ci.powerBackup,
  facilities: ci.facilities ?? {},
  isActive: ci.isActive,
  createdAt: ci.createdAt,
  updatedAt: ci.updatedAt,
});

const RESOURCE = 'centre-infrastructure';
const NOT_FOUND = 'Capacity and infrastructure details not found';

/*
 * Capacity & Infrastructure master: seating, rooms, connectivity, amenities and the 20-facility
 * checklist of one training centre.
 *
 * At most one non-deleted record per centre (partial unique index on centreId). The centre is chosen on
 * create, must then be usable (exists, not deleted, active), and never changes afterwards. Nothing
 * references this record, so deletion is never blocked.
 */
export class CentreInfrastructureService {
  /* A filter naming an unknown centre is a client error, not an empty list that looks like real data. */
  private async assertKnownCentre(centreId: string | undefined): Promise<void> {
    if (centreId && !(await AppDataSource.getRepository(TrainingCentre).exists({ where: { id: centreId, isDelete: false } }))) {
      throw AppError.badRequest('The selected training centre does not exist', [{ field: 'centreId', message: 'Unknown training centre' }]);
    }
  }

  async list(q: CentreInfrastructureListQuery): Promise<Paginated<PublicCentreInfrastructureDetail>> {
    await this.assertKnownCentre(q.centreId);
    const page = await centreInfrastructureRepository.list(q);
    return { items: page.items.map(toPublic), meta: page.meta };
  }

  /* Listing KPIs: record counts and the seating capacity of the active records. */
  async summary(centreId?: string): Promise<CentreInfrastructureSummary> {
    await this.assertKnownCentre(centreId);
    const s = await centreInfrastructureRepository.summary(centreId);
    return { total: s.total, active: s.active, inactive: s.total - s.active, activeSeatingCapacity: s.activeSeatingCapacity };
  }

  async get(id: string): Promise<PublicCentreInfrastructureDetail> {
    const record = await centreInfrastructureRepository.findByIdWithCentre(id);
    if (!record) throw AppError.notFound(NOT_FOUND);
    return toPublic(record);
  }

  /* One record per centre. Checked here for a readable 409; the unique index is the real guarantee. */
  private async assertCentreFree(centreId: string, excludeId: string | undefined, m: EntityManager): Promise<void> {
    if (await centreInfrastructureRepository.findByCentre(centreId, { excludeId, manager: m })) {
      throw AppError.conflict('This training centre already has capacity and infrastructure details. Edit the existing record instead.');
    }
  }

  async create(input: CreateCentreInfrastructureInput, req?: Request): Promise<PublicCentreInfrastructureDetail> {
    const id = await AppDataSource.transaction(async (m) => {
      const centre = await assertUsableRef(m, TrainingCentre, input.centreId, 'centreId', 'training centre');
      await this.assertCentreFree(centre.id, undefined, m);
      const record = await centreInfrastructureRepository.create(
        {
          centreId: centre.id,
          maxSeatingCapacity: input.maxSeatingCapacity,
          numberOfFloors: input.numberOfFloors ?? null,
          trainingRooms: input.trainingRooms ?? null,
          computerSystems: input.computerSystems ?? null,
          internetType: input.internetType ?? null,
          internetSpeed: input.internetSpeed ?? null,
          hasLift: input.hasLift ?? null,
          hasAc: input.hasAc ?? null,
          hasWashroom: input.hasWashroom ?? null,
          hasDrinkingWater: input.hasDrinkingWater ?? null,
          powerBackup: input.powerBackup ?? null,
          facilities: input.facilities ?? {},
          isActive: input.isActive ?? true,
        },
        m,
      );
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.CENTRE_INFRA_CREATE,
        resource: RESOURCE,
        resourceId: record.id,
        details: { centreId: centre.id, centreCode: centre.code, maxSeatingCapacity: record.maxSeatingCapacity, isActive: record.isActive },
      });
      return record.id;
    });
    return this.get(id);
  }

  /* `facilities`, when sent, replaces the whole map: the form always submits the complete checklist. */
  async update(id: string, input: UpdateCentreInfrastructureInput, req?: Request): Promise<PublicCentreInfrastructureDetail> {
    await AppDataSource.transaction(async (m) => {
      const record = await centreInfrastructureRepository.findById(id, { manager: m });
      if (!record) throw AppError.notFound(NOT_FOUND);
      await centreInfrastructureRepository.update(id, { ...input }, m);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.CENTRE_INFRA_UPDATE,
        resource: RESOURCE,
        resourceId: id,
        details: { centreId: record.centreId, fields: Object.keys(input) },
      });
    });
    return this.get(id);
  }

  /* Deactivation is never blocked: nothing depends on this record. */
  async setStatus(id: string, isActive: boolean, req?: Request): Promise<PublicCentreInfrastructureDetail> {
    await AppDataSource.transaction(async (m) => {
      const record = await centreInfrastructureRepository.findById(id, { manager: m });
      if (!record) throw AppError.notFound(NOT_FOUND);
      await centreInfrastructureRepository.update(id, { isActive }, m);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.CENTRE_INFRA_STATUS,
        resource: RESOURCE,
        resourceId: id,
        details: { isActive, centreId: record.centreId },
      });
    });
    return this.get(id);
  }

  /* Soft-deletes the record (isDelete = true, isActive = false), which frees the centre for a new one. */
  async remove(id: string, req?: Request): Promise<void> {
    await AppDataSource.transaction(async (m) => {
      const record = await centreInfrastructureRepository.findById(id, { manager: m });
      if (!record) throw AppError.notFound(NOT_FOUND);
      await assertNoDependencies(CENTRE_INFRASTRUCTURE_DEPENDENCIES, id, m);
      await centreInfrastructureRepository.softDelete(id, m);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.CENTRE_INFRA_DELETE,
        resource: RESOURCE,
        resourceId: id,
        details: { centreId: record.centreId, maxSeatingCapacity: record.maxSeatingCapacity },
      });
    });
  }

  /*
   * Brings a soft-deleted record back, inactive. Refused when its centre is no longer usable, or when
   * the centre has been given a new infrastructure record in the meantime.
   */
  async restore(id: string, req?: Request): Promise<PublicCentreInfrastructureDetail> {
    await AppDataSource.transaction(async (m) => {
      const existing = await centreInfrastructureRepository.findByIdIncludingDeleted(id, m);
      if (!existing) throw AppError.notFound(NOT_FOUND);
      if (!existing.isDelete) throw AppError.conflict('Capacity and infrastructure details are not deleted');
      await assertUsableRef(m, TrainingCentre, existing.centreId, 'centreId', 'training centre');
      await this.assertCentreFree(existing.centreId, id, m);
      await centreInfrastructureRepository.restore(id, m);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.CENTRE_INFRA_RESTORE,
        resource: RESOURCE,
        resourceId: id,
        details: { centreId: existing.centreId },
      });
    });
    return this.get(id);
  }
}

export const centreInfrastructureService = new CentreInfrastructureService();
