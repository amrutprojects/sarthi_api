import '../../helpers/unit-env';
import { AppError } from '../../../src/shared/errors/app-error';
import {
  allocateRegistrationNumber,
  REGISTRATION_NUMBER_LOCK,
  REGISTRATION_NUMBER_RE,
  type SqlRunner,
} from '../../../src/modules/students/registration/registration-number';

/* A stand-in for the transaction: records SQL, knows which numbers are taken, returns scripted clock readings. */
function fakeDb(taken: string[], clock: string[]) {
  const calls: { sql: string; params?: unknown[] }[] = [];
  let i = 0;
  const db: SqlRunner = {
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (sql.includes('pg_advisory_xact_lock')) return [];
      if (sql.includes('SELECT 1 FROM "students"')) return taken.includes(params?.[0] as string) ? [{ '?column?': 1 }] : [];
      return [{ num: clock[Math.min(i++, clock.length - 1)] }];
    },
  };
  return { db, calls, reads: () => i };
}

describe('allocateRegistrationNumber', () => {
  it('takes the advisory lock first and returns the clock reading (16 digits)', async () => {
    const { db, calls } = fakeDb([], ['1021123045127456']);
    await expect(allocateRegistrationNumber(db, 'Asia/Kolkata')).resolves.toBe('1021123045127456');
    expect(calls[0]).toEqual({ sql: 'SELECT pg_advisory_xact_lock($1)', params: [REGISTRATION_NUMBER_LOCK] });
    expect(calls[1].params).toEqual(['Asia/Kolkata']);
  });

  it('reads the clock again while the number is taken (same microsecond, or the same instant in an earlier year)', async () => {
    const { db, reads } = fakeDb(['1021123045127456', '1021123045127457'], ['1021123045127456', '1021123045127457', '1021123045127458']);
    await expect(allocateRegistrationNumber(db)).resolves.toBe('1021123045127458');
    expect(reads()).toBe(3);
  });

  it('accepts a smaller number than earlier ones (no year: January after December)', async () => {
    const { db } = fakeDb(['1231235959999999'], ['0101000000000001']);
    await expect(allocateRegistrationNumber(db)).resolves.toBe('0101000000000001');
  });

  it('refuses with 503 instead of inventing digits when every reading is taken', async () => {
    const { db } = fakeDb(['1021123045127456'], ['1021123045127456']);
    const err = await allocateRegistrationNumber(db).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).statusCode).toBe(503);
  });

  it('rejects a malformed clock reading', async () => {
    const { db } = fakeDb([], ['102112304512745']);
    await expect(allocateRegistrationNumber(db)).rejects.toThrow('unexpected format');
  });

  it('format: exactly 16 digits', () => {
    expect(REGISTRATION_NUMBER_RE.test('1021123045127456')).toBe(true);
    expect(REGISTRATION_NUMBER_RE.test('20261021123045127123456')).toBe(false);
    expect(REGISTRATION_NUMBER_RE.test('102112304512745a')).toBe(false);
  });
});
