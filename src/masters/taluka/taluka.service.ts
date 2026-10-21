import type { Request } from 'express';
import type { EntityManager } from 'typeorm';
import { AppDataSource } from '../../config/database.config';
import { AUDIT_ACTIONS } from '../../shared/constants/app.constants';
import { auditService } from '../../modules/audit';
import { AppError } from '../../shared/errors/app-error';
import type { Paginated } from '../../shared/utils/pagination';
import { districtRepository } from '../district/district.repository';
import { districtService } from '../district/district.service';
import { College } from '../college/college.model';
import { assertNoRefs, countRefs, lockForUpdate, plural } from '../shared/master-refs';
import { TrainingCentre } from '../training-centre/training-centre.model';
import { stateRepository } from '../state/state.repository';
import { Taluka } from './taluka.model';
import { talukaRepository } from './taluka.repository';
import type { CreateTalukaInput, PublicTalukaDetail, TalukaListQuery, UpdateTalukaInput } from './taluka.types';

/* Requires the district and state relations to be joined (every read path joins both). */
const toPublic = (t: Taluka): PublicTalukaDetail => ({
  id: t.id,
  name: t.name,
  code: t.code,
  districtId: t.districtId,
  districtName: t.district.name,
  districtCode: t.district.code,
  districtIsActive: t.district.isActive,
  stateId: t.district.stateId,
  stateName: t.district.state.name,
  stateCode: t.district.state.code,
  isActive: t.isActive,
  createdAt: t.createdAt,
  updatedAt: t.updatedAt,
});

/*
 * Taluka master, the leaf of State -> District -> Taluka.
 *
 * A taluka stores only districtId. The state is derived through the district, so there is no second
 * foreign key that could disagree with it. The consequence for the API: a create or update sends a
 * districtId, and when the client also sends a stateId the server checks that the district really
 * belongs to that state — the cascading dropdown in the browser is never trusted for this.
 *
 * Name is unique within the district. The code is optional but unique within the district when given.
 */
export class TalukaService {
  async list(q: TalukaListQuery): Promise<Paginated<PublicTalukaDetail>> {
    /* A filter naming an unknown parent is a client error, not an empty list that looks like real data. */
    if (q.stateId && !(await stateRepository.findById(q.stateId))) {
      throw AppError.badRequest('The selected state does not exist', [{ field: 'stateId', message: 'Unknown state' }]);
    }
    if (q.districtId && !(await districtRepository.findById(q.districtId))) {
      throw AppError.badRequest('The selected district does not exist', [{ field: 'districtId', message: 'Unknown district' }]);
    }
    const page = await talukaRepository.list(q);
    return { items: page.items.map(toPublic), meta: page.meta };
  }

  async get(id: string): Promise<PublicTalukaDetail> {
    const taluka = await talukaRepository.findByIdWithParents(id);
    if (!taluka) throw AppError.notFound('Taluka not found');
    return toPublic(taluka);
  }

  /*
   * Resolves the district a write targets and verifies the hierarchy.
   *
   * `stateId` is what the form had selected in its first dropdown. It is optional, and it is never used
   * to decide anything — only to reject a mismatch, which is what catches a stale or tampered-with
   * cascading dropdown.
   */
  private async resolveDistrict(districtId: string, stateId: string | undefined, m: EntityManager) {
    const district = await districtService.assertUsable(districtId, m);
    if (stateId && district.stateId !== stateId) {
      throw AppError.badRequest('The selected district does not belong to the selected state', [
        { field: 'districtId', message: 'Choose a district of the selected state' },
      ]);
    }
    return district;
  }

  /* Name and code must be free within the target district. */
  private async assertUniqueInDistrict(
    districtId: string,
    input: { name?: string; code?: string | null },
    excludeId: string | undefined,
    m: EntityManager,
  ): Promise<void> {
    if (input.name && (await talukaRepository.findByNameInDistrict(districtId, input.name, { excludeId, manager: m }))) {
      throw AppError.conflict('A taluka with this name already exists in the selected district');
    }
    if (input.code && (await talukaRepository.findByCodeInDistrict(districtId, input.code, { excludeId, manager: m }))) {
      throw AppError.conflict('A taluka with this code already exists in the selected district');
    }
  }

  async create(input: CreateTalukaInput & { stateId?: string }, req?: Request): Promise<PublicTalukaDetail> {
    const id = await AppDataSource.transaction(async (m) => {
      const district = await this.resolveDistrict(input.districtId, input.stateId, m);
      await this.assertUniqueInDistrict(district.id, input, undefined, m);
      const taluka = await talukaRepository.create(
        { districtId: district.id, name: input.name, code: input.code ?? null, isActive: input.isActive ?? true },
        m,
      );
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.TALUKA_CREATE,
        resource: 'taluka',
        resourceId: taluka.id,
        details: { name: taluka.name, code: taluka.code, districtId: district.id, districtCode: district.code },
      });
      return taluka.id;
    });
    return this.get(id);
  }

  async update(id: string, input: UpdateTalukaInput & { stateId?: string }, req?: Request): Promise<PublicTalukaDetail> {
    await AppDataSource.transaction(async (m) => {
      /*
       * Locked FOR UPDATE before the move check below counts colleges and centres: one being saved with
       * this taluka concurrently holds it FOR SHARE, so it is either counted or re-reads the moved taluka.
       */
      const taluka = await lockForUpdate(m, Taluka, id);
      if (!taluka) throw AppError.notFound('Taluka not found');

      /*
       * The district the record will live under after this update. When it changes, the name and code
       * are re-validated against the new district even if the client did not send them.
       */
      const districtId = input.districtId ?? taluka.districtId;
      const moved = districtId !== taluka.districtId;
      if (input.districtId || input.stateId) await this.resolveDistrict(districtId, input.stateId, m);
      /*
       * Colleges and training centres store both a district and this taluka. Moving the taluka under them
       * would leave records whose taluka is not in their district, so the move waits until they are re-pointed.
       */
      if (moved) {
        const colleges = await countRefs(m, College, 'talukaId', id);
        const centres = await countRefs(m, TrainingCentre, 'talukaId', id);
        if (colleges + centres > 0) {
          const held = [colleges ? plural(colleges, 'college') : '', centres ? plural(centres, 'training centre') : ''].filter(Boolean).join(' and ');
          throw AppError.conflict(
            `This taluka cannot move to another district while ${held} ${colleges + centres === 1 ? 'references' : 'reference'} it. Re-point those records first.`,
          );
        }
      }
      await this.assertUniqueInDistrict(
        districtId,
        { name: input.name ?? (moved ? taluka.name : undefined), code: input.code ?? (moved ? taluka.code : undefined) },
        id,
        m,
      );

      /* stateId is a form field used only for the cross-check above, not a column of this table. */
      const columns: { name?: string; code?: string | null } = {};
      if (input.name !== undefined) columns.name = input.name;
      if (input.code !== undefined) columns.code = input.code;
      await talukaRepository.update(id, { ...columns, districtId }, m);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.TALUKA_UPDATE,
        resource: 'taluka',
        resourceId: id,
        details: { fields: Object.keys(columns), movedDistrict: moved ? { from: taluka.districtId, to: districtId } : undefined },
      });
    });
    return this.get(id);
  }

  async setStatus(id: string, isActive: boolean, req?: Request): Promise<PublicTalukaDetail> {
    await AppDataSource.transaction(async (m) => {
      const taluka = await talukaRepository.findById(id, { manager: m });
      if (!taluka) throw AppError.notFound('Taluka not found');
      await talukaRepository.update(id, { isActive }, m);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.TALUKA_STATUS,
        resource: 'taluka',
        resourceId: id,
        details: { isActive, name: taluka.name },
      });
    });
    return this.get(id);
  }

  /*
   * Soft-deletes the taluka. Refused while a college or training centre names it. The row is locked FOR
   * UPDATE before counting, so a record being saved with it concurrently is either counted here or
   * refused by its own locked parent check (assertUsableRef).
   */
  async remove(id: string, req?: Request): Promise<void> {
    await AppDataSource.transaction(async (m) => {
      const taluka = await lockForUpdate(m, Taluka, id);
      if (!taluka) throw AppError.notFound('Taluka not found');
      /* Colleges and training centres may name the taluka; soft delete must not leave them pointing at a deleted row. */
      assertNoRefs('taluka', [
        { count: await countRefs(m, College, 'talukaId', id), one: 'college' },
        { count: await countRefs(m, TrainingCentre, 'talukaId', id), one: 'training centre' },
      ]);
      await talukaRepository.softDelete(id, m);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.TALUKA_DELETE,
        resource: 'taluka',
        resourceId: id,
        details: { name: taluka.name, code: taluka.code },
      });
    });
  }

  async restore(id: string, req?: Request): Promise<PublicTalukaDetail> {
    await AppDataSource.transaction(async (m) => {
      const existing = await talukaRepository.findByIdIncludingDeleted(id, m);
      if (!existing) throw AppError.notFound('Taluka not found');
      if (!existing.isDelete) throw AppError.conflict('Taluka is not deleted');
      /* The parent district may itself have been deleted or deactivated while this row was gone. */
      await districtService.assertUsable(existing.districtId, m);
      await this.assertUniqueInDistrict(existing.districtId, { name: existing.name, code: existing.code }, id, m);
      await talukaRepository.restore(id, m);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.TALUKA_RESTORE,
        resource: 'taluka',
        resourceId: id,
        details: { name: existing.name },
      });
    });
    return this.get(id);
  }
}

export const talukaService = new TalukaService();
