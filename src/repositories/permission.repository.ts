import { Brackets, In, type EntityManager } from 'typeorm';
import { Permission } from '../entities/permission.entity';
import { BaseRepository, usableSql } from './base.repository';
import { buildMeta, likePattern, toSkipTake, type ListQuery, type Paginated } from '../utils/pagination';

export type PermissionSortField = 'module' | 'code' | 'name' | 'createdAt';

export class PermissionRepository extends BaseRepository<Permission> {
  constructor() {
    super(Permission);
  }

  findByCode(code: string, manager?: EntityManager): Promise<Permission | null> {
    return this.findOne({ code }, manager);
  }

  findUsableByIds(ids: string[], manager?: EntityManager): Promise<Permission[]> {
    if (!ids.length) return Promise.resolve([]);
    return this.findMany({ id: In(ids), isActive: true }, { manager });
  }

  async list(q: ListQuery<PermissionSortField> & { module?: string }): Promise<Paginated<Permission>> {
    const qb = this.query('p');
    if (q.search) {
      const term = likePattern(q.search);
      qb.andWhere(new Brackets((w) => w.where('p.name ILIKE :term', { term }).orWhere('p.code ILIKE :term', { term })));
    }
    if (q.module) qb.andWhere('p.module = :module', { module: q.module });
    if (q.isActive !== undefined) qb.andWhere('p.isActive = :isActive', { isActive: q.isActive });
    const { skip, take } = toSkipTake(q);
    const [items, total] = await qb.orderBy(`p.${q.sortBy}`, q.sortOrder).addOrderBy('p.code').skip(skip).take(take).getManyAndCount();
    return { items, meta: buildMeta(q, total) };
  }

  /*
   * Effective permission codes of a user. Only counts rows that are usable at every hop:
   * user active & not deleted → assignment not deleted → role active & not deleted →
   * grant not deleted → permission active & not deleted.
   */
  async findEffectiveCodesForUser(userId: string, manager?: EntityManager): Promise<string[]> {
    const rows: { code: string }[] = await (manager ?? this.repo().manager).query(
      `SELECT DISTINCT p."code"
         FROM "users" u
         JOIN "user_roles" ur       ON ur."userId" = u."id"       AND ur."isDelete" = false
         JOIN "roles" r             ON r."id" = ur."roleId"        AND ${usableSql('r')}
         JOIN "role_permissions" rp ON rp."roleId" = r."id"        AND rp."isDelete" = false
         JOIN "permissions" p       ON p."id" = rp."permissionId"  AND ${usableSql('p')}
        WHERE u."id" = $1 AND ${usableSql('u')}`,
      [userId],
    );
    return rows.map((r) => r.code);
  }

  async findModules(): Promise<string[]> {
    const rows: { module: string }[] = await this.query('p').select('DISTINCT p.module', 'module').orderBy('module').getRawMany();
    return rows.map((r) => r.module);
  }
}

export const permissionRepository = new PermissionRepository();
