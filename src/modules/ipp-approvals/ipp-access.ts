import type { AuthUser } from '../auth';
import { FINAL_RANK, LEVEL_PERMISSIONS, STAGE_RANK, STAGES, SUPER_ROLES, type Level, type Stage } from './ipp-approvals.constants';

/*
 * Who decides and who sees what (docs/ipp-approvals.md "Who decides what"). One place for both: the rights of a user
 * and the SQL conditions every list, detail, document, bulk and decision query is built with, so nothing is filtered
 * after the fact. SQL aliases: a = ipp_applications, b = ipp_batches.
 */
export interface IppAccess {
  userId: string;
  /* The levels the user's rights cover, whether or not the Head Office switch lets them decide now. */
  levels: readonly Level[];
  /* The stages the user decides now. */
  decides: readonly Level[];
  /* Reads everything: Super Admins, and a user whose only right here is ipp-approvals.view. */
  seesAll: boolean;
}

export const isSuperRole = (roleCodes: readonly string[]): boolean => roleCodes.some((c) => SUPER_ROLES.includes(c));

export function accessOf(auth: Pick<AuthUser, 'id' | 'permissions' | 'roleCodes'>, headOffice: boolean): IppAccess {
  /* These roles hold every permission, so their rights never come from the permissions. */
  const isSuper = isSuperRole(auth.roleCodes);
  const levels: Level[] = isSuper
    ? ['SUPER_ADMIN']
    : LEVEL_PERMISSIONS.filter(([code]) => auth.permissions.has(code)).map(([, level]) => level);
  const decides = levels.filter((l) => (l === 'HEAD_OFFICE' ? headOffice : l === 'SUPER_ADMIN' ? !headOffice : true));
  return { userId: auth.id, levels, decides, seesAll: isSuper || !levels.length };
}

/* Positional parameters of a hand-written query. */
export class SqlParams {
  readonly values: unknown[] = [];
  add(value: unknown): string {
    this.values.push(value);
    return `$${this.values.length}`;
  }
}

/* What a level sees. */
function scopeSql(access: IppAccess, level: Level, p: SqlParams): string {
  switch (level) {
    case 'DIVISION':
      return `EXISTS (SELECT 1 FROM "user_districts" ud WHERE ud."userId" = ${p.add(access.userId)}::uuid AND ud."districtId" = b."districtId" AND ud."isDelete" = false)`;
    case 'COEP':
      return `a."reached" >= ${STAGE_RANK.COEP}`;
    case 'HEAD_OFFICE':
      return `a."reached" >= ${FINAL_RANK}`;
    case 'SUPER_ADMIN':
      return 'true';
  }
}

const any = (conditions: string[]): string => (conditions.length ? `(${conditions.join(' OR ')})` : 'false');
const inStages = (stages: readonly Stage[]): string =>
  stages.length ? `a."stage" IN (${stages.map((s) => `'${s}'`).join(', ')})` : 'false';

/* The user may see the application. */
export function visibleSql(access: IppAccess, p: SqlParams): string {
  if (access.seesAll) return 'true';
  return any(access.levels.map((l) => scopeSql(access, l, p)));
}

/* The application is the user's to decide now. */
export function canDecideSql(access: IppAccess, p: SqlParams): string {
  return any(access.decides.map((l) => `(a."stage" = '${l}' AND ${scopeSql(access, l, p)})`));
}

/* Above (or below) every level of the user that covers this application. Without a level nothing is above or below. */
function beyondSql(access: IppAccess, p: SqlParams, beyond: (stage: number, level: number) => boolean): string {
  if (!access.levels.length) return 'false';
  const conditions = access.levels.map((l) => {
    const stages = STAGES.filter((s) => beyond(STAGE_RANK[s], STAGE_RANK[l]));
    return `(NOT ${scopeSql(access, l, p)} OR ${inStages(stages)})`;
  });
  return `(${conditions.join(' AND ')})`;
}
export const aboveSql = (access: IppAccess, p: SqlParams): string => beyondSql(access, p, (stage, level) => stage > level);
export const belowSql = (access: IppAccess, p: SqlParams): string => beyondSql(access, p, (stage, level) => stage < level);

/* Districts limit what the user sees only when Divisional Officer is their only level. */
export const limitedToDistricts = (access: IppAccess): boolean => access.levels.length === 1 && access.levels[0] === 'DIVISION';
