import { ERROR_CODES, HTTP_STATUS } from '../../../constants/api-response.constants';
import { env } from '../../../config/env.config';
import { AppError } from '../../../shared/errors/app-error';

/*
 * Student registration number: MMDDHHmmssSSSfff (16 digits), e.g. 1019175233598595.
 *   MMDDHHmmss  month, day, hour, minute, second in APP_TIMEZONE (default Asia/Kolkata); no year
 *   SSS         milliseconds (000–999)
 *   fff         microseconds within that millisecond (000–999)
 *
 * The time comes from PostgreSQL's clock_timestamp(), which has real microsecond resolution, so every digit is a real
 * clock reading; nothing is padded or invented. Node's Date only has milliseconds and is not used.
 *
 * Uniqueness and concurrency: allocation takes a transaction-scoped advisory lock (held until the registration commits)
 * and reads the clock until it gives a number that no student has yet. Concurrent registrations are therefore
 * serialised for this short step and always get distinct numbers, including two in the same microsecond. Because the
 * format has no year, the same instant in a later year maps to the same number; that number is then taken, so the clock
 * is simply read again (the next microsecond). The UNIQUE index is the final safety net.
 */
export const REGISTRATION_NUMBER_RE = /^\d{16}$/;
/* Fixed key for pg_advisory_xact_lock, distinct from the per-Aadhaar locks (hashtext of a blind index). */
export const REGISTRATION_NUMBER_LOCK = 790_233_001;
const MAX_ATTEMPTS = 200;

export interface SqlRunner {
  query(sql: string, params?: unknown[]): Promise<{ [key: string]: unknown }[]>;
}

/* 'US' is the microseconds of the second (000000–999999); its last three digits are the microseconds within the ms. */
export const registrationNumberSql = `
  SELECT to_char(t AT TIME ZONE $1, 'MMDDHH24MISSMS') || substr(to_char(t AT TIME ZONE $1, 'US'), 4, 3) AS num
  FROM (SELECT clock_timestamp() AS t) c`;

/* Must run inside the transaction that inserts the student, so the lock covers the insert too. */
export async function allocateRegistrationNumber(m: SqlRunner, timezone = env.APP_TIMEZONE): Promise<string> {
  await m.query(`SELECT pg_advisory_xact_lock($1)`, [REGISTRATION_NUMBER_LOCK]);
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const [row] = await m.query(registrationNumberSql, [timezone]);
    const num = String(row?.num ?? '');
    if (!REGISTRATION_NUMBER_RE.test(num)) throw new Error(`Registration number has an unexpected format: "${num}"`);
    const taken = await m.query(`SELECT 1 FROM "students" WHERE "registrationNumber" = $1`, [num]);
    if (!taken.length) return num;
  }
  /* The clock kept giving numbers that are already used (e.g. it stopped). Refuse rather than reuse or invent. */
  throw new AppError(
    HTTP_STATUS.SERVICE_UNAVAILABLE,
    'Could not allocate a registration number right now; please try again',
    ERROR_CODES.SERVICE_UNAVAILABLE,
  );
}
