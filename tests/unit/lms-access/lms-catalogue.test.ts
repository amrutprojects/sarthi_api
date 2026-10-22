import { LMS_CODES, lmsCatalogue } from '../../../src/modules/lms-access/lms-catalogue';
import { LMS_MENUS, LMS_PERMISSIONS } from '../../../src/modules/lms-access/lms-catalogue.data';

describe('LMS menu catalogue', () => {
  it('offers every LMS permission code exactly once', () => {
    const offered = lmsCatalogue().flatMap((g) => g.areas.flatMap((a) => a.permissions.map((p) => p.code)));
    expect(offered.sort()).toEqual(LMS_PERMISSIONS.map((p) => p.code).sort());
    expect(new Set(offered).size).toBe(offered.length);
    expect(LMS_CODES.size).toBe(LMS_PERMISSIONS.length);
  });

  it('only opens LMS menus with codes that exist in the catalogue', () => {
    for (const m of LMS_MENUS) for (const c of m.view) expect(LMS_CODES.has(c)).toBe(true);
  });

  it('groups areas like the LMS sidebar, with no area left in "Other"', () => {
    const groups = lmsCatalogue().map((g) => g.group);
    expect(groups).not.toContain('Other');
    expect(groups[0]).toBe('Command Centre');
    const batches = lmsCatalogue()
      .flatMap((g) => g.areas)
      .find((a) => a.area === 'batch');
    expect(batches?.label).toBe('Batches & schedule');
    expect(batches?.menus).toContainEqual({ label: 'Batches & Schedule', view: ['batch.view'] });
  });
});
