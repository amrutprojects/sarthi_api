import type { EntityManager } from 'typeorm';
import {
  assertNoDependencies,
  countedBy,
  defineDependencies,
  dependencyMessage,
  findDependencies,
  fromReferences,
  rowsWhere,
  rowsWithJson,
  type DependencyKind,
} from '../../../src/shared/dependencies/dependencies';
import { AppError } from '../../../src/shared/errors/app-error';

/* The delete-dependency rule (src/shared/dependencies): messages, counting, the lock and the 409. No database. */

/* A manager whose query() answers from `counts` by the table named in the SQL, and remembers every statement. */
function fakeManager(counts: Record<string, number> = {}) {
  const sql: { text: string; params: unknown[] }[] = [];
  const m = {
    query: jest.fn(async (text: string, params: unknown[] = []) => {
      sql.push({ text, params });
      if (text.includes('FOR UPDATE')) return [{ '?column?': 1 }];
      const table = /FROM "([^"]+)"/.exec(text)?.[1] ?? '';
      return [{ n: counts[table] ?? 0 }];
    }),
  };
  return { m: m as unknown as EntityManager, sql };
}

let n = 0;
const kind = (over: Partial<DependencyKind> = {}): DependencyKind => ({
  kind: `unit-kind-${++n}`,
  noun: 'district',
  table: 'districts',
  permission: 'cms-districts.delete',
  rules: [rowsWhere('talukas', 'talukas', 'districtId'), rowsWhere('student registrations', 'students', 'districtId')],
  ...over,
});

describe('dependencyMessage', () => {
  it('names a thing "it" and lists each dependency with its count', () => {
    expect(dependencyMessage(kind(), [{ label: 'talukas', count: 3 }])).toBe(
      'Unable to delete this district because it is associated with existing talukas (3). This district cannot be deleted while these dependencies exist.',
    );
    expect(
      dependencyMessage(kind({ hint: 'Deactivate it instead.' }), [
        { label: 'talukas', count: 1 },
        { label: 'colleges', count: 2 },
        { label: 'student registrations', count: 4 },
      ]),
    ).toBe(
      'Unable to delete this district because it is associated with existing talukas (1), colleges (2) and student registrations (4). ' +
        'This district cannot be deleted while these dependencies exist. Deactivate it instead.',
    );
  });

  it('names a person "they" (the COEP example)', () => {
    const user = kind({ noun: 'user', person: true, hint: 'Deactivate the account instead.' });
    expect(dependencyMessage(user, [{ label: 'candidate application approvals', count: 5 }])).toBe(
      'Unable to delete this user because they are associated with existing candidate application approvals (5). ' +
        'This user cannot be deleted while these dependencies exist. Deactivate the account instead.',
    );
  });
});

describe('rules', () => {
  it('count live rows by a column, skipping soft-deleted ones unless the table has no flag', async () => {
    const { m, sql } = fakeManager({ user_districts: 2, ipp_approval_events: 7 });
    expect(await rowsWhere('mappings', 'user_districts', 'userId').count(m, 'u1')).toBe(2);
    expect(await rowsWhere('approvals', 'ipp_approval_events', 'byUserId', { live: false, where: `event = 'APPROVED'` }).count(m, 'u1')).toBe(7);
    expect(sql.map((s) => s.text)).toEqual([
      'SELECT count(*)::int AS n FROM "user_districts" WHERE "userId" = $1 AND "isDelete" = false',
      `SELECT count(*)::int AS n FROM "ipp_approval_events" WHERE "byUserId" = $1 AND (event = 'APPROVED')`,
    ]);
    expect(sql.every((s) => s.params[0] === 'u1')).toBe(true);
  });

  it('count ids kept in JSON data, and rules written as SQL', async () => {
    const { m, sql } = fakeManager({ import_rows: 4, students: 1 });
    expect(await rowsWithJson('import rows', 'import_rows', 'data', 'districtId').count(m, 'd1')).toBe(4);
    expect(await countedBy('students', 'SELECT count(*)::int AS n FROM "students" WHERE x = $1').count(m, 'd1')).toBe(1);
    expect(sql[0].text).toBe(`SELECT count(*)::int AS n FROM "import_rows" WHERE "data" ->> 'districtId' = $1::text AND "isDelete" = false`);
  });

  it('a reference list is read at every check, so an entry appended later counts too', async () => {
    const list = [{ one: 'course', count: async () => 2 }];
    const def = kind({ rules: () => fromReferences(list) });
    const { m } = fakeManager();
    expect(await findDependencies(def, 'e1', m)).toEqual([{ label: 'courses', count: 2 }]);
    list.push({ one: 'calendar', count: async () => 1 });
    expect(await findDependencies(def, 'e1', m)).toEqual([
      { label: 'courses', count: 2 },
      { label: 'calendars', count: 1 },
    ]);
  });
});

describe('findDependencies and assertNoDependencies', () => {
  it('returns only what is used, in the order of the rules', async () => {
    const { m } = fakeManager({ students: 3 });
    expect(await findDependencies(kind(), 'd1', m)).toEqual([{ label: 'student registrations', count: 3 }]);
  });

  it('locks the row FOR UPDATE first, then refuses with 409 HAS_DEPENDENCIES and the message', async () => {
    const { m, sql } = fakeManager({ talukas: 2 });
    const err = await assertNoDependencies(kind(), 'd1', m).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(AppError);
    expect(err).toMatchObject({
      statusCode: 409,
      code: 'HAS_DEPENDENCIES',
      message:
        'Unable to delete this district because it is associated with existing talukas (2). This district cannot be deleted while these dependencies exist.',
    });
    expect(sql[0]).toEqual({ text: 'SELECT 1 FROM "districts" WHERE id = $1 FOR UPDATE', params: ['d1'] });
  });

  it('lets an unused record through, and one with no rules at all', async () => {
    await expect(assertNoDependencies(kind(), 'd1', fakeManager().m)).resolves.toBeUndefined();
    await expect(assertNoDependencies(kind({ rules: [] }), 'f1', fakeManager().m)).resolves.toBeUndefined();
  });
});

describe('defineDependencies', () => {
  it('registers a kind once; a second, different definition of it is a programming error', () => {
    const def = defineDependencies(kind({ kind: 'unit-twice' }));
    expect(defineDependencies(def)).toBe(def);
    expect(() => defineDependencies(kind({ kind: 'unit-twice' }))).toThrow('Dependencies of "unit-twice" are defined twice');
  });
});
