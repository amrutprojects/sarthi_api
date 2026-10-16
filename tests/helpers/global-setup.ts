import 'reflect-metadata';
import { assertTestDatabase } from './guard';

/*
 * Once per test run: rebuild the isolated test database schema from the migrations, so every run
 * starts from exactly what production migrations produce.
 */
export default async function globalSetup(): Promise<void> {
  process.env.NODE_ENV = 'test';
  const { env } = await import('../../src/config/env.config');
  assertTestDatabase(env.DB_DATABASE);

  const { AppDataSource } = await import('../../src/config/database.config');
  await AppDataSource.initialize();
  try {
    await AppDataSource.query('DROP SCHEMA IF EXISTS public CASCADE');
    await AppDataSource.query('CREATE SCHEMA public');
    await AppDataSource.runMigrations({ transaction: 'each' });
  } finally {
    await AppDataSource.destroy();
  }
}
