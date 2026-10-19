import type { Config } from 'jest';

/*
 * Two projects (ADR-0006):
 * - unit: pure logic and services with mocked dependencies; no database, runs in seconds.
 * - db: integration, contract and e2e tests against the isolated PostgreSQL database in .env.test
 *   (NODE_ENV=test). globalSetup resets that database's schema and applies the migrations once per run.
 * Run one with `npm run test:unit` or `npm run test:db`; `npm test` runs both.
 */
const shared = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/tests/helpers/set-env.ts'],
} satisfies Config;

const config: Config = {
  testTimeout: 30_000,
  collectCoverageFrom: ['src/**/*.ts', '!src/server.ts', '!src/database/migrations/**', '!src/**/*.openapi.ts'],
  coverageDirectory: 'coverage',
  projects: [
    { ...shared, displayName: 'unit', roots: ['<rootDir>/tests/unit'], testMatch: ['**/*.test.ts'] },
    {
      ...shared,
      displayName: 'db',
      roots: ['<rootDir>/tests/integration', '<rootDir>/tests/contract', '<rootDir>/tests/e2e'],
      testMatch: ['**/*.test.ts'],
      globalSetup: '<rootDir>/tests/helpers/global-setup.ts',
    },
  ],
};

export default config;
