import type { Request } from 'express';
import { Brackets, type EntityManager } from 'typeorm';
import { MESSAGES } from '../../constants/api-response.constants';
import { AppDataSource } from '../../config/database.config';
import { BaseRepository } from '../../database/base.repository';
import { AppError } from '../../shared/errors/app-error';
import { buildMeta, likePattern, toSkipTake, type ListQuery, type Paginated } from '../../shared/utils/pagination';
import { auditService } from '../audit';
import { MASTER_LIST, type MasterDefinition, type MasterKey } from './master.definitions';
import type { MasterEntity } from './master.entity';
import { buildMasterLookup, type MasterLookup, type MasterRecords, type MasterRef } from './master.lookup';
import type { MasterInput, MasterSortField } from './master.validation';

export interface MasterDto {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isMandatory?: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

type WithMandatory = MasterEntity & { isMandatory?: boolean };

/* CRUD for one master, following the users module: paging, soft delete, explicit activation, audit in the same transaction. */
export class MasterService {
  private readonly repo: BaseRepository<MasterEntity>;

  constructor(readonly def: MasterDefinition) {
    this.repo = new BaseRepository<MasterEntity>(def.entity);
  }

  private toDto(e: WithMandatory): MasterDto {
    const out: MasterDto = {
      id: e.id,
      code: e.code,
      name: e.name,
      description: e.description ?? null,
      isActive: e.isActive,
      createdAt: e.createdAt,
      updatedAt: e.updatedAt,
    };
    if (this.def.hasMandatory) out.isMandatory = !!e.isMandatory;
    return out;
  }

  async list(q: ListQuery<MasterSortField>): Promise<Paginated<MasterDto>> {
    const qb = this.repo.query('m');
    if (q.search) {
      const term = likePattern(q.search);
      qb.andWhere(new Brackets((w) => w.where('m.code ILIKE :term', { term }).orWhere('m.name ILIKE :term', { term })));
    }
    if (q.isActive !== undefined) qb.andWhere('m.isActive = :isActive', { isActive: q.isActive });
    const { skip, take } = toSkipTake(q);
    const [items, total] = await qb.orderBy(`m.${q.sortBy}`, q.sortOrder).addOrderBy('m.id').skip(skip).take(take).getManyAndCount();
    return { items: items.map((e) => this.toDto(e)), meta: buildMeta(q, total) };
  }

  /* Dropdown values: active and not deleted only, by name. */
  async options(): Promise<MasterRef[]> {
    const rows: WithMandatory[] = await this.repo.findMany({ isActive: true }, { order: { name: 'ASC' } });
    return rows.map((e) => {
      const ref: MasterRef = { id: e.id, code: e.code, name: e.name };
      if (this.def.hasMandatory) ref.isMandatory = !!e.isMandatory;
      return ref;
    });
  }

  async get(id: string): Promise<MasterDto> {
    const e = await this.repo.findById(id);
    if (!e) throw AppError.notFound(MESSAGES.notFound(this.def.label));
    return this.toDto(e);
  }

  /* Code and name stay reserved by soft-deleted records too, so this check includes deleted rows. */
  private async assertUnique(m: EntityManager, input: MasterInput, exceptId?: string) {
    for (const field of ['code', 'name'] as const) {
      const value = input[field];
      if (value === undefined) continue;
      const qb = m
        .getRepository(this.def.entity)
        .createQueryBuilder('m')
        .where(`lower(m.${field}) = lower(:value)`, { value });
      if (exceptId) qb.andWhere('m.id <> :exceptId', { exceptId });
      const other = await qb.getOne();
      if (other) {
        const suffix = other.isDelete ? ' (reserved by a deleted record)' : '';
        throw AppError.conflict(MESSAGES.alreadyExists(this.def.label, field) + suffix);
      }
    }
  }

  private async isReferenced(m: EntityManager, id: string): Promise<boolean> {
    return (await m.query(this.def.referencedSql, [id])).length > 0;
  }

  async create(input: MasterInput, req?: Request): Promise<MasterDto> {
    const id = await AppDataSource.transaction(async (m) => {
      await this.assertUnique(m, input);
      const data: Partial<WithMandatory> = {
        code: input.code,
        name: input.name,
        description: input.description ?? null,
        isActive: input.isActive ?? true,
      };
      if (this.def.hasMandatory) data.isMandatory = input.isMandatory ?? false;
      const e = await this.repo.create(data, m);
      await auditService.recordInTx(m, req, {
        action: `${this.def.audit}.create`,
        resource: this.def.table,
        resourceId: e.id,
        details: { code: e.code, name: e.name },
      });
      return e.id;
    });
    return this.get(id);
  }

  /* Editing never changes isActive (an inactive record stays inactive). A record in use keeps its code. */
  async update(id: string, input: MasterInput, req?: Request): Promise<MasterDto> {
    await AppDataSource.transaction(async (m) => {
      const e = await this.repo.findById(id, { manager: m });
      if (!e) throw AppError.notFound(MESSAGES.notFound(this.def.label));
      const patch: MasterInput = { ...input };
      delete patch.isActive;
      if (!this.def.hasMandatory) delete patch.isMandatory;
      if (patch.code === e.code) delete patch.code;
      if (patch.code !== undefined && (await this.isReferenced(m, id)))
        throw AppError.conflict(`${this.def.label} is in use; its code cannot be changed`);
      await this.assertUnique(m, patch, id);
      if (Object.keys(patch).length) await this.repo.update(id, patch, m);
      await auditService.recordInTx(m, req, {
        action: `${this.def.audit}.update`,
        resource: this.def.table,
        resourceId: id,
        details: { fields: Object.keys(patch) },
      });
    });
    return this.get(id);
  }

  async setStatus(id: string, isActive: boolean, req?: Request): Promise<MasterDto> {
    await AppDataSource.transaction(async (m) => {
      if (!(await this.repo.findById(id, { manager: m }))) throw AppError.notFound(MESSAGES.notFound(this.def.label));
      await this.repo.update(id, { isActive }, m);
      await auditService.recordInTx(m, req, {
        action: `${this.def.audit}.status`,
        resource: this.def.table,
        resourceId: id,
        details: { isActive },
      });
    });
    return this.get(id);
  }

  /* Soft delete only; a record still referenced by a student or a stored document cannot be deleted. */
  async remove(id: string, req?: Request): Promise<void> {
    await AppDataSource.transaction(async (m) => {
      if (!(await this.repo.findById(id, { manager: m }))) throw AppError.notFound(MESSAGES.notFound(this.def.label));
      if (await this.isReferenced(m, id)) throw AppError.conflict(`${this.def.label} is in use and cannot be deleted`);
      await this.repo.softDelete(id, m);
      await auditService.recordInTx(m, req, { action: `${this.def.audit}.delete`, resource: this.def.table, resourceId: id });
    });
  }
}

export const masterServices = Object.fromEntries(MASTER_LIST.map((d) => [d.key, new MasterService(d)])) as Record<
  MasterKey,
  MasterService
>;

export const mastersService = {
  /* Active masters for the import and the registration API: loaded once per batch / request, then matched in memory. */
  async loadLookup(): Promise<MasterLookup> {
    const entries = await Promise.all(MASTER_LIST.map(async (d) => [d.key, await masterServices[d.key].options()] as const));
    return buildMasterLookup(Object.fromEntries(entries) as MasterRecords);
  },
};
