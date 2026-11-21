import {
  buildReport,
  Geography,
  percent,
  placeKey,
  type LmsCountsRow,
  type ReportMasters,
} from '../../../src/modules/attendance-reports/attendance-report.builder';
import { MAHARASHTRA_DIVISIONS } from '../../../src/modules/attendance-reports/attendance-reports.constants';

/* M3 report builder: LMS codes → Amrut names, division placement, filters, totals and percentages. Synthetic data. */
const row = (code: string, c: Partial<LmsCountsRow> = {}): LmsCountsRow => ({
  code,
  batches: 1,
  sessionsHeld: 4,
  present: 0,
  late: 0,
  absent: 0,
  excused: 0,
  selfCheckIns: 0,
  geoCheckIns: 0,
  selfies: 0,
  groupPhotos: 0,
  ...c,
});

/* Amrut's own district codes are short (PUN, NGP …) and its names may use old spellings (Ahmednagar). */
const masters: ReportMasters = {
  districts: [
    { code: 'PUN', name: 'Pune' },
    { code: 'SAT', name: 'Satara' },
    { code: 'NGP', name: 'Nagpur' },
    { code: 'AHM', name: 'Ahmednagar' },
    { code: 'XYZ', name: 'Elsewhere' },
  ],
  centres: [
    { code: 'PUN-01', name: 'Pune Centre One', districtCode: 'PUN' },
    { code: 'SAT-01', name: 'Satara Centre', districtCode: 'SAT' },
    { code: 'NGP-01', name: 'Nagpur Centre', districtCode: 'NGP' },
  ],
};

describe('division table', () => {
  it('has the 6 divisions and 36 districts, each with a Marathi name, keys unique', () => {
    expect(MAHARASHTRA_DIVISIONS).toHaveLength(6);
    const districts = MAHARASHTRA_DIVISIONS.flatMap((d) => d.districts);
    expect(districts).toHaveLength(36);
    const keys = districts.flatMap((d) => [d.key, ...d.aliases]);
    expect(new Set(keys).size).toBe(keys.length);
    for (const d of [...MAHARASHTRA_DIVISIONS, ...districts]) expect(d.nameMr).toMatch(/[ऀ-ॿ]/);
  });
});

describe('helpers', () => {
  it('placeKey follows the LMS district key form', () => {
    expect(placeKey('Chhatrapati Sambhajinagar')).toBe('CHHATRAPATI_SAMBHAJINAGAR');
    expect(placeKey(' Mumbai  (Suburban) ')).toBe('MUMBAI_SUBURBAN');
  });
  it('percent rounds to one decimal and is null over zero', () => {
    expect(percent(1, 3)).toBe(33.3);
    expect(percent(2, 3)).toBe(66.7);
    expect(percent(0, 0)).toBeNull();
  });
});

describe('Geography', () => {
  const geo = new Geography(masters);
  it('matches an LMS district key by Amrut code, then by name key, and places it in its division', () => {
    expect(geo.district('PUN')).toEqual({
      place: { code: 'PUN', name: 'Pune', nameMr: 'पुणे' },
      division: { code: 'PUNE', name: 'Pune', nameMr: 'पुणे' },
      mapped: true,
    });
    /* An old spelling in Amrut's master still finds the division through the alias. */
    expect(geo.district('AHM').division?.code).toBe('NASHIK');
    expect(geo.district('AHM').place.nameMr).toBe('अहिल्यानगर');
    /* Name key (a centre without a district code on the LMS side). */
    expect(geo.district('SATARA').place).toEqual({ code: 'SAT', name: 'Satara', nameMr: 'सातारा' });
  });
  it('falls back to the division table, then to the bare code', () => {
    expect(geo.district('LATUR')).toEqual({
      place: { code: 'LATUR', name: 'Latur', nameMr: 'लातूर' },
      division: { code: 'CHHATRAPATI_SAMBHAJINAGAR', name: 'Chhatrapati Sambhajinagar', nameMr: 'छत्रपती संभाजीनगर' },
      mapped: true,
    });
    expect(geo.district('XYZ')).toEqual({ place: { code: 'XYZ', name: 'Elsewhere', nameMr: null }, division: null, mapped: true });
    expect(geo.district('QQQ')).toEqual({ place: { code: 'QQQ', name: 'QQQ', nameMr: null }, division: null, mapped: false });
    expect(geo.district('NOT_SET').place.name).toBe('Not set');
    expect(geo.district('NOT_SET').mapped).toBe(false);
  });
});

describe('buildReport', () => {
  it('division level: names in en and mr, totals and percentages from the summed counts', () => {
    const r = buildReport({
      level: 'division',
      filters: {},
      masters,
      lmsRows: [
        row('PUNE', { present: 70, late: 10, absent: 15, excused: 5, selfies: 3, groupPhotos: 2, selfCheckIns: 9, geoCheckIns: 8 }),
        row('NAGPUR', { present: 1, late: 0, absent: 2, excused: 0 }),
        row('NOT_MAPPED'),
      ],
    });
    expect(r.rows.map((x) => [x.code, x.name, x.nameMr, x.mapped])).toEqual([
      ['NAGPUR', 'Nagpur', 'नागपूर', true],
      ['PUNE', 'Pune', 'पुणे', true],
      ['NOT_MAPPED', 'Not mapped', 'जोडलेले नाही', false],
    ]);
    expect(r.rows[1]).toMatchObject({
      marked: 100,
      presentPercent: 70,
      latePercent: 10,
      absentPercent: 15,
      excusedPercent: 5,
      attendancePercent: 80,
      selfCheckIns: 9,
      geoCheckIns: 8,
      selfies: 3,
      groupPhotos: 2,
    });
    expect(r.rows[2].presentPercent).toBeNull();
    /* Totals are not an average of the row percentages: 71 of 103 marked. */
    expect(r.totals).toMatchObject({ present: 71, marked: 103, presentPercent: 68.9, batches: 3, sessionsHeld: 12 });
    expect(r.unplaced).toBe(0);
  });

  it('district level filtered by division keeps that division and counts the rows it cannot place', () => {
    const r = buildReport({
      level: 'district',
      filters: { division: 'pune' },
      masters,
      lmsRows: [row('PUN', { present: 5 }), row('SAT', { present: 3 }), row('NGP', { present: 9 }), row('QQQ'), row('NOT_SET')],
    });
    expect(r.rows.map((x) => x.code)).toEqual(['PUN', 'SAT']);
    expect(r.rows[0].division?.code).toBe('PUNE');
    expect(r.totals.present).toBe(8);
    /* QQQ has no known division; NOT_SET sits in NOT_MAPPED (known, just not Pune). */
    expect(r.unplaced).toBe(1);
    expect(r.filters.division).toEqual({ code: 'PUNE', name: 'Pune', nameMr: 'पुणे' });
  });

  it('centre level: centre names and parents from the masters, filtered by district', () => {
    const r = buildReport({
      level: 'centre',
      filters: { district: 'PUN' },
      masters,
      lmsRows: [row('PUN-01', { present: 4, absent: 1 }), row('SAT-01'), row('LMS-ONLY')],
    });
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({
      code: 'PUN-01',
      name: 'Pune Centre One',
      district: { code: 'PUN', name: 'Pune' },
      division: { code: 'PUNE' },
      presentPercent: 80,
    });
    expect(r.unplaced).toBe(1);
    expect(r.filters.district?.name).toBe('Pune');
  });

  it('centre level without a filter shows unknown centres under their LMS code, after the named ones', () => {
    const r = buildReport({ level: 'centre', filters: {}, masters, lmsRows: [row('LMS-ONLY'), row('SAT-01'), row('NGP-01')] });
    expect(r.rows.map((x) => [x.code, x.mapped])).toEqual([
      ['NGP-01', true],
      ['SAT-01', true],
      ['LMS-ONLY', false],
    ]);
  });

  it('batch level: placed under its centre through the LMS batch list, filtered by centre', () => {
    const r = buildReport({
      level: 'batch',
      filters: { centre: 'PUN-01' },
      masters,
      batchCentres: new Map([
        ['B1', 'PUN-01'],
        ['B2', 'SAT-01'],
      ]),
      lmsRows: [row('B1', { present: 2 }), row('B2'), row('B3')],
    });
    expect(r.rows.map((x) => x.code)).toEqual(['B1']);
    expect(r.rows[0].centre).toEqual({ code: 'PUN-01', name: 'Pune Centre One', nameMr: null });
    expect(r.unplaced).toBe(1);
  });

  it('an empty LMS answer gives no rows and zero totals with null percentages', () => {
    const r = buildReport({ level: 'district', filters: {}, masters, lmsRows: [] });
    expect(r.rows).toEqual([]);
    expect(r.totals).toMatchObject({ marked: 0, presentPercent: null, attendancePercent: null });
  });
});
