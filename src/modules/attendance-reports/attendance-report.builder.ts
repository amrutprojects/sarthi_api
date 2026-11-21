/*
 * M3: pure part of the attendance reports — the LMS's code-only counts (GET /tenant/v1/attendance) placed under
 * Amrut's own geography and named from Amrut's masters, with totals and percentages. No I/O here (unit-tested in
 * tests/unit/attendance-reports).
 *
 * How codes are matched (docs/m3-attendance-reports.md):
 * - district: the LMS groups by the centre's district code (the Amrut District Master code it pulled through
 *   /integration/v1/reference) or, when a centre has none, a key made from the district name; NOT_SET when neither.
 *   A row is matched to an Amrut district by code first, then by that name key.
 * - division: the LMS's division codes (KONKAN, PUNE, …, NOT_MAPPED). An Amrut district is placed in a division by
 *   MAHARASHTRA_DIVISIONS (matched by district name key, alias or code).
 * - centre: the LMS's centre code = Amrut Training Centre code; the centre's district comes from Amrut's master.
 * - batch: the LMS batch code; its centre comes from the LMS's batch list.
 */
import {
  LMS_DISTRICT_NOT_SET,
  LMS_DIVISION_NOT_MAPPED,
  MAHARASHTRA_DIVISIONS,
  type Division,
  type DivisionDistrict,
} from './attendance-reports.constants';

export type ReportLevel = 'division' | 'district' | 'centre' | 'batch';

/* One LMS row (lms-reads mapAttendance). */
export interface LmsCountsRow {
  code: string;
  batches: number;
  sessionsHeld: number;
  present: number;
  late: number;
  absent: number;
  excused: number;
  selfCheckIns: number;
  geoCheckIns: number;
  selfies: number;
  groupPhotos: number;
}

export interface MasterDistrict {
  code: string;
  name: string;
}

export interface MasterCentre {
  code: string;
  name: string;
  districtCode: string;
}

export interface ReportMasters {
  districts: MasterDistrict[];
  centres: MasterCentre[];
}

export interface ReportFilters {
  division?: string;
  district?: string;
  centre?: string;
}

export interface Place {
  code: string;
  name: string;
  nameMr: string | null;
}

export interface Counts {
  batches: number;
  sessionsHeld: number;
  present: number;
  late: number;
  absent: number;
  excused: number;
  /* present + late + absent + excused: the records the percentages are taken over. */
  marked: number;
  selfCheckIns: number;
  geoCheckIns: number;
  selfies: number;
  groupPhotos: number;
}

export interface Percents {
  /* Shares of `marked`, one decimal; null when nothing was marked. */
  presentPercent: number | null;
  latePercent: number | null;
  absentPercent: number | null;
  excusedPercent: number | null;
  /* (present + late) / marked: learners who attended. */
  attendancePercent: number | null;
}

export interface ReportRow extends Counts, Percents {
  code: string;
  name: string;
  nameMr: string | null;
  /* false when the code matched nothing in Amrut's masters (the row is still shown, under its LMS code). */
  mapped: boolean;
  division: Place | null;
  district: Place | null;
  centre: Place | null;
}

export interface BuiltReport {
  level: ReportLevel;
  filters: { division: Place | null; district: Place | null; centre: Place | null };
  rows: ReportRow[];
  totals: Counts & Percents;
  /* LMS rows a filter could not place, because their parent is unknown to Amrut (not counted in rows or totals). */
  unplaced: number;
}

/* "Chhatrapati Sambhajinagar" → CHHATRAPATI_SAMBHAJINAGAR (the LMS's district key form). */
export const placeKey = (s: string): string =>
  s
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

export const percent = (part: number, whole: number): number | null => (whole > 0 ? Math.round((part * 1000) / whole) / 10 : null);

export function withPercents<T extends Counts>(c: T): T & Percents {
  return {
    ...c,
    presentPercent: percent(c.present, c.marked),
    latePercent: percent(c.late, c.marked),
    absentPercent: percent(c.absent, c.marked),
    excusedPercent: percent(c.excused, c.marked),
    attendancePercent: percent(c.present + c.late, c.marked),
  };
}

const ZERO: Counts = {
  batches: 0,
  sessionsHeld: 0,
  present: 0,
  late: 0,
  absent: 0,
  excused: 0,
  marked: 0,
  selfCheckIns: 0,
  geoCheckIns: 0,
  selfies: 0,
  groupPhotos: 0,
};
const COUNT_KEYS = Object.keys(ZERO) as (keyof Counts)[];

const countsOf = (r: LmsCountsRow): Counts => ({
  batches: r.batches,
  sessionsHeld: r.sessionsHeld,
  present: r.present,
  late: r.late,
  absent: r.absent,
  excused: r.excused,
  marked: r.present + r.late + r.absent + r.excused,
  selfCheckIns: r.selfCheckIns,
  geoCheckIns: r.geoCheckIns,
  selfies: r.selfies,
  groupPhotos: r.groupPhotos,
});

export function sumCounts(rows: Counts[]): Counts {
  const t = { ...ZERO };
  for (const r of rows) for (const k of COUNT_KEYS) t[k] += r[k];
  return t;
}

interface CanonDistrict {
  division: Division;
  district: DivisionDistrict;
}

/* Amrut's geography: district / centre lookups by code and name key, and the division of each district. */
export class Geography {
  private readonly canon = new Map<string, CanonDistrict>();
  private readonly districtByCode = new Map<string, MasterDistrict>();
  private readonly districtByName = new Map<string, MasterDistrict>();
  private readonly centreByCode = new Map<string, MasterCentre>();

  constructor(masters: ReportMasters, divisions: readonly Division[] = MAHARASHTRA_DIVISIONS) {
    for (const division of divisions)
      for (const district of division.districts)
        for (const k of [district.key, ...district.aliases]) this.canon.set(k, { division, district });
    for (const m of masters.districts) {
      const code = m.code.trim().toUpperCase();
      if (code && !this.districtByCode.has(code)) this.districtByCode.set(code, m);
      const nk = placeKey(m.name);
      if (nk && !this.districtByName.has(nk)) this.districtByName.set(nk, m);
    }
    for (const c of masters.centres) {
      const code = c.code.trim().toUpperCase();
      if (code && !this.centreByCode.has(code)) this.centreByCode.set(code, c);
    }
  }

  division(code: string): Place {
    const d = MAHARASHTRA_DIVISIONS.find((x) => x.code === code);
    if (d) return { code: d.code, name: d.nameEn, nameMr: d.nameMr };
    if (code === LMS_DIVISION_NOT_MAPPED) return { code, name: 'Not mapped', nameMr: 'जोडलेले नाही' };
    return { code, name: code, nameMr: null };
  }

  isKnownDivision(code: string): boolean {
    return MAHARASHTRA_DIVISIONS.some((x) => x.code === code);
  }

  /* An LMS district key (or an Amrut district code) → the Amrut district, its Marathi name and division. */
  district(lmsKey: string): { place: Place; division: Place | null; mapped: boolean } {
    const key = lmsKey.trim().toUpperCase();
    if (key === LMS_DISTRICT_NOT_SET)
      return {
        place: { code: key, name: 'Not set', nameMr: 'नमूद नाही' },
        division: this.division(LMS_DIVISION_NOT_MAPPED),
        mapped: false,
      };
    const master = this.districtByCode.get(key) ?? this.districtByName.get(key);
    const canon =
      (master && (this.canon.get(placeKey(master.name)) ?? this.canon.get(master.code.trim().toUpperCase()))) ?? this.canon.get(key);
    const division = canon ? this.division(canon.division.code) : null;
    if (master) return { place: { code: master.code, name: master.name, nameMr: canon?.district.nameMr ?? null }, division, mapped: true };
    if (canon) return { place: { code: key, name: canon.district.nameEn, nameMr: canon.district.nameMr }, division, mapped: true };
    return { place: { code: key, name: key, nameMr: null }, division: null, mapped: false };
  }

  centre(code: string): { place: Place; district: Place | null; division: Place | null; mapped: boolean } {
    const c = this.centreByCode.get(code.trim().toUpperCase());
    if (!c) return { place: { code, name: code, nameMr: null }, district: null, division: null, mapped: false };
    const d = this.district(c.districtCode);
    return { place: { code: c.code, name: c.name, nameMr: null }, district: d.place, division: d.division, mapped: true };
  }
}

const sameCode = (a: string | undefined | null, b: string | undefined | null) =>
  !!a && !!b && a.trim().toUpperCase() === b.trim().toUpperCase();

/* Rows Amrut could not name sort after the named ones, then by name. */
const byName = (a: ReportRow, b: ReportRow) =>
  Number(!a.mapped) - Number(!b.mapped) || a.name.localeCompare(b.name, 'en') || a.code.localeCompare(b.code, 'en');

export interface BuildInput {
  level: ReportLevel;
  filters: ReportFilters;
  lmsRows: LmsCountsRow[];
  masters: ReportMasters;
  /* Batch level: LMS batch code → LMS centre code. */
  batchCentres?: Map<string, string>;
}

export function buildReport(input: BuildInput): BuiltReport {
  const geo = new Geography(input.masters);
  const f = input.filters;
  const rows: ReportRow[] = [];
  let unplaced = 0;

  /*
   * keep(): does a row with these parents pass the filters? `undefined` = a filter applies but the parent is unknown
   * (counted as unplaced, not shown).
   */
  const keep = (p: { division: Place | null; district: Place | null; centre: Place | null }): boolean | undefined => {
    if (f.division) {
      if (!p.division) return undefined;
      if (!sameCode(p.division.code, f.division)) return false;
    }
    if (f.district) {
      if (!p.district) return undefined;
      if (!sameCode(p.district.code, f.district)) return false;
    }
    if (f.centre) {
      if (!p.centre) return undefined;
      if (!sameCode(p.centre.code, f.centre)) return false;
    }
    return true;
  };

  for (const r of input.lmsRows) {
    let row: Omit<ReportRow, keyof Counts | keyof Percents>;
    if (input.level === 'division') {
      const place = geo.division(r.code);
      row = { ...place, mapped: geo.isKnownDivision(r.code), division: place, district: null, centre: null };
    } else if (input.level === 'district') {
      const d = geo.district(r.code);
      row = { ...d.place, mapped: d.mapped, division: d.division, district: d.place, centre: null };
    } else if (input.level === 'centre') {
      const c = geo.centre(r.code);
      row = { ...c.place, mapped: c.mapped, division: c.division, district: c.district, centre: c.place };
    } else {
      const centreCode = input.batchCentres?.get(r.code);
      const c = centreCode ? geo.centre(centreCode) : null;
      row = {
        code: r.code,
        name: r.code,
        nameMr: null,
        mapped: !!c,
        division: c?.division ?? null,
        district: c?.district ?? null,
        centre: c ? (c.mapped ? c.place : { code: centreCode as string, name: centreCode as string, nameMr: null }) : null,
      };
    }
    const k = keep(row);
    if (k === undefined) unplaced += 1;
    if (!k) continue;
    rows.push({ ...row, ...withPercents(countsOf(r)) });
  }

  rows.sort(byName);
  return {
    level: input.level,
    filters: {
      division: f.division ? geo.division(f.division.trim().toUpperCase()) : null,
      district: f.district ? geo.district(f.district).place : null,
      centre: f.centre ? geo.centre(f.centre).place : null,
    },
    rows,
    totals: withPercents(sumCounts(rows)),
    unplaced,
  };
}
