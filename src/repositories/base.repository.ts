import type {
  DeepPartial, EntityManager, EntityTarget, FindOptionsOrder, FindOptionsRelations, FindOptionsWhere, ObjectLiteral,
  Repository, SelectQueryBuilder,
} from 'typeorm';
import { AppDataSource } from '../config/database.config';
import type { AppBaseEntity } from '../entities/base.entity';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';

/*
 * Soft-delete-aware repository shared by every AppBaseEntity.
 *
 * Global soft-delete policy:
 * - Every read (find / count / exists / query builder) excludes rows where isDelete = true.
 * - update() and updateWhere() only ever touch non-deleted rows, so bulk updates cannot
 *   resurrect or modify deleted records by accident.
 * - softDelete() sets { isDelete: true, isActive: false }. Nothing in this class issues a SQL DELETE.
 * - Deleted rows are only reachable through the explicit *IncludingDeleted / restore() methods.
 * - For hand-written SQL use notDeletedSql(alias) to apply the same filter.
 *
 * Pass an EntityManager (from a transaction) to run any method inside that transaction.
 */
/* Typed update payload for the common columns (TypeORM cannot infer them through the generic T). */
const patch = <T>(v: Partial<AppBaseEntity>) => v as unknown as QueryDeepPartialEntity<T>;

export class BaseRepository<T extends AppBaseEntity> {
  constructor(private readonly target: EntityTarget<T>) {}

  protected repo(manager?: EntityManager): Repository<T> {
    return (manager ?? AppDataSource.manager).getRepository(this.target);
  }

  /* Adds isDelete = false to a where clause (object or array form). */
  protected scope(where?: FindOptionsWhere<T> | FindOptionsWhere<T>[]): FindOptionsWhere<T> | FindOptionsWhere<T>[] {
    const notDeleted = { isDelete: false } as FindOptionsWhere<T>;
    if (!where) return notDeleted;
    return Array.isArray(where) ? where.map((w) => ({ ...w, ...notDeleted })) : { ...where, ...notDeleted };
  }

  findById(id: string, opts: { relations?: FindOptionsRelations<T>; manager?: EntityManager } = {}): Promise<T | null> {
    return this.repo(opts.manager).findOne({ where: this.scope({ id } as FindOptionsWhere<T>), relations: opts.relations });
  }

  findOne(where: FindOptionsWhere<T> | FindOptionsWhere<T>[], manager?: EntityManager): Promise<T | null> {
    return this.repo(manager).findOne({ where: this.scope(where) });
  }

  findMany(
    where: FindOptionsWhere<T> | FindOptionsWhere<T>[] = {},
    opts: { order?: FindOptionsOrder<T>; relations?: FindOptionsRelations<T>; manager?: EntityManager } = {},
  ): Promise<T[]> {
    return this.repo(opts.manager).find({ where: this.scope(where), order: opts.order, relations: opts.relations });
  }

  count(where: FindOptionsWhere<T> | FindOptionsWhere<T>[] = {}, manager?: EntityManager): Promise<number> {
    return this.repo(manager).count({ where: this.scope(where) });
  }

  exists(where: FindOptionsWhere<T> | FindOptionsWhere<T>[], manager?: EntityManager): Promise<boolean> {
    return this.repo(manager).exists({ where: this.scope(where) });
  }

  /* Query builder pre-filtered to non-deleted rows of the main alias. */
  query(alias: string, manager?: EntityManager): SelectQueryBuilder<T> {
    return this.repo(manager).createQueryBuilder(alias).where(`${alias}.isDelete = false`);
  }

  create(data: DeepPartial<T>, manager?: EntityManager): Promise<T> {
    const repo = this.repo(manager);
    return repo.save(repo.create(data));
  }

  /* Updates one non-deleted row; returns the reloaded entity or null when it does not exist / is deleted. */
  async update(id: string, data: QueryDeepPartialEntity<T>, manager?: EntityManager): Promise<T | null> {
    const result = await this.repo(manager).update(this.scope({ id } as FindOptionsWhere<T>) as FindOptionsWhere<T>, data);
    if (!result.affected) return null;
    return this.findById(id, { manager });
  }

  /* Bulk update restricted to non-deleted rows. Returns the number of rows changed. */
  async updateWhere(where: FindOptionsWhere<T>, data: QueryDeepPartialEntity<T>, manager?: EntityManager): Promise<number> {
    const result = await this.repo(manager).update(this.scope(where) as FindOptionsWhere<T>, data);
    return result.affected ?? 0;
  }

  /* Ordinary deletion: { isDelete: true, isActive: false }. Returns false if the row was absent or already deleted. */
  async softDelete(id: string, manager?: EntityManager): Promise<boolean> {
    const n = await this.updateWhere({ id } as FindOptionsWhere<T>, patch<T>({ isDelete: true, isActive: false }), manager);
    return n > 0;
  }

  async softDeleteWhere(where: FindOptionsWhere<T>, manager?: EntityManager): Promise<number> {
    return this.updateWhere(where, patch<T>({ isDelete: true, isActive: false }), manager);
  }

  /* ---- explicit access to deleted rows (restore flows only) ---- */

  findByIdIncludingDeleted(id: string, manager?: EntityManager): Promise<T | null> {
    return this.repo(manager).findOne({ where: { id } as FindOptionsWhere<T> });
  }

  /* Restores a soft-deleted row. It comes back inactive; activation is a separate, explicit step. */
  async restore(id: string, manager?: EntityManager): Promise<T | null> {
    const result = await this.repo(manager).update({ id, isDelete: true } as FindOptionsWhere<T>, patch<T>({ isDelete: false }));
    if (!result.affected) return null;
    return this.findById(id, { manager });
  }
}

/* SQL fragment for hand-written queries: `WHERE ${notDeletedSql('u')}`. */
export const notDeletedSql = (alias: string) => `"${alias}"."isDelete" = false`;

/* SQL fragment for rows that may grant access: not deleted AND active. */
export const usableSql = (alias: string) => `"${alias}"."isDelete" = false AND "${alias}"."isActive" = true`;

export type { ObjectLiteral };
