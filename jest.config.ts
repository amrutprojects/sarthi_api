import type { Config } from 'jest';

/*
 * Tests run against an isolated PostgreSQL database configured in .env.test (NODE_ENV=test).
 * globalSetup resets that database's schema and applies the migrations once per run.
 */
const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  globalSetup: '<rootDir>/tests/helpers/global-setup.ts',
  setupFiles: ['<rootDir>/tests/helpers/set-env.ts'],
  testTimeout: 30_000,
  collectCoverageFrom: ['src/**/*.ts', '!src/server.ts', '!src/types/**'],
  coverageDirectory: 'coverage',
};

export default config;
