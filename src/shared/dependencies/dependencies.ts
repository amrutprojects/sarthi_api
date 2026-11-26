import type { EntityManager } from 'typeorm';
import { AppDataSource } from '../../config/database.config';
import { ERROR_CODES, HTTP_STATUS } from '../../constants/api-response.constants';
import { AppError } from '../errors/app-error';

/*
 * Delete-dependency rule, the same for every record of the application: a record may not be deleted (soft delete
 * included) while other records still use it — approvals and decisions made by a user, assignments, mappings, and any
 * record that points at it, also historical ones. Nothing is ever deleted along with it (no cascade).
 *
 * What does NOT count: who created or changed a row (created/updated/uploaded-by stamps), audit-log rows and sessions,
 * and a record's own parts that exist only as part of it (a user's role assignments, a role's grants, a calendar's
 * holidays, a track variant's curriculum…). Those stay with the record, as soft delete always kept them.
 *
 * Each kind of record is described ONCE, next to the code that deletes it (`defineDependencies` in a `*.dependencies.ts`
 * file of its feature). Every delete calls `assertNoDependencies` inside its transaction, before its soft delete, so a
 * direct API call cannot get round it; GET /api/v1/dependencies/:kind/:id answers the same question for the admin
 * panel's delete dialog before the user confirms.
 */

export interface DependencyRule {
  /* What uses the record, plural, as the message says it: "candidate application approvals". */
  label: string;
  /* How many live records use it (the record's id is `id`). */
  count: (m: EntityManager, id: string) => Promise<number>;
}

export interface DependencyKind {
  /* Its name in the API: GET /dependencies/<kind>/:id. */
  kind: string;
  /* What the message calls it: "Unable to delete this <noun> …". */
  noun: string;
  /* A person ("they are associated …") rather than a thing ("it is associated …"). */
  person?: boolean;
  /* Its table: the row is locked FOR UPDATE while it is checked, so nothing can start using it before it is deleted. */
  table: string;
  /* Who may ask what uses it: the permission(s) that delete it (any of them). */
  permission: string | string[];
  /* What to do instead, added to the message: "Deactivate it instead." */
  hint?: string;
  /* Its rules; a function when they come from a list that may still grow (fromReferences), read at every check. */
  rules: DependencyRule[] | (() => DependencyRule[]);
}

export interface Dependency {
  label: string;
  count: number;
}

const KINDS = new Map<string, DependencyKind>();

/* Registers a kind of record (once per kind; a second definition of the same kind is a programming error). */
export function defineDependencies(def: DependencyKind): DependencyKind {
  const known = KINDS.get(def.kind);
  if (known && known !== def) throw new Error(`Dependencies of "${def.kind}" are defined twice`);
  KINDS.set(def.kind, def);
  return def;
}

export const dependencyKind = (kind: string): DependencyKind | undefined => KINDS.get(kind);
export const rulesOf = (def: DependencyKind): DependencyRule[] => (typeof def.rules === 'function' ? def.rules() : def.rules);
export const dependencyKinds = (): DependencyKind[] => [...KINDS.values()];

/* Quotes an identifier written in this code (never user input): "isDelete", "byUserId". */
const q = (name: string) => `"${name.replace(/"/g, '""')}"`;

/*
 * Rows of `table` whose `column` holds the record's id. `live` (the default) skips soft-deleted rows; pass false for a
 * table that has no isDelete column (append-only history such as ipp_approval_events). `where` narrows it further.
 */
export function rowsWhere(
  label: string,
  table: string,
  column: string,
  opts: { live?: boolean; where?: string } = {},
): DependencyRule {
  const conditions = [`${q(column)} = $1`];
  if (opts.live !== false) conditions.push(`${q('isDelete')} = false`);
  if (opts.where) conditions.push(`(${opts.where})`);
  const sql = `SELECT count(*)::int AS n FROM ${q(table)} WHERE ${conditions.join(' AND ')}`;
  return { label, count: async (m, id) => Number((await m.query(sql, [id]))[0]?.n ?? 0) };
}

/* Rows of `table` whose JSON column `json` holds the record's id under `key` (no foreign key there). */
export function rowsWithJson(
  label: string,
  table: string,
  json: string,
  key: string,
  opts: { live?: boolean; where?: string } = {},
): DependencyRule {
  const conditions = [`${q(json)} ->> '${key.replace(/'/g, "''")}' = $1::text`];
  if (opts.live !== false) conditions.push(`${q('isDelete')} = false`);
  if (opts.where) conditions.push(`(${opts.where})`);
  const sql = `SELECT count(*)::int AS n FROM ${q(table)} WHERE ${conditions.join(' AND ')}`;
  return { label, count: async (m, id) => Number((await m.query(sql, [id]))[0]?.n ?? 0) };
}

/* A rule written as SQL that returns one row with the count as `n` ($1 = the record's id), for anything the two above cannot say. */
export function countedBy(label: string, sql: string): DependencyRule {
  return { label, count: async (m, id) => Number((await m.query(sql, [id]))[0]?.n ?? 0) };
}

/*
 * Rules from a reference list kept in the { one, many?, count } shape of masters/shared/master-refs.ts (the LMS guard
 * lists), so the "Usage" cards that read those lists and the delete check cannot drift apart. Pass it as
 * `rules: () => fromReferences(LIST)` so an entry appended to the list later is counted too.
 */
export function fromReferences(refs: { one: string; many?: string; count: DependencyRule['count'] }[]): DependencyRule[] {
  return refs.map((r) => ({ label: r.many ?? `${r.one}s`, count: r.count }));
}

/* What still uses the record, in the order of its rules; empty when it may be deleted. */
export async function findDependencies(def: DependencyKind, id: string, manager?: EntityManager): Promise<Dependency[]> {
  const m = manager ?? AppDataSource.manager;
  const found: Dependency[] = [];
  for (const rule of rulesOf(def)) {
    const count = await rule.count(m, id);
    if (count > 0) found.push({ label: rule.label, count });
  }
  return found;
}

/* "candidate application approvals (3)", joined: "a (1), b (2) and c (4)". */
const listOf = (deps: Dependency[]) => {
  const items = deps.map((d) => `${d.label} (${d.count})`);
  return items.length === 1 ? items[0] : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
};

/*
 * "Unable to delete this user because they are associated with existing candidate application approvals (3). This user
 * cannot be deleted while these dependencies exist. Deactivate the account instead."
 */
export function dependencyMessage(def: DependencyKind, deps: Dependency[]): string {
  const who = def.person ? 'they are' : 'it is';
  const text =
    `Unable to delete this ${def.noun} because ${who} associated with existing ${listOf(deps)}. ` +
    `This ${def.noun} cannot be deleted while these dependencies exist.`;
  return def.hint ? `${text} ${def.hint}` : text;
}

/*
 * The check every delete makes, inside its transaction and before it deletes: locks the record's row FOR UPDATE (a
 * writer that is about to use it reads it FOR SHARE, see masters/shared/master-refs.ts, so whichever comes first wins),
 * then refuses with 409 HAS_DEPENDENCIES when anything still uses it. A row that does not exist is left to the caller.
 */
export async function assertNoDependencies(def: DependencyKind, id: string, m: EntityManager): Promise<void> {
  await m.query(`SELECT 1 FROM ${q(def.table)} WHERE id = $1 FOR UPDATE`, [id]);
  const deps = await findDependencies(def, id, m);
  if (deps.length) throw new AppError(HTTP_STATUS.CONFLICT, dependencyMessage(def, deps), ERROR_CODES.HAS_DEPENDENCIES);
}
