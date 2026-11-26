import type { Request } from 'express';
import type { EntityManager } from 'typeorm';
import { AppDataSource } from '../../config/database.config';
import { AUDIT_ACTIONS } from '../../shared/constants/app.constants';
import { auditService } from '../../modules/audit';
import { AppError } from '../../shared/errors/app-error';
import type { Paginated } from '../../shared/utils/pagination';
import type { GeoOption } from '../../cms/masters/geography/geography.types';
import type { Department } from './department.model';
import { departmentRepository } from './department.repository';
import type { CreateDepartmentInput, DepartmentListQuery, PublicDepartmentDetail, UpdateDepartmentInput } from './department.types';
import { assertNoDependencies } from '../../shared/dependencies/dependencies';
import { DEPARTMENT_DEPENDENCIES } from '../masters.dependencies';

const toPublic = (d: Department): PublicDepartmentDetail => ({
  id: d.id,
  name: d.name,
  code: d.code,
  description: d.description,
  isActive: d.isActive,
  createdAt: d.createdAt,
  updatedAt: d.updatedAt,
});

/*
 * Department master.
 *
 * Every rule here is also enforced by the schema (partial unique indexes on code and lower(name), CHECK
 * constraints on shape). The checks exist to return a readable 409 instead of a bare constraint
 * violation, never as the only protection.
 */
export class DepartmentService {
  async list(q: DepartmentListQuery): Promise<Paginated<PublicDepartmentDetail>> {
    const page = await departmentRepository.list(q);
    return { items: page.items.map(toPublic), meta: page.meta };
  }

  async get(id: string): Promise<PublicDepartmentDetail> {
    const department = await departmentRepository.findById(id);
    if (!department) throw AppError.notFound('Department not found');
    return toPublic(department);
  }

  /* Dropdown feed: active, non-deleted departments, A to Z. */
  async options(): Promise<GeoOption[]> {
    const rows = await departmentRepository.findSelectable();
    return rows.map((d) => ({ id: d.id, name: d.name, code: d.code }));
  }

  private async assertUnique(input: { name?: string; code?: string }, excludeId: string | undefined, m: EntityManager): Promise<void> {
    if (input.name && (await departmentRepository.findByName(input.name, { excludeId, manager: m }))) {
      throw AppError.conflict('A department with this name already exists');
    }
    if (input.code && (await departmentRepository.findByCode(input.code, { excludeId, manager: m }))) {
      throw AppError.conflict('A department with this code already exists');
    }
  }

  async create(input: CreateDepartmentInput, req?: Request): Promise<PublicDepartmentDetail> {
    const id = await AppDataSource.transaction(async (m) => {
      await this.assertUnique(input, undefined, m);
      const department = await departmentRepository.create(
        { name: input.name, code: input.code, description: input.description ?? null, isActive: input.isActive ?? true },
        m,
      );
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.DEPARTMENT_CREATE,
        resource: 'department',
        resourceId: department.id,
        details: { name: department.name, code: department.code, isActive: department.isActive },
      });
      return department.id;
    });
    return this.get(id);
  }

  async update(id: string, input: UpdateDepartmentInput, req?: Request): Promise<PublicDepartmentDetail> {
    await AppDataSource.transaction(async (m) => {
      const department = await departmentRepository.findById(id, { manager: m });
      if (!department) throw AppError.notFound('Department not found');
      await this.assertUnique(input, id, m);
      await departmentRepository.update(id, { ...input }, m);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.DEPARTMENT_UPDATE,
        resource: 'department',
        resourceId: id,
        details: { fields: Object.keys(input), from: { name: department.name, code: department.code } },
      });
    });
    return this.get(id);
  }

  /* Deactivation is never blocked: an inactive department simply stops being offered in dropdowns. */
  async setStatus(id: string, isActive: boolean, req?: Request): Promise<PublicDepartmentDetail> {
    await AppDataSource.transaction(async (m) => {
      const department = await departmentRepository.findById(id, { manager: m });
      if (!department) throw AppError.notFound('Department not found');
      await departmentRepository.update(id, { isActive }, m);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.DEPARTMENT_STATUS,
        resource: 'department',
        resourceId: id,
        details: { isActive, name: department.name },
      });
    });
    return this.get(id);
  }

  /* Soft-deletes the department (isDelete = true, isActive = false); the row is kept for audit history. */
  async remove(id: string, req?: Request): Promise<void> {
    await AppDataSource.transaction(async (m) => {
      const department = await departmentRepository.findById(id, { manager: m });
      if (!department) throw AppError.notFound('Department not found');
      await assertNoDependencies(DEPARTMENT_DEPENDENCIES, id, m);
      await departmentRepository.softDelete(id, m);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.DEPARTMENT_DELETE,
        resource: 'department',
        resourceId: id,
        details: { name: department.name, code: department.code },
      });
    });
  }

  /* Brings a soft-deleted department back, inactive. Refused when its name or code is taken meanwhile. */
  async restore(id: string, req?: Request): Promise<PublicDepartmentDetail> {
    await AppDataSource.transaction(async (m) => {
      const existing = await departmentRepository.findByIdIncludingDeleted(id, m);
      if (!existing) throw AppError.notFound('Department not found');
      if (!existing.isDelete) throw AppError.conflict('Department is not deleted');
      await this.assertUnique({ name: existing.name, code: existing.code }, id, m);
      await departmentRepository.restore(id, m);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.DEPARTMENT_RESTORE,
        resource: 'department',
        resourceId: id,
        details: { name: existing.name },
      });
    });
    return this.get(id);
  }
}

export const departmentService = new DepartmentService();
