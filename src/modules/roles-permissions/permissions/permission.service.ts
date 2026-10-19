import type { Request } from 'express';
import { MESSAGES } from '../../../constants/api-response.constants';
import { AppDataSource } from '../../../config/database.config';
import { AUDIT_ACTIONS } from '../../../shared/constants/app.constants';
import type { Permission } from './permission.entity';
import { permissionRepository, type PermissionSortField } from './permission.repository';
import { AppError } from '../../../shared/errors/app-error';
import type { ListQuery, Paginated } from '../../../shared/utils/pagination';
import { auditService } from '../../audit';
import { rbacService } from '../rbac.service';

export interface PublicPermission {
  id: string;
  name: string;
  code: string;
  module: string;
  description: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const toPublic = (p: Permission): PublicPermission => ({
  id: p.id,
  name: p.name,
  code: p.code,
  module: p.module,
  description: p.description,
  isActive: p.isActive,
  createdAt: p.createdAt,
  updatedAt: p.updatedAt,
});

export interface CreatePermissionInput {
  name: string;
  code: string;
  module?: string;
  description?: string | null;
  isActive?: boolean;
}
export interface UpdatePermissionInput {
  name?: string;
  module?: string;
  description?: string | null;
}

export class PermissionService {
  async list(q: ListQuery<PermissionSortField> & { module?: string }): Promise<Paginated<PublicPermission>> {
    const page = await permissionRepository.list(q);
    return { items: page.items.map(toPublic), meta: page.meta };
  }

  modules(): Promise<string[]> {
    return permissionRepository.findModules();
  }

  async get(id: string): Promise<PublicPermission> {
    const p = await permissionRepository.findById(id);
    if (!p) throw AppError.notFound(MESSAGES.notFound('Permission'));
    return toPublic(p);
  }

  async create(input: CreatePermissionInput, req?: Request): Promise<PublicPermission> {
    const id = await AppDataSource.transaction(async (m) => {
      if (await permissionRepository.findByCode(input.code, m)) throw AppError.conflict('A permission with this code already exists');
      const p = await permissionRepository.create(
        {
          name: input.name,
          code: input.code,
          module: input.module ?? input.code.split('.')[0],
          description: input.description ?? null,
          isActive: input.isActive ?? true,
        },
        m,
      );
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.PERMISSION_CREATE,
        resource: 'permission',
        resourceId: p.id,
        details: { code: p.code },
      });
      return p.id;
    });
    return this.get(id);
  }

  async update(id: string, input: UpdatePermissionInput, req?: Request): Promise<PublicPermission> {
    await AppDataSource.transaction(async (m) => {
      if (!(await permissionRepository.findById(id, { manager: m }))) throw AppError.notFound(MESSAGES.notFound('Permission'));
      await permissionRepository.update(id, { ...input }, m);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.PERMISSION_UPDATE,
        resource: 'permission',
        resourceId: id,
        details: { fields: Object.keys(input) },
      });
    });
    return this.get(id);
  }

  async setStatus(id: string, isActive: boolean, req?: Request): Promise<PublicPermission> {
    await AppDataSource.transaction(async (m) => {
      if (!(await permissionRepository.findById(id, { manager: m }))) throw AppError.notFound(MESSAGES.notFound('Permission'));
      await permissionRepository.update(id, { isActive }, m);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.PERMISSION_STATUS,
        resource: 'permission',
        resourceId: id,
        details: { isActive },
      });
    });
    rbacService.invalidate();
    return this.get(id);
  }

  async remove(id: string, req?: Request): Promise<void> {
    await AppDataSource.transaction(async (m) => {
      const p = await permissionRepository.findById(id, { manager: m });
      if (!p) throw AppError.notFound(MESSAGES.notFound('Permission'));
      await permissionRepository.softDelete(id, m);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.PERMISSION_DELETE,
        resource: 'permission',
        resourceId: id,
        details: { code: p.code },
      });
    });
    rbacService.invalidate();
  }

  async restore(id: string, req?: Request): Promise<PublicPermission> {
    await AppDataSource.transaction(async (m) => {
      const existing = await permissionRepository.findByIdIncludingDeleted(id, m);
      if (!existing) throw AppError.notFound(MESSAGES.notFound('Permission'));
      if (!existing.isDelete) throw AppError.conflict('Permission is not deleted');
      if (await permissionRepository.findByCode(existing.code, m))
        throw AppError.conflict('Another active permission already uses this code');
      await permissionRepository.restore(id, m);
      await auditService.recordInTx(m, req, { action: AUDIT_ACTIONS.PERMISSION_RESTORE, resource: 'permission', resourceId: id });
    });
    rbacService.invalidate();
    return this.get(id);
  }
}

export const permissionService = new PermissionService();
