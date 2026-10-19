/*
 * Central environment configuration. Every variable is read and validated once at startup;
 * the process exits with a readable message if anything is missing or malformed.
 */
import path from 'path';
import dotenv from 'dotenv';
import { z } from 'zod';

const NODE_ENV = process.env.NODE_ENV ?? 'development';

/* .env.test is used for the test run; .env for everything else. Real environments set variables directly. */
dotenv.config({ path: path.resolve(__dirname, '../..', NODE_ENV === 'test' ? '.env.test' : '.env') });

const bool = z
  .enum(['true', 'false'])
  .default('false')
  .transform((v) => v === 'true');

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

  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_EXPIRES_IN: z.string().default('15m'),
  JWT_ISSUER: z.string().default('amrut-admin-backend'),
  JWT_AUDIENCE: z.string().default('amrut-admin-panel'),

  /* Comma-separated list of allowed browser origins. */
  FRONTEND_URL: z.string().default('http://localhost:5174'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(12),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(15 * 60 * 1000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
  LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
  PERMISSION_CACHE_TTL_MS: z.coerce.number().int().min(0).default(60_000),

  /* Student data protection: 32-byte keys, base64. DATA encrypts Aadhaar (AES-256-GCM); INDEX keys the blind index (HMAC-SHA256). */
  STUDENT_DATA_KEY: z.string().refine((v) => Buffer.from(v, 'base64').length === 32, 'STUDENT_DATA_KEY must be 32 bytes, base64-encoded'),
  STUDENT_INDEX_KEY: z.string().refine((v) => Buffer.from(v, 'base64').length === 32, 'STUDENT_INDEX_KEY must be 32 bytes, base64-encoded'),
  IMPORT_MAX_FILE_MB: z.coerce.number().positive().default(20),
  IMPORT_MAX_ROWS: z.coerce.number().int().positive().default(50_000),

  /* Browser sessions: HttpOnly cookie carrying the access token (ADR-0003). */
  SESSION_COOKIE_NAME: z.string().regex(/^[A-Za-z0-9_-]+$/).default('amrut_session'),
  /* Defaults to true outside development and test; must be true when SameSite=none. */
  COOKIE_SECURE: z.enum(['true', 'false']).optional(),
  COOKIE_SAMESITE: z.enum(['strict', 'lax', 'none']).default('strict'),
  /* e.g. .sumago.ai when the admin panel and the API are on different subdomains; unset = host-only cookie. */
  COOKIE_DOMAIN: z.string().optional(),
  /* Absolute session lifetime; the access token is renewed while the user is active, up to this limit. */
  SESSION_MAX_HOURS: z.coerce.number().positive().default(12),

  /* Serve OpenAPI JSON and Swagger UI (default: on, except in production). */
  API_DOCS_ENABLED: z.enum(['true', 'false']).optional(),
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
  corsOrigins: raw.FRONTEND_URL.split(',').map((o) => o.trim()).filter(Boolean),
} as const;

export type Env = typeof env;
