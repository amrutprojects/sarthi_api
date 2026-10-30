/*
 * Central environment configuration. Every variable is read and validated once at startup;
 * the process exits with a readable message if anything is missing or malformed.
 */
import path from 'path';
import dotenv from 'dotenv';
import { z } from 'zod';

const NODE_ENV = process.env.NODE_ENV ?? 'development';

/*
 * The backend folder, whether this file runs from src/config (ts-node) or from the build in dist/src/config
 * (production commands). .env.test is used for the test run; .env for everything else.
 */
export const backendRoot = path.resolve(__dirname, '../..', path.basename(path.resolve(__dirname, '../..')) === 'dist' ? '..' : '');
dotenv.config({ path: path.join(backendRoot, NODE_ENV === 'test' ? '.env.test' : '.env') });

const bool = z
  .enum(['true', 'false'])
  .default('false')
  .transform((v) => v === 'true');

/* An empty value (e.g. `SMTP_HOST=` in .env) counts as not set. */
const blankAsUnset = <T extends z.ZodTypeAny>(s: T) => z.preprocess((v) => (v === '' ? undefined : v), s);

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(5000),

  DB_HOST: z.string().min(1),
  DB_PORT: z.coerce.number().int().positive().default(5432),
  DB_USERNAME: z.string().min(1),
  DB_PASSWORD: z.string().min(1),
  DB_DATABASE: z.string().min(1),
  DB_SSL: bool,
  DB_POOL_MAX: z.coerce.number().int().positive().default(10),
  DB_LOGGING: bool,
  /* Timezone of student registration numbers (MMDDHHmmssSSSfff). Must be an IANA name, e.g. Asia/Kolkata. */
  APP_TIMEZONE: z
    .string()
    .default('Asia/Kolkata')
    .refine((tz) => {
      try {
        new Intl.DateTimeFormat('en', { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    }, 'APP_TIMEZONE must be an IANA timezone such as Asia/Kolkata'),
  /*
   * Optional read replica (a streaming copy of the main database). When DB_READ_HOST is set, plain reads go to the
   * replica and every write, transaction and migration goes to the main database. Unset = one database for everything.
   * Port, user and password default to the main database's.
   */
  DB_READ_HOST: z.string().optional(),
  DB_READ_PORT: z.coerce.number().int().positive().optional(),
  DB_READ_USERNAME: z.string().optional(),
  DB_READ_PASSWORD: z.string().optional(),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_EXPIRES_IN: z.string().default('15m'),
  JWT_ISSUER: z.string().default('amrut-admin-backend'),
  JWT_AUDIENCE: z.string().default('amrut-admin-panel'),

  /* Comma-separated list of allowed browser origins. */
  FRONTEND_URL: z.string().default('http://localhost:5174'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(12),
  RATE_LIMIT_WINDOW_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(15 * 60 * 1000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
  LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
  /* Public student registrations per IP per rate-limit window. */
  REGISTRATION_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
  PERMISSION_CACHE_TTL_MS: z.coerce.number().int().min(0).default(60_000),

  /* Student data protection: 32-byte keys, base64. DATA encrypts Aadhaar (AES-256-GCM); INDEX keys the blind index (HMAC-SHA256). */
  STUDENT_DATA_KEY: z.string().refine((v) => Buffer.from(v, 'base64').length === 32, 'STUDENT_DATA_KEY must be 32 bytes, base64-encoded'),
  STUDENT_INDEX_KEY: z.string().refine((v) => Buffer.from(v, 'base64').length === 32, 'STUDENT_INDEX_KEY must be 32 bytes, base64-encoded'),
  IMPORT_MAX_FILE_MB: z.coerce.number().positive().default(20),
  IMPORT_MAX_ROWS: z.coerce.number().int().positive().default(50_000),

  /* Student document files (private storage, never served statically). Relative paths are resolved from the backend folder. */
  STORAGE_DIR: z.string().min(1).default('storage'),
  /* 'local' (STORAGE_DIR on disk) or 's3' (private bucket; keys are the same relative paths). */
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  AWS_REGION: z.string().optional(),
  AWS_BUCKET_NAME: z.string().optional(),
  /* Optional: without them the SDK uses its default chain (instance role, AWS profile). */
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  /* Optional folder inside the bucket, e.g. "dev" or "prod". */
  AWS_KEY_PREFIX: z.string().default(''),
  /* Size cap of one uploaded document (student documents and Document Master uploads alike). */
  DOCUMENT_MAX_FILE_MB: z.coerce.number().positive().max(50).default(5),
  DOCUMENTS_ZIP_MAX_MB: z.coerce.number().positive().default(500),
  DOCUMENTS_ZIP_MAX_FILES: z.coerce.number().int().positive().default(20_000),

  /* Document Master uploads: private directory outside the web root (relative to the working directory). */
  DOCUMENT_STORAGE_DIR: z.string().min(1).default('storage/documents'),

  /*
   * LMS branding logo (F-LMS-04-02: "size and dimension limits from configuration"; the spec gives no value):
   * maximum width / height in pixels, each optional. Unset (or blank) = no limit on that side.
   */
  LMS_LOGO_MAX_WIDTH_PX: z.preprocess((v) => (v === '' ? undefined : v), z.coerce.number().int().positive().optional()),
  LMS_LOGO_MAX_HEIGHT_PX: z.preprocess((v) => (v === '' ? undefined : v), z.coerce.number().int().positive().optional()),

  /* Browser sessions: HttpOnly cookie carrying the access token (ADR-0003). */
  SESSION_COOKIE_NAME: z
    .string()
    .regex(/^[A-Za-z0-9_-]+$/)
    .default('amrut_session'),
  /* Defaults to true outside development and test; must be true when SameSite=none. */
  COOKIE_SECURE: z.enum(['true', 'false']).optional(),
  COOKIE_SAMESITE: z.enum(['strict', 'lax', 'none']).default('strict'),
  /* e.g. .sumago.ai when the admin panel and the API are on different subdomains; unset = host-only cookie. */
  COOKIE_DOMAIN: z.string().optional(),
  /* Absolute session lifetime; the access token is renewed while the user is active, up to this limit. */
  SESSION_MAX_HOURS: z.coerce.number().positive().default(12),

  /* Serve OpenAPI JSON and Swagger UI (default: on, except in production). */
  API_DOCS_ENABLED: z.enum(['true', 'false']).optional(),

  /*
   * Shared secret the LMS signs its /integration/v1/lms calls with (HMAC-SHA256). Unset = the LMS cannot sign in
   * Admin Panel users. The LMS holds the same value.
   */
  LMS_INTEGRATION_SECRET: z.string().min(32, 'LMS_INTEGRATION_SECRET must be at least 32 characters').optional(),

  /*
   * EDP portal (edp.sumago.ai). EDP_JWT_SECRET signs the portal's and its tracking panel's tokens; unset = a key derived
   * from JWT_SECRET. Either way it differs from JWT_SECRET, so portal tokens are never accepted by the admin API.
   */
  EDP_JWT_SECRET: blankAsUnset(z.string().min(32, 'EDP_JWT_SECRET must be at least 32 characters').optional()),
  EDP_SESSION_HOURS: z.coerce.number().positive().default(12),
  /* Lifetime of an emailed one-time code (default 5 minutes). */
  EDP_OTP_TTL_SECONDS: z.coerce.number().int().min(10).max(1800).default(300),
  /*
   * Wait before a new code can be requested (it replaces the previous one). Unset = the code's lifetime, so a new code is
   * offered only once the current one has expired; never longer than the lifetime.
   */
  EDP_OTP_RESEND_SECONDS: blankAsUnset(z.coerce.number().int().min(10).max(1800).optional()),
  /* Portal sign-up, code and sign-in requests per IP per rate-limit window. */
  EDP_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(30),
  /* SMTP for the one-time codes (e.g. smtp.gmail.com, 465, SMTP_SECURE=true, an app password). Unset host = no email. */
  SMTP_HOST: blankAsUnset(z.string().optional()),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_SECURE: bool,
  SMTP_USER: blankAsUnset(z.string().optional()),
  SMTP_PASS: blankAsUnset(z.string().optional()),
  /* Sender, e.g. "EDP – Sumago Infotech <no-reply@sumago.ai>". Defaults to SMTP_USER. */
  SMTP_FROM: blankAsUnset(z.string().optional()),
  /*
   * SMS gateway for the sign-up one-time codes (HappySMS-style HTTP API: GET SMS_API_URL?authkey=&mobiles=&message=&sender=
   * &route=&country=&DLT_TE_ID=). SMS_DLT_TEMPLATE_ID is the TRAI/DLT-registered template; SMS_OTP_MESSAGE must be that
   * template's text with {otp} and {minutes} where its variables are, or the operator drops the SMS. Unset auth key =
   * no SMS (development logs the code instead; any other environment refuses).
   */
  SMS_API_URL: blankAsUnset(z.string().trim().url('SMS_API_URL must be a URL').optional()),
  SMS_AUTH_KEY: blankAsUnset(z.string().trim().optional()),
  SMS_SENDER: blankAsUnset(z.string().trim().regex(/^[A-Za-z0-9]{3,11}$/, 'SMS_SENDER must be 3-11 letters or digits').optional()),
  SMS_DLT_TEMPLATE_ID: blankAsUnset(z.string().trim().regex(/^\d{10,25}$/, 'SMS_DLT_TEMPLATE_ID must be digits').optional()),
  SMS_ROUTE: blankAsUnset(z.string().trim().max(10).optional()),
  SMS_COUNTRY: blankAsUnset(z.string().trim().regex(/^\d{1,4}$/, 'SMS_COUNTRY must be a dialling code, e.g. 91').optional()),
  SMS_OTP_MESSAGE: blankAsUnset(
    z
      .string()
      .trim()
      .max(480)
      .refine((v) => v.includes('{otp}'), 'SMS_OTP_MESSAGE must contain {otp}')
      .optional(),
  ),
  /* The tracking panel's sign-in, created by `npm run seed` when both are set (never overwritten afterwards). */
  EDP_ADMIN_EMAIL: blankAsUnset(z.string().email('EDP_ADMIN_EMAIL must be an email address').optional()),
  EDP_ADMIN_PASSWORD: blankAsUnset(z.string().min(10, 'EDP_ADMIN_PASSWORD must be at least 10 characters').optional()),
  /*
   * Contact shown to a student after submitting, for queries about the registration. Read when the API starts: change
   * them and restart the API. Unset = "contact the programme office" without details.
   */
  /*
   * The portal's address, for the links in its emails (password reset). Never taken from a request's Host header.
   * Unset = https://edp.sumago.ai in production, http://localhost:5175 otherwise.
   */
  EDP_PORTAL_URL: blankAsUnset(z.string().trim().url('EDP_PORTAL_URL must be a URL, e.g. https://edp.sumago.ai').optional()),
  EDP_SUPPORT_EMAIL: blankAsUnset(z.string().trim().email('EDP_SUPPORT_EMAIL must be an email address').optional()),
  EDP_SUPPORT_MOBILE: blankAsUnset(
    z
      .string()
      .trim()
      .regex(/^\+?\d[\d ()-]{5,18}\d$/, 'EDP_SUPPORT_MOBILE must be a phone number, e.g. +91 80103 85237')
      .optional(),
  ),
});

/*
 * Also accept the common PG_* names (PG_HOST, PG_PORT, PG_USER, PG_PASSWORD, PG_DB / PG_DATABASE).
 * DB_* wins when both are set.
 */
const PG_ALIASES: Record<string, string[]> = {
  DB_HOST: ['PG_HOST', 'PGHOST'],
  DB_PORT: ['PG_PORT', 'PGPORT'],
  DB_USERNAME: ['PG_USER', 'PG_USERNAME', 'PGUSER'],
  DB_PASSWORD: ['PG_PASSWORD', 'PGPASSWORD'],
  DB_DATABASE: ['PG_DB', 'PG_DATABASE', 'PGDATABASE'],
};
const source: Record<string, string | undefined> = { ...process.env };
for (const [key, aliases] of Object.entries(PG_ALIASES)) {
  if (!source[key]) source[key] = aliases.map((a) => process.env[a]).find((v) => v);
}

const parsed = schema.safeParse(source);

if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  // eslint-disable-next-line no-console
  console.error(`Invalid environment configuration:\n${issues}`);
  process.exit(1);
}

const raw = parsed.data;

if (raw.STORAGE_DRIVER === 's3' && (!raw.AWS_REGION || !raw.AWS_BUCKET_NAME)) {
  // eslint-disable-next-line no-console
  console.error('Invalid environment configuration:\n  - STORAGE_DRIVER=s3 needs AWS_REGION and AWS_BUCKET_NAME');
  process.exit(1);
}

if (raw.NODE_ENV === 'production' && /CHANGE_ME|REPLACE_WITH/i.test(raw.JWT_SECRET + raw.DB_PASSWORD)) {
  // eslint-disable-next-line no-console
  console.error('Refusing to start in production with placeholder secrets from .env.example');
  process.exit(1);
}

if (raw.COOKIE_SAMESITE === 'none' && raw.COOKIE_SECURE === 'false') {
  // eslint-disable-next-line no-console
  console.error('COOKIE_SAMESITE=none requires COOKIE_SECURE=true (browsers reject insecure SameSite=None cookies)');
  process.exit(1);
}

export const env = {
  ...raw,
  isProduction: raw.NODE_ENV === 'production',
  isTest: raw.NODE_ENV === 'test',
  corsOrigins: raw.FRONTEND_URL.split(',')
    .map((o) => o.trim())
    .filter(Boolean),
} as const;

export type Env = typeof env;
