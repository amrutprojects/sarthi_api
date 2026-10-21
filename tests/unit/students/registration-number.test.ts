import '../../helpers/unit-env';
import { AppError } from '../../../src/shared/errors/app-error';
import {
  allocateRegistrationNumber,
  REGISTRATION_NUMBER_LOCK,
  REGISTRATION_NUMBER_RE,
  type SqlRunner,
} from '../../../src/modules/students/registration/registration-number';

/* A stand-in for the transaction: records SQL, returns the given max and a scripted sequence of clock readings. */
function fakeDb(max: string | null, clock: string[]) {
  const calls: { sql: string; params?: unknown[] }[] = [];
  let i = 0;
  const db: SqlRunner = {
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (sql.includes('pg_advisory_xact_lock')) return [];
      if (sql.includes('max("registrationNumber")')) return [{ max }];
      return [{ num: clock[Math.min(i++, clock.length - 1)] }];
    },
  };
  return { db, calls, reads: () => i };
}

describe('allocateRegistrationNumber', () => {
  it('takes the advisory lock first and returns the clock reading (23 digits)', async () => {
    const { db, calls } = fakeDb(null, ['20261021123045127127456']);
    await expect(allocateRegistrationNumber(db, 'Asia/Kolkata')).resolves.toBe('20261021123045127127456');
    expect(calls[0]).toEqual({ sql: 'SELECT pg_advisory_xact_lock($1)', params: [REGISTRATION_NUMBER_LOCK] });
    expect(calls.at(-1)?.params).toEqual(['Asia/Kolkata']);
  });

  it('reads the clock again until it is past the last issued number (same microsecond, clock step back)', async () => {
    const last = '20261021123045127127456';
    const { db, reads } = fakeDb(last, [last, '20261021123045127127455', '20261021123045127127457']);
    await expect(allocateRegistrationNumber(db)).resolves.toBe('20261021123045127127457');
    expect(reads()).toBe(3);
  });

  it('refuses with 503 instead of inventing digits when the clock never moves past the last number', async () => {
    const { db } = fakeDb('20991231235959999999999', ['20261021123045127127456']);
    const err = await allocateRegistrationNumber(db).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).statusCode).toBe(503);
  });

  it('rejects a malformed clock reading', async () => {
    const { db } = fakeDb(null, ['2026102112304512712745']);
    await expect(allocateRegistrationNumber(db)).rejects.toThrow('unexpected format');
  });

  it('format: exactly 23 digits', () => {
    expect(REGISTRATION_NUMBER_RE.test('20261021123045127123456')).toBe(true);
    expect(REGISTRATION_NUMBER_RE.test('2026102112304512712345')).toBe(false);
    expect(REGISTRATION_NUMBER_RE.test('2026102112304512712345a')).toBe(false);
  });
});
