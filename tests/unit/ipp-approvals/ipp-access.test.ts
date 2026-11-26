import { accessOf, canDecideSql, limitedToDistricts, SqlParams, visibleSql } from '../../../src/modules/ipp-approvals/ipp-access';
import { approveTo, rejectTo, STAGE_RANK, STAGES } from '../../../src/modules/ipp-approvals/ipp-approvals.constants';
import { backoffSeconds } from '../../../src/modules/ipp-approvals/ipp-outbox.worker';

const VIEW = 'ipp-approvals.view';
const DO = 'ipp-approvals.division-officer';
const COEP = 'ipp-approvals.coep';
const HO = 'ipp-approvals.head-office';
const user = (permissions: string[], roleCodes: string[] = []) => ({
  id: '00000000-0000-4000-8000-000000000001',
  permissions: new Set(permissions),
  roleCodes,
});

describe('what a user decides and sees', () => {
  it('follows the permissions', () => {
    expect(accessOf(user([VIEW, DO]), true)).toMatchObject({ levels: ['DIVISION'], decides: ['DIVISION'], seesAll: false });
    expect(accessOf(user([VIEW, COEP]), false)).toMatchObject({ levels: ['COEP'], decides: ['COEP'], seesAll: false });
    expect(accessOf(user([VIEW, DO, COEP, HO]), true).decides).toEqual(['DIVISION', 'COEP', 'HEAD_OFFICE']);
  });

  it('the Head Officer decides only while Head Office approval is on, the Super Admin only while it is off', () => {
    expect(accessOf(user([VIEW, HO]), true).decides).toEqual(['HEAD_OFFICE']);
    expect(accessOf(user([VIEW, HO]), false)).toMatchObject({ levels: ['HEAD_OFFICE'], decides: [], seesAll: false });
    for (const role of ['SUPER_ADMIN', 'SUMAGO_SUPER_ADMIN']) {
      /* They hold every permission: none of them counts. */
      expect(accessOf(user([VIEW, DO, COEP, HO], [role]), true)).toMatchObject({ levels: ['SUPER_ADMIN'], decides: [], seesAll: true });
      expect(accessOf(user([VIEW, DO, COEP, HO], [role, 'COEP']), false)).toMatchObject({ decides: ['SUPER_ADMIN'], seesAll: true });
    }
  });

  it('view alone reads everything and decides nothing', () => {
    expect(accessOf(user([VIEW]), true)).toMatchObject({ levels: [], decides: [], seesAll: true });
  });

  it('only a user with no other level is limited to districts', () => {
    expect(limitedToDistricts(accessOf(user([VIEW, DO]), true))).toBe(true);
    expect(limitedToDistricts(accessOf(user([VIEW, DO, COEP]), true))).toBe(false);
    expect(limitedToDistricts(accessOf(user([VIEW]), true))).toBe(false);
  });

  it('the SQL conditions: nothing for nobody, the user id always as a parameter', () => {
    expect(canDecideSql(accessOf(user([VIEW]), true), new SqlParams())).toBe('false');
    expect(visibleSql(accessOf(user([VIEW]), true), new SqlParams())).toBe('true');
    const p = new SqlParams();
    const sql = visibleSql(accessOf(user([VIEW, DO, COEP]), true), p);
    expect(p.values).toEqual(['00000000-0000-4000-8000-000000000001']);
    expect(sql).toContain('$1::uuid');
    expect(sql).toContain('a."reached" >= 2');
  });
});

describe('moves', () => {
  it('approve one level on, reject one level back', () => {
    expect(approveTo('DIVISION', true)).toBe('COEP');
    expect(approveTo('COEP', true)).toBe('HEAD_OFFICE');
    expect(approveTo('COEP', false)).toBe('SUPER_ADMIN');
    expect(approveTo('HEAD_OFFICE', true)).toBe('APPROVED');
    expect(approveTo('SUPER_ADMIN', false)).toBe('APPROVED');
    expect([rejectTo('DIVISION'), rejectTo('COEP'), rejectTo('HEAD_OFFICE'), rejectTo('SUPER_ADMIN')]).toEqual([
      'AUDITOR',
      'DIVISION',
      'COEP',
      'COEP',
    ]);
  });

  it('every stage has a rank; the two final stages share one', () => {
    expect(STAGES.map((s) => STAGE_RANK[s])).toEqual([0, 1, 2, 3, 3, 4]);
  });
});

describe('backoff of the outbox', () => {
  it('30 s, 1, 2, 5, 10, 30 min, then every hour', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 50].map(backoffSeconds)).toEqual([30, 60, 120, 300, 600, 1800, 3600, 3600, 3600]);
  });
});
