import type { Request } from 'express';
import type { EntityManager } from 'typeorm';
import { AppDataSource } from '../../../config/database.config';
import { AUDIT_ACTIONS } from '../../../shared/constants/app.constants';
import { District } from './district.model';
import { districtRepository } from './district.repository';
import { assertNoRefs, assertUsableRef, countRefs, lockForUpdate } from '../../../masters/shared/master-refs';
import { Centre } from '../../../masters/centre/centre.model';
import { College } from '../../../masters/college/college.model';
import { MasterDocument } from '../../../masters/document/document.model';
import { TrainingCentre } from '../../../masters/training-centre/training-centre.model';
import { stateRepository } from '../state/state.repository';
import { AppError } from '../../../shared/errors/app-error';
import type { Paginated } from '../../../shared/utils/pagination';
import { auditService } from '../../../modules/audit/audit.service';
import { assertUsableState } from '../state/state.service';
import type { CreateDistrictInput, DistrictListQuery, PublicDistrictDetail, UpdateDistrictInput } from './district.types';

/* Requires the state relation to be joined (every read path in DistrictRepository joins it). */
const toPublic = (d: District): PublicDistrictDetail => ({
  id: d.id,
  name: d.name,
  code: d.code,
  stateId: d.stateId,
  stateName: d.state.name,
  stateCode: d.state.code,
  stateIsActive: d.state.isActive,
  isActive: d.isActive,
  createdAt: d.createdAt,
  updatedAt: d.updatedAt,
});

/*
 * District master. A district always belongs to exactly one state: the foreign key is NOT NULL, and
 * every write re-checks the state server-side through assertUsableState, so no payload can attach a
 * district to a missing, deleted or inactive state.
 *
 * Name and code are unique within the state. Changing the state re-runs both checks against the new
 * state, because a name that was free in one state may already be taken in another.
 */
export class DistrictService {
  async list(q: DistrictListQuery): Promise<Paginated<PublicDistrictDetail>> {
    /* A filter naming an unknown state is a client error, not an empty list that looks like real data. */
    if (q.stateId && !(await stateRepository.findById(q.stateId))) {
      throw AppError.badRequest('The selected state does not exist', [{ field: 'stateId', message: 'Unknown state' }]);
    }
    const page = await districtRepository.list(q);
    return { items: page.items.map(toPublic), meta: page.meta };
  }

  async get(id: string): Promise<PublicDistrictDetail> {
    const district = await districtRepository.findByIdWithState(id);
    if (!district) throw AppError.notFound('District not found');
    return { ...toPublic(district), talukaCount: await districtRepository.countTalukas(id) };
  }

  /*
   * The district a taluka may be attached to: it must exist, not be deleted, and be active.
   *
   * This runs on the server for every taluka write, independently of what the dropdown offered: a
   * client can post any districtId it likes, so cascading dropdowns are a convenience, never the
   * integrity check. The district is read FOR SHARE (assertUsableRef), so it cannot be deleted under a
   * taluka being saved; see remove() for the other half.
   */
  assertUsable(districtId: string, manager: EntityManager): Promise<District> {
    return assertUsableRef(manager, District, districtId, 'districtId', 'district');
  }

  /* Name and code must be free within the target state. */
  private async assertUniqueInState(
    stateId: string,
    input: { name?: string; code?: string },
    excludeId: string | undefined,
    m: EntityManager,
  ): Promise<void> {
    if (input.name && (await districtRepository.findByNameInState(stateId, input.name, { excludeId, manager: m }))) {
      throw AppError.conflict('A district with this name already exists in the selected state');
    }
    if (input.code && (await districtRepository.findByCodeInState(stateId, input.code, { excludeId, manager: m }))) {
      throw AppError.conflict('A district with this code already exists in the selected state');
    }
  }

  async create(input: CreateDistrictInput, req?: Request): Promise<PublicDistrictDetail> {
    const id = await AppDataSource.transaction(async (m) => {
      const state = await assertUsableState(input.stateId, m);
      await this.assertUniqueInState(state.id, input, undefined, m);
      const district = await districtRepository.create(
        { stateId: state.id, name: input.name, code: input.code, isActive: input.isActive ?? true },
        m,
      );
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.DISTRICT_CREATE,
        resource: 'district',
        resourceId: district.id,
        details: { name: district.name, code: district.code, stateId: state.id, stateCode: state.code },
      });
      return district.id;
    });
    return this.get(id);
  }

  async update(id: string, input: UpdateDistrictInput, req?: Request): Promise<PublicDistrictDetail> {
    await AppDataSource.transaction(async (m) => {
      const district = await districtRepository.findById(id, { manager: m });
      if (!district) throw AppError.notFound('District not found');

      /*
       * The state the record will live under after this update. When it changes, the name and code are
       * re-validated against the new state even if the client did not send them.
       */
      const stateId = input.stateId ?? district.stateId;
      const moved = stateId !== district.stateId;
      if (input.stateId) await assertUsableState(stateId, m);
      await this.assertUniqueInState(
        stateId,
        { name: input.name ?? (moved ? district.name : undefined), code: input.code ?? (moved ? district.code : undefined) },
        id,
        m,
      );

      await districtRepository.update(id, { ...input, stateId }, m);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.DISTRICT_UPDATE,
        resource: 'district',
        resourceId: id,
        details: { fields: Object.keys(input), movedState: moved ? { from: district.stateId, to: stateId } : undefined },
      });
    });
    return this.get(id);
  }

  /*
   * Deactivation is the safe alternative to deletion and is never blocked: an inactive district stops
   * being offered, so no new taluka can be attached to it and the public site no longer lists it.
   */
  async setStatus(id: string, isActive: boolean, req?: Request): Promise<PublicDistrictDetail> {
    await AppDataSource.transaction(async (m) => {
      const district = await districtRepository.findById(id, { manager: m });
      if (!district) throw AppError.notFound('District not found');
      const talukas = await districtRepository.countTalukas(id, { manager: m });
      await districtRepository.update(id, { isActive }, m);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.DISTRICT_STATUS,
        resource: 'district',
        resourceId: id,
        details: { isActive, name: district.name, talukas },
      });
    });
    return this.get(id);
  }

  /*
   * Soft-deletes the district. Refused while any taluka still references it. The row is locked FOR
   * UPDATE before counting, so a child being saved under it concurrently is either counted here or
   * refused by its own locked parent check (assertUsableRef).
   */
  async remove(id: string, req?: Request): Promise<void> {
    await AppDataSource.transaction(async (m) => {
      const district = await lockForUpdate(m, District, id);
      if (!district) throw AppError.notFound('District not found');
      const talukas = await districtRepository.countTalukas(id, { manager: m });
      if (talukas > 0) {
        const plural = talukas === 1 ? 'taluka' : 'talukas';
        throw AppError.conflict(
          `This district cannot be deleted while ${talukas} ${plural} ${talukas === 1 ? 'references' : 'reference'} it. Deactivate it instead, or move or delete the talukas first.`,
        );
      }
      /* The Masters group also points at districts; soft delete must not leave them referencing a deleted row. */
      assertNoRefs('district', [
        { count: await countRefs(m, College, 'districtId', id), one: 'college' },
        { count: await countRefs(m, TrainingCentre, 'districtId', id), one: 'training centre' },
        { count: await countRefs(m, Centre, 'districtId', id), one: 'center' },
        { count: await countRefs(m, MasterDocument, 'districtId', id), one: 'document' },
      ]);
      await districtRepository.softDelete(id, m);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.DISTRICT_DELETE,
        resource: 'district',
        resourceId: id,
        details: { name: district.name, code: district.code },
      });
    });
  }

  /* Brings a soft-deleted district back, inactive. Refused when its state or its name is unavailable. */
  async restore(id: string, req?: Request): Promise<PublicDistrictDetail> {
    await AppDataSource.transaction(async (m) => {
      const existing = await districtRepository.findByIdIncludingDeleted(id, m);
      if (!existing) throw AppError.notFound('District not found');
      if (!existing.isDelete) throw AppError.conflict('District is not deleted');
      /* The parent state may itself have been deleted or deactivated while this row was gone. */
      await assertUsableState(existing.stateId, m);
      await this.assertUniqueInState(existing.stateId, { name: existing.name, code: existing.code }, id, m);
      await districtRepository.restore(id, m);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.DISTRICT_RESTORE,
        resource: 'district',
        resourceId: id,
        details: { name: existing.name },
      });
    });
    return this.get(id);
  }
}

export const districtService = new DistrictService();
