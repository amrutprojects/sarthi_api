/*
 * Unit tests run without a database or a .env.test file (e.g. on a fresh CI machine). Provide fixed,
 * test-only values for the required variables before any application module reads the environment.
 * dotenv never overrides variables that are already set, so a local .env.test cannot leak in here.
 * These values are not secrets and must never be used outside tests.
 */
const defaults: Record<string, string> = {
  NODE_ENV: 'test',
  DB_HOST: 'localhost',
  DB_USERNAME: 'unit',
  DB_PASSWORD: 'unit',
  DB_DATABASE: 'unit_test_no_connection',
  JWT_SECRET: 'unit-test-jwt-secret-0123456789-abcdefghijklmnop',
  STUDENT_DATA_KEY: Buffer.alloc(32, 1).toString('base64'),
  STUDENT_INDEX_KEY: Buffer.alloc(32, 2).toString('base64'),
  BCRYPT_ROUNDS: '4',
  LOG_LEVEL: 'silent',
};
for (const [k, v] of Object.entries(defaults)) process.env[k] = v;
