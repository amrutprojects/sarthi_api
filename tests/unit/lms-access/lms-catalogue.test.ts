import { LMS_CODES, LMS_GRANTABLE_CODES, LMS_SENSITIVE_CODES, lmsCatalogue } from '../../../src/modules/lms-access/lms-catalogue';
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

describe('sensitive LMS codes', () => {
  it('splits the catalogue into grantable and sensitive codes, with the permission switch sensitive', () => {
    expect(LMS_SENSITIVE_CODES.size + LMS_GRANTABLE_CODES.size).toBe(LMS_PERMISSIONS.length);
    expect(LMS_SENSITIVE_CODES.has('iam.permission.status')).toBe(true);
    expect(LMS_SENSITIVE_CODES.has('certificate.approve')).toBe(true);
    expect(LMS_GRANTABLE_CODES.has('batch.view')).toBe(true);
    for (const code of LMS_SENSITIVE_CODES) expect(LMS_GRANTABLE_CODES.has(code)).toBe(false);
  });
});

describe('LMS permission labels', () => {
  it('labels a code by its action, or by the whole code when it sits in another module', () => {
    const all = lmsCatalogue().flatMap((g) => g.areas.flatMap((a) => a.permissions));
    expect(all.find((p) => p.code === 'batch.view')?.label).toBe('View');
    expect(all.find((p) => p.code === 'attempt.void')?.label).toBe('Attempt · void');
  });
});
