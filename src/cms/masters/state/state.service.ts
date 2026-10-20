import type { Request } from 'express';
import type { EntityManager } from 'typeorm';
import { AppDataSource } from '../../../config/database.config';
import { AUDIT_ACTIONS } from '../../../shared/constants/app.constants';
import { auditService } from '../../../modules/audit/audit.service';
import { AppError } from '../../../shared/errors/app-error';
import type { Paginated } from '../../../shared/utils/pagination';
import type { State } from './state.model';
import { stateRepository } from './state.repository';
import type { CreateStateInput, PublicStateDetail, StateListQuery, UpdateStateInput } from './state.types';

const toPublic = (s: State): PublicStateDetail => ({
  id: s.id,
  name: s.name,
  code: s.code,
  isActive: s.isActive,
  createdAt: s.createdAt,
  updatedAt: s.updatedAt,
});

/*
 * The state a district may be attached to: it must exist, not be deleted, and be active.
 *
 * This runs on the server for every district write, independently of what the dropdown offered: a
 * client can post any stateId it likes, so the dropdown is a convenience, never the integrity check.
 */
export async function assertUsableState(stateId: string, manager?: EntityManager): Promise<State> {
  const state = await stateRepository.findById(stateId, { manager });
  if (!state) throw AppError.badRequest('The selected state does not exist', [{ field: 'stateId', message: 'Unknown state' }]);
  if (!state.isActive) {
    throw AppError.badRequest('The selected state is inactive', [{ field: 'stateId', message: 'Choose an active state' }]);
  }
  return state;
}

/*
 * State master (CMS geography, top of State -> District -> Taluka).
 *
 * Every rule enforced here is also enforced by the schema (partial unique indexes on code and
 * lower(name), CHECK constraints on shape, RESTRICT foreign keys). The checks in this service exist to
 * return a readable 409 / 400 instead of a bare constraint violation, never as the only protection.
 */
export class StateService {
  async list(q: StateListQuery): Promise<Paginated<PublicStateDetail>> {
    const page = await stateRepository.list(q);
    return { items: page.items.map(toPublic), meta: page.meta };
  }

  async get(id: string): Promise<PublicStateDetail> {
    const state = await stateRepository.findById(id);
    if (!state) throw AppError.notFound('State not found');
    return { ...toPublic(state), districtCount: await stateRepository.countDistricts(id) };
  }

  async create(input: CreateStateInput, req?: Request): Promise<PublicStateDetail> {
    const id = await AppDataSource.transaction(async (m) => {
      if (await stateRepository.findByName(input.name, { manager: m })) throw AppError.conflict('A state with this name already exists');
      if (await stateRepository.findByCode(input.code, m)) throw AppError.conflict('A state with this code already exists');
      const state = await stateRepository.create({ name: input.name, code: input.code, isActive: input.isActive ?? true }, m);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.STATE_CREATE,
        resource: 'state',
        resourceId: state.id,
        details: { name: state.name, code: state.code, isActive: state.isActive },
      });
      return state.id;
    });
    return this.get(id);
  }

  async update(id: string, input: UpdateStateInput, req?: Request): Promise<PublicStateDetail> {
    await AppDataSource.transaction(async (m) => {
      const state = await stateRepository.findById(id, { manager: m });
      if (!state) throw AppError.notFound('State not found');
      if (input.name && (await stateRepository.findByName(input.name, { excludeId: id, manager: m }))) {
        throw AppError.conflict('Another state already uses this name');
      }
      if (input.code && input.code !== state.code && (await stateRepository.findByCode(input.code, m))) {
        throw AppError.conflict('Another state already uses this code');
      }
      await stateRepository.update(id, { ...input }, m);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.STATE_UPDATE,
        resource: 'state',
        resourceId: id,
        details: { fields: Object.keys(input), from: { name: state.name, code: state.code } },
      });
    });
    return this.get(id);
  }

  /*
   * Deactivation is the safe alternative to deletion and is never blocked: an inactive state simply
   * stops being offered, so no new district can be attached to it and the public site no longer lists
   * it. Its existing districts keep their own status and stay readable in the admin panel.
   */
  async setStatus(id: string, isActive: boolean, req?: Request): Promise<PublicStateDetail> {
    await AppDataSource.transaction(async (m) => {
      const state = await stateRepository.findById(id, { manager: m });
      if (!state) throw AppError.notFound('State not found');
      const districts = await stateRepository.countDistricts(id, { manager: m });
      await stateRepository.update(id, { isActive }, m);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.STATE_STATUS,
        resource: 'state',
        resourceId: id,
        details: { isActive, name: state.name, districts },
      });
    });
    return this.get(id);
  }

  /* Soft-deletes the state. Refused while any district still references it (deactivate instead). */
  async remove(id: string, req?: Request): Promise<void> {
    await AppDataSource.transaction(async (m) => {
      const state = await stateRepository.findById(id, { manager: m });
      if (!state) throw AppError.notFound('State not found');
      const districts = await stateRepository.countDistricts(id, { manager: m });
      if (districts > 0) {
        const plural = districts === 1 ? 'district' : 'districts';
        throw AppError.conflict(
          `This state cannot be deleted while ${districts} ${plural} reference it. Deactivate it instead, or move or delete the districts first.`,
        );
      }
      await stateRepository.softDelete(id, m);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.STATE_DELETE,
        resource: 'state',
        resourceId: id,
        details: { name: state.name, code: state.code },
      });
    });
  }

  /* Brings a soft-deleted state back, inactive. Refused when its name or code is taken meanwhile. */
  async restore(id: string, req?: Request): Promise<PublicStateDetail> {
    await AppDataSource.transaction(async (m) => {
      const existing = await stateRepository.findByIdIncludingDeleted(id, m);
      if (!existing) throw AppError.notFound('State not found');
      if (!existing.isDelete) throw AppError.conflict('State is not deleted');
      if (await stateRepository.findByName(existing.name, { manager: m }))
        throw AppError.conflict('Another active state already uses this name');
      if (await stateRepository.findByCode(existing.code, m)) throw AppError.conflict('Another active state already uses this code');
      await stateRepository.restore(id, m);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.STATE_RESTORE,
        resource: 'state',
        resourceId: id,
        details: { name: existing.name },
      });
    });
    return this.get(id);
  }
}

export const stateService = new StateService();
