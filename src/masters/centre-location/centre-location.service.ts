import type { Request } from 'express';
import type { EntityManager } from 'typeorm';
import { AppDataSource } from '../../config/database.config';
import { AUDIT_ACTIONS } from '../../shared/constants/app.constants';
import { auditService } from '../../modules/audit';
import { AppError } from '../../shared/errors/app-error';
import type { Paginated } from '../../shared/utils/pagination';
import { assertUsableRef } from '../shared/master-refs';
import { TrainingCentre } from '../training-centre/training-centre.model';
import type { CentreLocation } from './centre-location.model';
import { centreLocationRepository } from './centre-location.repository';
import type {
  CentreLocationListQuery, CreateCentreLocationInput, PublicCentreLocationDetail, UpdateCentreLocationInput,
} from './centre-location.types';
import { assertNoDependencies } from '../../shared/dependencies/dependencies';
import { CENTRE_LOCATION_DEPENDENCIES } from '../masters.dependencies';

/* Requires the centre relation to be joined (every read path in CentreLocationRepository joins it). */
const toPublic = (l: CentreLocation): PublicCentreLocationDetail => ({
  id: l.id,
  centreId: l.centreId,
  centreName: l.centre.name,
  centreCode: l.centre.code,
  centreIsActive: l.centre.isActive,
  address: l.address,
  pinCode: l.pinCode,
  locationUrl: l.locationUrl,
  nearestLandmark: l.nearestLandmark,
  nearestStation: l.nearestStation,
  publicTransport: l.publicTransport,
  parking: l.parking,
  remarks: l.remarks,
  isActive: l.isActive,
  createdAt: l.createdAt,
  updatedAt: l.updatedAt,
});

const RESOURCE = 'centre-location';

/*
 * Location Information master: the address, map link and accessibility details of one training centre.
 *
 * At most one non-deleted record per centre (partial unique index on centreId). The centre is chosen on
 * create, must then be usable (exists, not deleted, active), and never changes afterwards. Nothing
 * references this record, so deletion is never blocked.
 */
export class CentreLocationService {
  async list(q: CentreLocationListQuery): Promise<Paginated<PublicCentreLocationDetail>> {
    /* A filter naming an unknown centre is a client error, not an empty list that looks like real data. */
    if (q.centreId && !(await AppDataSource.getRepository(TrainingCentre).exists({ where: { id: q.centreId, isDelete: false } }))) {
      throw AppError.badRequest('The selected training centre does not exist', [{ field: 'centreId', message: 'Unknown training centre' }]);
    }
    const page = await centreLocationRepository.list(q);
    return { items: page.items.map(toPublic), meta: page.meta };
  }

  async get(id: string): Promise<PublicCentreLocationDetail> {
    const location = await centreLocationRepository.findByIdWithCentre(id);
    if (!location) throw AppError.notFound('Location information not found');
    return toPublic(location);
  }

  /* One record per centre. Checked here for a readable 409; the unique index is the real guarantee. */
  private async assertCentreFree(centreId: string, excludeId: string | undefined, m: EntityManager): Promise<void> {
    if (await centreLocationRepository.findByCentre(centreId, { excludeId, manager: m })) {
      throw AppError.conflict('This training centre already has location information. Edit the existing record instead.');
    }
  }

  async create(input: CreateCentreLocationInput, req?: Request): Promise<PublicCentreLocationDetail> {
    const id = await AppDataSource.transaction(async (m) => {
      const centre = await assertUsableRef(m, TrainingCentre, input.centreId, 'centreId', 'training centre');
      await this.assertCentreFree(centre.id, undefined, m);
      const location = await centreLocationRepository.create(
        {
          centreId: centre.id,
          address: input.address,
          pinCode: input.pinCode ?? null,
          locationUrl: input.locationUrl ?? null,
          nearestLandmark: input.nearestLandmark ?? null,
          nearestStation: input.nearestStation ?? null,
          publicTransport: input.publicTransport ?? null,
          parking: input.parking ?? null,
          remarks: input.remarks ?? null,
          isActive: input.isActive ?? true,
        },
        m,
      );
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.CENTRE_LOCATION_CREATE,
        resource: RESOURCE,
        resourceId: location.id,
        details: { centreId: centre.id, centreCode: centre.code, isActive: location.isActive },
      });
      return location.id;
    });
    return this.get(id);
  }

  async update(id: string, input: UpdateCentreLocationInput, req?: Request): Promise<PublicCentreLocationDetail> {
    await AppDataSource.transaction(async (m) => {
      const location = await centreLocationRepository.findById(id, { manager: m });
      if (!location) throw AppError.notFound('Location information not found');
      await centreLocationRepository.update(id, { ...input }, m);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.CENTRE_LOCATION_UPDATE,
        resource: RESOURCE,
        resourceId: id,
        details: { centreId: location.centreId, fields: Object.keys(input) },
      });
    });
    return this.get(id);
  }

  /* Deactivation is never blocked: nothing depends on this record. */
  async setStatus(id: string, isActive: boolean, req?: Request): Promise<PublicCentreLocationDetail> {
    await AppDataSource.transaction(async (m) => {
      const location = await centreLocationRepository.findById(id, { manager: m });
      if (!location) throw AppError.notFound('Location information not found');
      await centreLocationRepository.update(id, { isActive }, m);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.CENTRE_LOCATION_STATUS,
        resource: RESOURCE,
        resourceId: id,
        details: { isActive, centreId: location.centreId },
      });
    });
    return this.get(id);
  }

  /* Soft-deletes the record (isDelete = true, isActive = false), which frees the centre for a new one. */
  async remove(id: string, req?: Request): Promise<void> {
    await AppDataSource.transaction(async (m) => {
      const location = await centreLocationRepository.findById(id, { manager: m });
      if (!location) throw AppError.notFound('Location information not found');
      await assertNoDependencies(CENTRE_LOCATION_DEPENDENCIES, id, m);
      await centreLocationRepository.softDelete(id, m);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.CENTRE_LOCATION_DELETE,
        resource: RESOURCE,
        resourceId: id,
        details: { centreId: location.centreId, address: location.address },
      });
    });
  }

  /*
   * Brings a soft-deleted record back, inactive. Refused when its centre is no longer usable, or when
   * the centre has been given a new location record in the meantime.
   */
  async restore(id: string, req?: Request): Promise<PublicCentreLocationDetail> {
    await AppDataSource.transaction(async (m) => {
      const existing = await centreLocationRepository.findByIdIncludingDeleted(id, m);
      if (!existing) throw AppError.notFound('Location information not found');
      if (!existing.isDelete) throw AppError.conflict('Location information is not deleted');
      await assertUsableRef(m, TrainingCentre, existing.centreId, 'centreId', 'training centre');
      await this.assertCentreFree(existing.centreId, id, m);
      await centreLocationRepository.restore(id, m);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.CENTRE_LOCATION_RESTORE,
        resource: RESOURCE,
        resourceId: id,
        details: { centreId: existing.centreId },
      });
    });
    return this.get(id);
  }
}

export const centreLocationService = new CentreLocationService();
