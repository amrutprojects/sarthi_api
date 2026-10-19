import 'reflect-metadata';
import { AppDataSource } from '../src/config/database.config';
import { seedContactPage } from './seed-contact-page';
import { seedRbac } from './seed-rbac';

/* npm run seed — idempotent. Requires migrations to be applied. */
async function main() {
  await AppDataSource.initialize();
  try {
    if (await AppDataSource.showMigrations()) throw new Error('Pending migrations: run `npm run migration:run` first');
    const summary = await seedRbac(AppDataSource);
    // eslint-disable-next-line no-console
    console.log('RBAC seed complete:', summary);

    /* First run only: writes the Contact page content and never touches it again (see the file). */
    const contact = await seedContactPage(AppDataSource);
    // eslint-disable-next-line no-console
    console.log('Contact page seed:', contact.created ? contact : 'already configured — left untouched');
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Seed failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
