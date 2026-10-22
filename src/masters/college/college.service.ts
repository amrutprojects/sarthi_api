import type { Request } from 'express';
import type { EntityManager, EntityTarget, FindOptionsWhere } from 'typeorm';
import { AppDataSource } from '../../config/database.config';
import { AUDIT_ACTIONS } from '../../shared/constants/app.constants';
import { auditService } from '../../modules/audit';
import type { AppBaseEntity } from '../../database/base.entity';
import { AppError } from '../../shared/errors/app-error';
import type { Paginated } from '../../shared/utils/pagination';
import type { GeoOption } from '../../cms/masters/geography/geography.types';
import { District } from '../../cms/masters/district/district.model';
import { assertUsableRef } from '../shared/master-refs';
import { State } from '../../cms/masters/state/state.model';
import { Taluka } from '../../cms/masters/taluka/taluka.model';
import type { College } from './college.model';
import { collegeRepository } from './college.repository';
import type { CollegeListQuery, CreateCollegeInput, PublicCollegeDetail, UpdateCollegeInput } from './college.types';

/* Requires the district, state and taluka relations to be joined (every read path in CollegeRepository joins them). */
const toPublic = (c: College): PublicCollegeDetail => ({
  id: c.id,
  name: c.name,
  code: c.code,
  stateId: c.district.stateId,
  stateName: c.district.state.name,
  stateCode: c.district.state.code,
  stateIsActive: c.district.state.isActive,
  districtId: c.districtId,
  districtName: c.district.name,
  districtCode: c.district.code,
  districtIsActive: c.district.isActive,
  talukaId: c.talukaId,
  talukaName: c.taluka?.name ?? null,
  talukaCode: c.taluka?.code ?? null,
  talukaIsActive: c.taluka ? c.taluka.isActive : null,
  address: c.address,
  pinCode: c.pinCode,
  contactNumber: c.contactNumber,
  email: c.email,
  isActive: c.isActive,
  createdAt: c.createdAt,
  updatedAt: c.updatedAt,
});

/* A list filter naming an unknown (or deleted) parent is a client error, not an empty list that looks like real data. */
async function assertFilterParent<T extends AppBaseEntity>(target: EntityTarget<T>, id: string, field: string, label: string): Promise<void> {
  const found = await AppDataSource.manager.getRepository(target).exists({ where: { id, isDelete: false } as FindOptionsWhere<T> });
  if (!found) throw AppError.badRequest(`The selected ${label} does not exist`, [{ field, message: `Unknown ${label}` }]);
}

/*
 * College master.
 *
 * A college stores districtId (required) and talukaId (optional). The state is derived through the
 * district, so there is no second foreign key that could disagree with it; a stateId sent by the form
 * is only used to reject a district of another state (a stale or tampered-with cascading dropdown).
 *
 * Parents are re-checked on the server with assertUsableRef — exists, not deleted, active — on create,
 * whenever the district or taluka changes, and on restore. A taluka must belong to the college's
 * district. An unchanged parent that was deactivated later does not block editing the other fields.
 *
 * Name is unique within the district (case-insensitive), code is unique overall. Every rule here is
 * also enforced by the schema (partial unique indexes, CHECK constraints); the checks exist to answer
 * with a readable 400 / 409 instead of a bare constraint violation.
 */
export class CollegeService {
  async list(q: CollegeListQuery): Promise<Paginated<PublicCollegeDetail>> {
    if (q.stateId) await assertFilterParent(State, q.stateId, 'stateId', 'state');
    if (q.districtId) await assertFilterParent(District, q.districtId, 'districtId', 'district');
    const page = await collegeRepository.list(q);
    return { items: page.items.map(toPublic), meta: page.meta };
  }

  async get(id: string): Promise<PublicCollegeDetail> {
    const college = await collegeRepository.findByIdWithParents(id);
    if (!college) throw AppError.notFound('College not found');
    return toPublic(college);
  }

  /* Dropdown feed: active, non-deleted colleges, A to Z. */
  async options(): Promise<GeoOption[]> {
    const rows = await collegeRepository.findSelectable();
    return rows.map((c) => ({ id: c.id, name: c.name, code: c.code }));
  }

  /* `stateId` is what the form had selected in its first dropdown: it only ever rejects a mismatch. */
  private assertDistrictInState(district: District, stateId: string | undefined): void {
    if (stateId && district.stateId !== stateId) {
      throw AppError.badRequest('The selected district does not belong to the selected state', [
        { field: 'districtId', message: 'Choose a district of the selected state' },
      ]);
    }
  }

  /* The taluka must be usable and lie in the college's district. */
  private async assertTalukaInDistrict(talukaId: string, districtId: string, m: EntityManager): Promise<Taluka> {
    const taluka = await assertUsableRef(m, Taluka, talukaId, 'talukaId', 'taluka');
    if (taluka.districtId !== districtId) {
      throw AppError.badRequest('The selected taluka does not belong to the selected district', [
        { field: 'talukaId', message: 'Choose a taluka of the selected district' },
      ]);
    }
    return taluka;
  }

  /* Name must be free within the target district, code across all colleges. */
  private async assertUnique(
    districtId: string,
    input: { name?: string; code?: string },
    excludeId: string | undefined,
    m: EntityManager,
  ): Promise<void> {
    if (input.name && (await collegeRepository.findByNameInDistrict(districtId, input.name, { excludeId, manager: m }))) {
      throw AppError.conflict('A college with this name already exists in the selected district');
    }
    if (input.code && (await collegeRepository.findByCode(input.code, { excludeId, manager: m }))) {
      throw AppError.conflict('A college with this code already exists');
    }
  }

  async create(input: CreateCollegeInput, req?: Request): Promise<PublicCollegeDetail> {
    const id = await AppDataSource.transaction(async (m) => {
      const district = await assertUsableRef(m, District, input.districtId, 'districtId', 'district');
      this.assertDistrictInState(district, input.stateId);
      if (input.talukaId) await this.assertTalukaInDistrict(input.talukaId, district.id, m);
      await this.assertUnique(district.id, input, undefined, m);
      const college = await collegeRepository.create(
        {
          name: input.name,
          code: input.code,
          districtId: district.id,
          talukaId: input.talukaId ?? null,
          address: input.address ?? null,
          pinCode: input.pinCode ?? null,
          contactNumber: input.contactNumber ?? null,
          email: input.email ?? null,
          isActive: input.isActive ?? true,
        },
        m,
      );
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.COLLEGE_CREATE,
        resource: 'college',
        resourceId: college.id,
        details: { name: college.name, code: college.code, districtId: district.id, talukaId: college.talukaId, isActive: college.isActive },
      });
      return college.id;
    });
    return this.get(id);
  }

  async update(id: string, input: UpdateCollegeInput, req?: Request): Promise<PublicCollegeDetail> {
    await AppDataSource.transaction(async (m) => {
      const college = await collegeRepository.findById(id, { manager: m });
      if (!college) throw AppError.notFound('College not found');

      /*
       * The district the record will live under after this update. When it changes, the new district
       * is checked and the name is re-validated against it even if the client did not send it.
       */
      const districtId = input.districtId ?? college.districtId;
      const moved = districtId !== college.districtId;
      if (moved) {
        const district = await assertUsableRef(m, District, districtId, 'districtId', 'district');
        this.assertDistrictInState(district, input.stateId);
      } else if (input.stateId) {
        const district = await m.getRepository(District).findOne({ where: { id: districtId } });
        if (district) this.assertDistrictInState(district, input.stateId);
      }

      /* The saved taluka belongs to the old district, so moving the college must say what replaces it. */
      if (moved && input.talukaId === undefined && college.talukaId) {
        throw AppError.badRequest('Choose a taluka of the new district, or none, when moving the college', [
          { field: 'talukaId', message: 'Choose a taluka of the selected district, or none' },
        ]);
      }
      const talukaId = input.talukaId === undefined ? college.talukaId : input.talukaId;
      if (talukaId && (moved || talukaId !== college.talukaId)) await this.assertTalukaInDistrict(talukaId, districtId, m);

      await this.assertUnique(districtId, { name: input.name ?? (moved ? college.name : undefined), code: input.code }, id, m);

      /* stateId is a form field used only for the cross-check above, not a column of this table. */
      const { stateId: _stateId, ...columns } = input;
      await collegeRepository.update(id, { ...columns, districtId, talukaId }, m);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.COLLEGE_UPDATE,
        resource: 'college',
        resourceId: id,
        details: {
          fields: Object.keys(columns),
          from: { name: college.name, code: college.code },
          movedDistrict: moved ? { from: college.districtId, to: districtId } : undefined,
        },
      });
    });
    return this.get(id);
  }

  /* Deactivation is never blocked: an inactive college simply stops being offered in dropdowns. */
  async setStatus(id: string, isActive: boolean, req?: Request): Promise<PublicCollegeDetail> {
    await AppDataSource.transaction(async (m) => {
      const college = await collegeRepository.findById(id, { manager: m });
      if (!college) throw AppError.notFound('College not found');
      await collegeRepository.update(id, { isActive }, m);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.COLLEGE_STATUS,
        resource: 'college',
        resourceId: id,
        details: { isActive, name: college.name },
      });
    });
    return this.get(id);
  }

  /* Soft-deletes the college (isDelete = true, isActive = false). No other master references colleges yet. */
  async remove(id: string, req?: Request): Promise<void> {
    await AppDataSource.transaction(async (m) => {
      const college = await collegeRepository.findById(id, { manager: m });
      if (!college) throw AppError.notFound('College not found');
      await collegeRepository.softDelete(id, m);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.COLLEGE_DELETE,
        resource: 'college',
        resourceId: id,
        details: { name: college.name, code: college.code },
      });
    });
  }

  /*
   * Brings a soft-deleted college back, inactive. Refused when its district or taluka is no longer
   * usable (or the taluka has since moved to another district), or its name or code is taken meanwhile.
   */
  async restore(id: string, req?: Request): Promise<PublicCollegeDetail> {
    await AppDataSource.transaction(async (m) => {
      const existing = await collegeRepository.findByIdIncludingDeleted(id, m);
      if (!existing) throw AppError.notFound('College not found');
      if (!existing.isDelete) throw AppError.conflict('College is not deleted');
      await assertUsableRef(m, District, existing.districtId, 'districtId', 'district');
      if (existing.talukaId) await this.assertTalukaInDistrict(existing.talukaId, existing.districtId, m);
      await this.assertUnique(existing.districtId, { name: existing.name, code: existing.code }, id, m);
      await collegeRepository.restore(id, m);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.COLLEGE_RESTORE,
        resource: 'college',
        resourceId: id,
        details: { name: existing.name },
      });
    });
    return this.get(id);
  }
}

export const collegeService = new CollegeService();
