import type { EntityManager, EntityTarget, FindOptionsWhere } from 'typeorm';
import type { AppBaseEntity } from '../../database/base.entity';
import { AppError } from '../../shared/errors/app-error';

/*
 * Server-side checks every CMS master runs on its references, whatever a dropdown offered.
 *
 * A client can post any id it likes, so the dropdowns (which only list active rows) are a convenience;
 * these checks are the integrity rule. The answer is a 400 carrying the field name, so the admin panel
 * shows the message next to the right control.
 */

/*
 * Row locks that make a parent check and a parent delete exclusive.
 *
 * Soft delete is an UPDATE of non-key columns, so the foreign key's own FOR KEY SHARE lock never
 * conflicts with it: under READ COMMITTED a child insert and a parent delete would both see the other's
 * work as uncommitted, both pass their checks, and leave a live child under a deleted parent. So:
 * - every parent check (assertUsableRef) reads the parent locked, FOR SHARE by default;
 * - every remove() that guards children locks the parent FOR UPDATE (lockForUpdate) BEFORE counting.
 * Whichever transaction locks first wins: a waiting check re-reads the committed row (a deleted one no
 * longer matches isDelete = false and answers 400), and a waiting delete counts the committed child (409).
 * Both need a transaction manager; every caller runs inside AppDataSource.transaction.
 */
export type RefLock = 'pessimistic_read' | 'pessimistic_write';

/*
 * The referenced row must exist, not be soft-deleted, and be active. Returns it, locked until the
 * transaction ends. `lock` is FOR SHARE by default; a caller that goes on to lock the same row FOR UPDATE
 * (batch code generation) passes 'pessimistic_write' instead, because upgrading a shared lock that a
 * concurrent writer also holds deadlocks.
 */
export async function assertUsableRef<T extends AppBaseEntity>(
  m: EntityManager,
  target: EntityTarget<T>,
  id: string,
  field: string,
  label: string,
  lock: RefLock = 'pessimistic_read',
): Promise<T> {
  const row = await m.getRepository(target).findOne({ where: { id, isDelete: false } as FindOptionsWhere<T>, lock: { mode: lock } });
  if (!row) throw AppError.badRequest(`The selected ${label} does not exist`, [{ field, message: `Unknown ${label}` }]);
  if (!row.isActive) throw AppError.badRequest(`The selected ${label} is inactive`, [{ field, message: `Choose an active ${label}` }]);
  return row;
}

/*
 * The non-deleted row, locked FOR UPDATE until the transaction ends; null when it is absent or deleted.
 * A parent's remove() reads itself through this before counting the records that block the delete.
 */
export function lockForUpdate<T extends AppBaseEntity>(m: EntityManager, target: EntityTarget<T>, id: string): Promise<T | null> {
  return m.getRepository(target).findOne({ where: { id, isDelete: false } as FindOptionsWhere<T>, lock: { mode: 'pessimistic_write' } });
}

/*
 * Non-deleted rows of `target` that point at a record, by column. Used to refuse deleting a parent that
 * is still referenced: soft delete is an UPDATE, so the RESTRICT foreign keys never fire on their own.
 */
export function countRefs<T extends AppBaseEntity>(
  m: EntityManager,
  target: EntityTarget<T>,
  column: keyof T & string,
  id: string,
  opts: { activeOnly?: boolean } = {},
): Promise<number> {
  const where = { [column]: id, isDelete: false, ...(opts.activeOnly ? { isActive: true } : {}) } as FindOptionsWhere<T>;
  return m.getRepository(target).count({ where });
}

/* "3 districts", "1 district". */
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/*
 * Builds the 409 for a parent that is still referenced, listing what holds it:
 * "This training centre cannot be deleted while 2 batches and 1 document reference it. Deactivate it instead."
 */
export function assertNoRefs(entityLabel: string, refs: { count: number; one: string; many?: string }[]): void {
  const present = refs.filter((r) => r.count > 0);
  if (!present.length) return;
  const held = present.map((r) => plural(r.count, r.one, r.many));
  const list = held.length === 1 ? held[0] : `${held.slice(0, -1).join(', ')} and ${held[held.length - 1]}`;
  const verb = present.length === 1 && present[0].count === 1 ? 'references' : 'reference';
  throw AppError.conflict(`This ${entityLabel} cannot be deleted while ${list} ${verb} it. Deactivate it instead, or remove those records first.`);
}
