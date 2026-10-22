import 'reflect-metadata';
import { AppDataSource } from '../../config/database.config';
import { seedContactDirectory } from './seed-contact-directory';
import { seedContactPage } from './seed-contact-page';
import { seedFooter } from './seed-footer';
import { seedMasters } from './seed-masters';
import { seedModulesPage } from './seed-modules-page';
import { seedProgrammeHighlight } from './seed-programme-highlight';
import { seedProgrammePage } from './seed-programme-page';
import { seedRbac } from './seed-rbac';

/* npm run seed — idempotent. Requires migrations to be applied. */
async function main() {
  await AppDataSource.initialize();
  try {
    if (await AppDataSource.showMigrations()) throw new Error('Pending migrations: run `npm run migration:run` first');
    const summary = await seedRbac(AppDataSource);
    // eslint-disable-next-line no-console
    console.log('RBAC seed complete:', summary);
    // eslint-disable-next-line no-console
    console.log('Masters seed complete (rows added):', await seedMasters(AppDataSource));
    /* The CMS page content. Each is idempotent and does nothing once configured. */
    // eslint-disable-next-line no-console
    console.log('Contact page seed complete:', await seedContactPage(AppDataSource));
    // eslint-disable-next-line no-console
    console.log('Contact coordinators & district offices seed complete:', await seedContactDirectory(AppDataSource));
    // eslint-disable-next-line no-console
    console.log('Footer seed complete:', await seedFooter(AppDataSource));
    // eslint-disable-next-line no-console
    console.log('Modules page seed complete:', await seedModulesPage(AppDataSource));
    // eslint-disable-next-line no-console
    console.log('Programme section seed complete:', await seedProgrammeHighlight(AppDataSource));
    // eslint-disable-next-line no-console
    console.log('Programme page seed complete:', await seedProgrammePage(AppDataSource));
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Seed failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
