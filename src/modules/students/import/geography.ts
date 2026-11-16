import { AppDataSource } from '../../../config/database.config';
import { masterKey } from '../../masters';
import { DISTRICT_ALIASES } from '../student.constants';

/* code may be null in the geography masters (a district or taluka entered without one): it then matches by name only. */
export interface PlaceRef {
  id: string;
  code: string | null;
  name: string;
}

/*
 * Districts and talukas of the geography masters (CMS States / Districts / Talukas), loaded once per import batch
 * and matched in memory. A district matches by code, English name or a source spelling (DISTRICT_ALIASES: the Marathi
 * name, a former name); a taluka matches by code or name within its district.
 */
export interface GeographyLookup {
  district(value: string): PlaceRef | null;
  taluka(districtId: string | null, value: string): PlaceRef | null;
}

export function buildGeographyLookup(districts: PlaceRef[], talukas: (PlaceRef & { districtId: string })[]): GeographyLookup {
  /* Keys of a place: its name and its code, whichever are present. */
  const keys = (p: PlaceRef) => [p.name, p.code].filter((v): v is string => !!v && !!v.trim()).map(masterKey);
  const byValue = new Map<string, PlaceRef>();
  const byCode = new Map(districts.filter((d) => d.code).map((d) => [d.code!.trim().toUpperCase(), d]));
  for (const d of districts) for (const k of keys(d)) byValue.set(k, d);
  for (const [code, names] of Object.entries(DISTRICT_ALIASES)) {
    const d = byCode.get(code);
    if (d) for (const n of names) if (!byValue.has(masterKey(n))) byValue.set(masterKey(n), d);
  }
  const talukaByDistrict = new Map<string, Map<string, PlaceRef>>();
  for (const t of talukas) {
    const m = talukaByDistrict.get(t.districtId) ?? new Map<string, PlaceRef>();
    for (const k of keys(t)) m.set(k, t);
    talukaByDistrict.set(t.districtId, m);
  }
  return {
    district: (value) => (value.trim() ? (byValue.get(masterKey(value)) ?? null) : null),
    taluka: (districtId, value) => (districtId && value.trim() ? (talukaByDistrict.get(districtId)?.get(masterKey(value)) ?? null) : null),
  };
}

/* No geography (unit tests of the validator without a database, or a source without district columns). */
export const EMPTY_GEOGRAPHY: GeographyLookup = { district: () => null, taluka: () => null };

export async function loadGeographyLookup(): Promise<GeographyLookup> {
  const [districts, talukas] = await Promise.all([
    AppDataSource.query(`SELECT "id", "code", "name" FROM "districts" WHERE "isDelete" = false AND "isActive" = true`) as Promise<
      PlaceRef[]
    >,
    AppDataSource.query(
      `SELECT t."id", t."code", t."name", t."districtId" FROM "talukas" t
         JOIN "districts" d ON d."id" = t."districtId" AND d."isDelete" = false AND d."isActive" = true
        WHERE t."isDelete" = false AND t."isActive" = true`,
    ) as Promise<(PlaceRef & { districtId: string })[]>,
  ]);
  return buildGeographyLookup(districts, talukas);
}
