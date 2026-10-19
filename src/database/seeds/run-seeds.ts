import 'reflect-metadata';
import { AppDataSource } from '../../config/database.config';
import { seedRbac } from './seed-rbac';

/* npm run seed — idempotent. Requires migrations to be applied. */
async function main() {
  await AppDataSource.initialize();
  try {
    if (await AppDataSource.showMigrations()) throw new Error('Pending migrations: run `npm run migration:run` first');
    const summary = await seedRbac(AppDataSource);
    // eslint-disable-next-line no-console
    console.log('RBAC seed complete:', summary);
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Seed failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
