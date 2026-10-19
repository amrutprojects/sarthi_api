import { Brackets, In, type EntityManager } from 'typeorm';
import { Role } from './role.entity';
import { RolePermission } from '../role-permission.entity';
import { UserRole } from '../user-role.entity';
import { BaseRepository } from '../../../database/base.repository';
import { buildMeta, likePattern, toSkipTake, type ListQuery, type Paginated } from '../../../shared/utils/pagination';

export type RoleSortField = 'createdAt' | 'name' | 'code';

export class RoleRepository extends BaseRepository<Role> {
  constructor() {
    super(Role);
  }

  findByCode(code: string, manager?: EntityManager): Promise<Role | null> {
    return this.findOne({ code }, manager);
  }

  /* Roles that can be assigned / grant access: not deleted and active. */
  findUsableByIds(ids: string[], manager?: EntityManager): Promise<Role[]> {
    if (!ids.length) return Promise.resolve([]);
    return this.findMany({ id: In(ids), isActive: true }, { manager });
  }

  async list(q: ListQuery<RoleSortField>): Promise<Paginated<Role>> {
    const qb = this.query('r');
    if (q.search) {
      const term = likePattern(q.search);
      qb.andWhere(new Brackets((w) => w.where('r.name ILIKE :term', { term }).orWhere('r.code ILIKE :term', { term })));
    }
    if (q.isActive !== undefined) qb.andWhere('r.isActive = :isActive', { isActive: q.isActive });
    const { skip, take } = toSkipTake(q);
    const [items, total] = await qb.orderBy(`r.${q.sortBy}`, q.sortOrder).addOrderBy('r.id').skip(skip).take(take).getManyAndCount();
    return { items, meta: buildMeta(q, total) };
  }

  /* Active role assignments of a user (assignment rows not deleted). */
  async findUserAssignments(userId: string, manager?: EntityManager): Promise<UserRole[]> {
    return (manager ?? this.repo().manager).getRepository(UserRole).find({
      where: { userId, isDelete: false },
      relations: { role: true },
      order: { createdAt: 'ASC' },
    });
  }

  async findRolePermissionGrants(roleId: string, manager?: EntityManager): Promise<RolePermission[]> {
    return (manager ?? this.repo().manager).getRepository(RolePermission).find({
      where: { roleId, isDelete: false },
      relations: { permission: true },
      order: { createdAt: 'ASC' },
    });
  }

  countActiveHolders(roleId: string, manager?: EntityManager): Promise<number> {
    return (manager ?? this.repo().manager).getRepository(UserRole).count({ where: { roleId, isDelete: false } });
  }
}

export const roleRepository = new RoleRepository();
