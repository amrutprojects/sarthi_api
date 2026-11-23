import 'reflect-metadata';
import { AppDataSource } from '../../config/database.config';
import { seedContactDirectory } from './seed-contact-directory';
import { seedContactPage } from './seed-contact-page';
import { seedContactTrainingCentres } from './seed-contact-training-centres';
import { seedFooter } from './seed-footer';
import { seedMasters } from './seed-masters';
import { seedModulesPage } from './seed-modules-page';
import { seedProgrammeHighlight } from './seed-programme-highlight';
import { seedProgrammePage } from './seed-programme-page';
import { seedRbac } from './seed-rbac';
import { seedHomeHero } from './seed-home-hero';
import { seedBoardMembers } from './seed-board-members';
import { seedAdvisoryCommittee } from './seed-advisory-committee';
import { seedEcosystem } from './seed-ecosystem';
import { seedAmrutSchemes } from './seed-amrut-schemes';
import { seedAboutAmrut } from './seed-about-amrut';
import { seedAmrutImpact } from './seed-amrut-impact';
import { seedAnnouncements } from './seed-announcements';
import { seedTopBar } from './seed-top-bar';
import { seedBrandBar } from './seed-brand-bar';
import { seedEdpAdmin } from './seed-edp';
import { env } from '../../config/env.config';
import { demoContentSkipped, seedOptionsFor } from './seed-profile';

/* npm run seed — idempotent. Requires migrations to be applied. */
async function main() {
  await AppDataSource.initialize();
  try {
    if (await AppDataSource.showMigrations()) throw new Error('Pending migrations: run `npm run migration:run` first');
    /* Demo-dataset content only on a local install (NODE_ENV development / test): see seed-profile.ts. */
    const options = seedOptionsFor(env.NODE_ENV);
    const skipped = demoContentSkipped(options);
    if (skipped.length) {
      // eslint-disable-next-line no-console
      console.log(`NODE_ENV=${env.NODE_ENV}: not a local install, demo content skipped:`, skipped);
    }
    const summary = await seedRbac(AppDataSource);
    // eslint-disable-next-line no-console
    console.log('RBAC seed complete:', summary);
    // eslint-disable-next-line no-console
    console.log('Masters seed complete (rows added):', await seedMasters(AppDataSource));
    /* The CMS page content. Each is idempotent and does nothing once configured. */
    // eslint-disable-next-line no-console
    console.log('Contact page seed complete:', await seedContactPage(AppDataSource, options));
    // eslint-disable-next-line no-console
    console.log('Contact coordinators & district offices seed complete:', await seedContactDirectory(AppDataSource, options));
    // eslint-disable-next-line no-console
    console.log('Contact training centres seed complete:', await seedContactTrainingCentres(AppDataSource, options));
    // eslint-disable-next-line no-console
    console.log('Footer seed complete:', await seedFooter(AppDataSource));
    // eslint-disable-next-line no-console
    console.log('Modules page seed complete:', await seedModulesPage(AppDataSource));
    // eslint-disable-next-line no-console
    console.log('Programme section seed complete:', await seedProgrammeHighlight(AppDataSource));
    // eslint-disable-next-line no-console
    console.log('Programme page seed complete:', await seedProgrammePage(AppDataSource));
    // eslint-disable-next-line no-console
    console.log('Home hero seed complete:', await seedHomeHero(AppDataSource));
    // eslint-disable-next-line no-console
    console.log('Board members seed complete:', await seedBoardMembers(AppDataSource));
    // eslint-disable-next-line no-console
    console.log('Advisory Committee seed complete:', await seedAdvisoryCommittee(AppDataSource));
    // eslint-disable-next-line no-console
    console.log('AMRUT Ecosystem seed complete:', await seedEcosystem(AppDataSource));
    // eslint-disable-next-line no-console
    console.log('AMRUT Schemes seed complete:', await seedAmrutSchemes(AppDataSource));
    // eslint-disable-next-line no-console
    console.log('About AMRUT seed complete:', await seedAboutAmrut(AppDataSource));
    // eslint-disable-next-line no-console
    console.log("AMRUT's Impact seed complete:", await seedAmrutImpact(AppDataSource, options));
    // eslint-disable-next-line no-console
    console.log('Announcements seed complete:', await seedAnnouncements(AppDataSource));
    // eslint-disable-next-line no-console
    console.log('Top Bar seed complete:', await seedTopBar(AppDataSource));
    // eslint-disable-next-line no-console
    console.log('Brand Bar seed complete:', await seedBrandBar(AppDataSource));
    // eslint-disable-next-line no-console
    console.log('EDP tracking panel admin seed complete:', await seedEdpAdmin(AppDataSource));
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Seed failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
