import type { EntityManager } from 'typeorm';
import { HTTP_STATUS } from '../../constants/api-response.constants';
import { AppError } from '../../shared/errors/app-error';
import { MAHARASHTRA_DIVISIONS } from '../attendance-reports';
import { masterKey } from '../masters';
import { DISTRICT_ALIASES } from '../students';
import { IPP_ERROR } from './ipp-approvals.constants';

/*
 * Places a batch of IPP in a district of Sarthi's District Master (active, not deleted): by code, then by name, then by
 * the known other spellings (former names, Marathi names). No match, or more than one, is refused: a batch must never
 * reach the officers of a wrong district.
 */
export interface DistrictRef {
  id: string;
  code: string;
  name: string;
  stateCode: string;
}
export interface WantedDistrict {
  code: string;
  name: string;
  state_code: string | null;
}

/* A code with and without the state in front: PUN and MH-PUN are the same district of MH. */
function codeForms(code: string, stateCode: string | null): string[] {
  const c = code.trim().toUpperCase();
  const s = (stateCode ?? '').trim().toUpperCase();
  if (!s) return [c];
  return c.startsWith(`${s}-`) ? [c, c.slice(s.length + 1)] : [c, `${s}-${c}`];
}

/* Names that mean the same district, as sets of masterKey() values. */
const SAME_NAMES: readonly ReadonlySet<string>[] = (() => {
  const groups = MAHARASHTRA_DIVISIONS.flatMap((v) => v.districts).map((d) => new Set([d.nameEn, d.nameMr, ...d.aliases].map(masterKey)));
  for (const names of Object.values(DISTRICT_ALIASES)) {
    const keys = names.map(masterKey);
    const group = groups.find((g) => keys.some((k) => g.has(k)));
    if (group) for (const k of keys) group.add(k);
  }
  return groups;
})();
const otherNames = (key: string): ReadonlySet<string> => SAME_NAMES.find((g) => g.has(key)) ?? new Set();

export function matchDistrict(districts: readonly DistrictRef[], wanted: WantedDistrict): DistrictRef | null {
  /* Within the state, when the District Master has a state of that code. */
  const state = (wanted.state_code ?? '').trim().toUpperCase();
  const ofState = state ? districts.filter((d) => d.stateCode.toUpperCase() === state) : [];
  const pool = ofState.length ? ofState : districts;

  const forms = codeForms(wanted.code, wanted.state_code);
  const exact = pool.filter((d) => d.code.toUpperCase() === forms[0]);
  const byCode = exact.length ? exact : pool.filter((d) => codeForms(d.code, d.stateCode).some((f) => forms.includes(f)));

  const key = masterKey(wanted.name);
  const sameName = pool.filter((d) => masterKey(d.name) === key);
  const others = otherNames(key);
  const byName = sameName.length ? sameName : pool.filter((d) => others.has(masterKey(d.name)));

  /*
   * The code decides and the name only fills in when the code is unknown here. But a code that says one district and a
   * name that plainly says another mean that the two masters use the code differently: then neither is trusted.
   */
  const found = !byCode.length ? byName : !byName.length ? byCode : byCode.filter((d) => byName.includes(d));
  return found.length === 1 ? found[0] : null;
}

/* The district id of a batch, or 409 DISTRICT_UNKNOWN. */
export async function districtIdFor(m: EntityManager, wanted: WantedDistrict): Promise<string> {
  const districts: DistrictRef[] = await m.query(
    `SELECT d."id", d."code", d."name", s."code" AS "stateCode"
       FROM "districts" d JOIN "states" s ON s."id" = d."stateId" AND s."isDelete" = false
      WHERE d."isDelete" = false AND d."isActive" = true`,
  );
  const match = matchDistrict(districts, wanted);
  if (!match)
    throw new AppError(
      HTTP_STATUS.CONFLICT,
      `The district ${wanted.name} (${wanted.code}) is not in Sarthi's District Master, or not clearly one district there`,
      IPP_ERROR.DISTRICT_UNKNOWN,
    );
  return match.id;
}
