import 'reflect-metadata';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { appConfig } from '../src/config/app.config';
import { AppDataSource } from '../src/config/database.config';
import { env } from '../src/config/env.config';

/*
 * DEVELOPMENT ONLY: a sign-in for the EDP tracking panel (edp.sumago.ai/manage, locally http://localhost:5175/manage).
 * Email from EDP_ADMIN_EMAIL (default edp.admin@sumago.local); password from EDP_ADMIN_PASSWORD or generated. The
 * credentials are written to .edp-admin-credentials (git-ignored), never printed. An existing admin is left as it is.
 * Production: set EDP_ADMIN_EMAIL / EDP_ADMIN_PASSWORD and run `npm run seed` instead.
 */
const OUT = path.resolve(__dirname, '..', '.edp-admin-credentials');

async function main() {
  if (env.NODE_ENV === 'production') throw new Error('edp:admin is disabled in production; use EDP_ADMIN_* with `npm run seed`');
  const email = (env.EDP_ADMIN_EMAIL ?? 'edp.admin@sumago.local').toLowerCase();
  await AppDataSource.initialize();
  try {
    const exists = await AppDataSource.query(`SELECT 1 FROM "edp_admins" WHERE "email" = $1 AND "isDelete" = false`, [email]);
    if (exists.length) {
      // eslint-disable-next-line no-console
      console.log(`EDP admin ${email} already exists; nothing changed (see ${path.basename(OUT)} if it was created here).`);
      return;
    }
    const password = env.EDP_ADMIN_PASSWORD ?? 'Edp' + crypto.randomBytes(9).toString('base64url') + '7a';
    await AppDataSource.query(`INSERT INTO "edp_admins" ("name", "email", "passwordHash") VALUES ('EDP Administrator', $1, $2)`, [
      email,
      await bcrypt.hash(password, appConfig.bcryptRounds),
    ]);
    fs.writeFileSync(OUT, `# EDP tracking panel sign-in (development). Do not commit.\n${email}\n${password}\n`, { mode: 0o600 });
    // eslint-disable-next-line no-console
    console.log(`EDP admin ${email} created; credentials written to ${path.basename(OUT)} (git-ignored).`);
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('edp:admin failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
