import { ERROR_CODES, HTTP_STATUS } from '../../../constants/api-response.constants';
import { env } from '../../../config/env.config';
import { AppError } from '../../../shared/errors/app-error';

/*
 * Student registration number: YYYYMMDDHHmmssSSSffffff (23 digits), e.g. 20261021123045127123456.
 *   YYYYMMDDHHmmss  date and time in APP_TIMEZONE (default Asia/Kolkata)
 *   SSS             milliseconds of the second
 *   ffffff          microseconds of the second (000000–999999), which includes the milliseconds
 *
 * The time comes from PostgreSQL's clock_timestamp(), which has real microsecond resolution, so every digit is a real
 * clock reading; nothing is padded or invented. Node's Date only has milliseconds and is not used.
 *
 * Uniqueness and concurrency: allocation takes a transaction-scoped advisory lock (held until the registration commits),
 * then reads the clock until it is strictly greater than the highest number already issued. So concurrent
 * registrations are serialised for this short step and always get distinct, increasing numbers, even if two arrive
 * in the same microsecond or the system clock briefly steps back. The UNIQUE index is the final safety net.
 */
export const REGISTRATION_NUMBER_RE = /^\d{23}$/;
/* Fixed key for pg_advisory_xact_lock, distinct from the per-Aadhaar locks (hashtext of a blind index). */
export const REGISTRATION_NUMBER_LOCK = 790_233_001;
const MAX_ATTEMPTS = 200;

export interface SqlRunner {
  query(sql: string, params?: unknown[]): Promise<{ [key: string]: unknown }[]>;
}

export const registrationNumberSql = `
  SELECT to_char(t AT TIME ZONE $1, 'YYYYMMDDHH24MISSMS') || to_char(t AT TIME ZONE $1, 'US') AS num
  FROM (SELECT clock_timestamp() AS t) c`;

/* Must run inside the transaction that inserts the student, so the lock covers the insert too. */
export async function allocateRegistrationNumber(m: SqlRunner, timezone = env.APP_TIMEZONE): Promise<string> {
  await m.query(`SELECT pg_advisory_xact_lock($1)`, [REGISTRATION_NUMBER_LOCK]);
  const [last] = await m.query(`SELECT max("registrationNumber") AS max FROM "students"`);
  const max = (last?.max as string | null) ?? '';
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const [row] = await m.query(registrationNumberSql, [timezone]);
    const num = String(row?.num ?? '');
    if (!REGISTRATION_NUMBER_RE.test(num)) throw new Error(`Registration number has an unexpected format: "${num}"`);
    /* Same length, digits only: string order equals numeric order. */
    if (num > max) return num;
  }
  /* The clock did not move past the last issued number (e.g. it was set back). Refuse rather than reuse or invent. */
  throw new AppError(
    HTTP_STATUS.SERVICE_UNAVAILABLE,
    'Could not allocate a registration number right now; please try again',
    ERROR_CODES.SERVICE_UNAVAILABLE,
  );
}
