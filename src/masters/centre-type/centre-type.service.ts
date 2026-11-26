import type { Request } from 'express';
import type { EntityManager } from 'typeorm';
import { AppDataSource } from '../../config/database.config';
import { AUDIT_ACTIONS } from '../../shared/constants/app.constants';
import { auditService } from '../../modules/audit';
import { AppError } from '../../shared/errors/app-error';
import type { Paginated } from '../../shared/utils/pagination';
import type { GeoOption } from '../../cms/masters/geography/geography.types';
import { countRefs, lockForUpdate } from '../shared/master-refs';
import { TrainingCentre } from '../training-centre/training-centre.model';
import { CentreType } from './centre-type.model';
import { centreTypeRepository } from './centre-type.repository';
import type { CentreTypeListQuery, CreateCentreTypeInput, PublicCentreTypeDetail, UpdateCentreTypeInput } from './centre-type.types';
import { assertNoDependencies } from '../../shared/dependencies/dependencies';
import { CENTRE_TYPE_DEPENDENCIES } from '../masters.dependencies';

const toPublic = (t: CentreType): PublicCentreTypeDetail => ({
  id: t.id,
  name: t.name,
  code: t.code,
  description: t.description,
  isActive: t.isActive,
  createdAt: t.createdAt,
  updatedAt: t.updatedAt,
});

/*
 * Training Centre Type master — the ownership relationship of a centre (Owned, Partner, Affiliated,
 * Other are seeded by the migration).
 *
 * Every rule here is also enforced by the schema (partial unique indexes on code and lower(name), CHECK
 * constraints on shape, a RESTRICT foreign key from training_centres). The checks exist to return a
 * readable 409 instead of a bare constraint violation, never as the only protection.
 */
export class CentreTypeService {
  async list(q: CentreTypeListQuery): Promise<Paginated<PublicCentreTypeDetail>> {
    const page = await centreTypeRepository.list(q);
    return { items: page.items.map(toPublic), meta: page.meta };
  }

  async get(id: string): Promise<PublicCentreTypeDetail> {
    const centreType = await centreTypeRepository.findById(id);
    if (!centreType) throw AppError.notFound('Training centre type not found');
    const centreCount = await countRefs(AppDataSource.manager, TrainingCentre, 'centreTypeId', id);
    return { ...toPublic(centreType), centreCount };
  }

  /* Dropdown feed: active, non-deleted centre types, A to Z. */
  async options(): Promise<GeoOption[]> {
    const rows = await centreTypeRepository.findSelectable();
    return rows.map((t) => ({ id: t.id, name: t.name, code: t.code }));
  }

  private async assertUnique(input: { name?: string; code?: string }, excludeId: string | undefined, m: EntityManager): Promise<void> {
    if (input.name && (await centreTypeRepository.findByName(input.name, { excludeId, manager: m }))) {
      throw AppError.conflict('A training centre type with this name already exists');
    }
    if (input.code && (await centreTypeRepository.findByCode(input.code, { excludeId, manager: m }))) {
      throw AppError.conflict('A training centre type with this code already exists');
    }
  }

  async create(input: CreateCentreTypeInput, req?: Request): Promise<PublicCentreTypeDetail> {
    const id = await AppDataSource.transaction(async (m) => {
      await this.assertUnique(input, undefined, m);
      const centreType = await centreTypeRepository.create(
        { name: input.name, code: input.code, description: input.description ?? null, isActive: input.isActive ?? true },
        m,
      );
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.CENTRE_TYPE_CREATE,
        resource: 'centre-type',
        resourceId: centreType.id,
        details: { name: centreType.name, code: centreType.code, isActive: centreType.isActive },
      });
      return centreType.id;
    });
    return this.get(id);
  }

  async update(id: string, input: UpdateCentreTypeInput, req?: Request): Promise<PublicCentreTypeDetail> {
    await AppDataSource.transaction(async (m) => {
      const centreType = await centreTypeRepository.findById(id, { manager: m });
      if (!centreType) throw AppError.notFound('Training centre type not found');
      await this.assertUnique(input, id, m);
      await centreTypeRepository.update(id, { ...input }, m);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.CENTRE_TYPE_UPDATE,
        resource: 'centre-type',
        resourceId: id,
        details: { fields: Object.keys(input), from: { name: centreType.name, code: centreType.code } },
      });
    });
    return this.get(id);
  }

  /*
   * Deactivation is never blocked: an inactive type stops being offered in the Training Centre form,
   * and the centres already of this type keep it.
   */
  async setStatus(id: string, isActive: boolean, req?: Request): Promise<PublicCentreTypeDetail> {
    await AppDataSource.transaction(async (m) => {
      const centreType = await centreTypeRepository.findById(id, { manager: m });
      if (!centreType) throw AppError.notFound('Training centre type not found');
      await centreTypeRepository.update(id, { isActive }, m);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.CENTRE_TYPE_STATUS,
        resource: 'centre-type',
        resourceId: id,
        details: { isActive, name: centreType.name },
      });
    });
    return this.get(id);
  }

  /*
   * Soft-deletes the type (isDelete = true, isActive = false). Refused while any training centre still
   * references it: soft delete is an UPDATE, so the RESTRICT foreign key would never fire on its own.
   * The row is locked FOR UPDATE before counting, so a centre being saved with this type concurrently is
   * either counted here or refused by its own locked parent check (assertUsableRef).
   */
  async remove(id: string, req?: Request): Promise<void> {
    await AppDataSource.transaction(async (m) => {
      const centreType = await lockForUpdate(m, CentreType, id);
      if (!centreType) throw AppError.notFound('Training centre type not found');
      await assertNoDependencies(CENTRE_TYPE_DEPENDENCIES, id, m);
      await centreTypeRepository.softDelete(id, m);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.CENTRE_TYPE_DELETE,
        resource: 'centre-type',
        resourceId: id,
        details: { name: centreType.name, code: centreType.code },
      });
    });
  }

  /* Brings a soft-deleted type back, inactive. Refused when its name or code is taken meanwhile. */
  async restore(id: string, req?: Request): Promise<PublicCentreTypeDetail> {
    await AppDataSource.transaction(async (m) => {
      const existing = await centreTypeRepository.findByIdIncludingDeleted(id, m);
      if (!existing) throw AppError.notFound('Training centre type not found');
      if (!existing.isDelete) throw AppError.conflict('Training centre type is not deleted');
      await this.assertUnique({ name: existing.name, code: existing.code }, id, m);
      await centreTypeRepository.restore(id, m);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.CENTRE_TYPE_RESTORE,
        resource: 'centre-type',
        resourceId: id,
        details: { name: existing.name },
      });
    });
    return this.get(id);
  }
}

export const centreTypeService = new CentreTypeService();
