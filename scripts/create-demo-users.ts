import 'reflect-metadata';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { appConfig } from '../src/config/app.config';
import { AppDataSource } from '../src/config/database.config';
import { env } from '../src/config/env.config';
import { ROLES } from '../src/modules/roles-permissions/role.constants';
import { Role } from '../src/modules/roles-permissions/roles/role.entity';
import { UserRole } from '../src/modules/roles-permissions/user-role.entity';
import { User } from '../src/modules/users/user.entity';

/*
 * DEVELOPMENT ONLY: one demo account per seeded role (demo.<role>@kalash.local), for trying the
 * admin panel's role-based menus. Refuses to run in production. The password comes from
 * DEMO_USER_PASSWORD or is generated; credentials are written to .demo-credentials (git-ignored),
 * never printed. Existing demo accounts are left as they are. Run `npm run seed` first.
 */
const OUT = path.resolve(__dirname, '..', '.demo-credentials');

/* The named accounts from the admin panel's former mock data (legacy/data.js), with their real roles. */
const NAMED_USERS: { name: string; email: string; role: string; active?: boolean }[] = [
  { name: 'System Administrator', email: 'admin@amrut-sumago.demo', role: 'SUPER_ADMIN' },
  { name: 'Rajendra Sumago', email: 'director@sumago.demo', role: 'PROJECT_DIRECTOR' },
  { name: 'AMRUT Programme Officer', email: 'officer@amrut.demo', role: 'AMRUT_ADMIN' },
  { name: 'Nitin Rane', email: 'pm@sumago.demo', role: 'PMO' },
  { name: 'Priya Shinde', email: 'dc.marathwada@sumago.demo', role: 'DISTRICT_COORD' },
  { name: 'Sunil Pawar', email: 'pun.centre@amrut-sumago.demo', role: 'CENTRE_MANAGER' },
  { name: 'Mahesh Kulkarni', email: 'kulkarni.trainer@sumago.demo', role: 'TRAINER' },
  { name: 'Dr. Shweta Kulkarni', email: 'online.training@sumago.demo', role: 'ONLINE_MANAGER' },
  { name: 'Sagar Deshpande', email: 'mis@sumago.demo', role: 'MIS_MANAGER' },
  { name: 'Meera Patil', email: 'qa@sumago.demo', role: 'QA_MANAGER' },
  { name: 'Rupali Kadam', email: 'finance@sumago.demo', role: 'FINANCE_USER' },
  { name: 'Kiran Salunkhe', email: 'marketing@sumago.demo', role: 'MARKETING_USER' },
  { name: 'Helpdesk Team', email: 'helpdesk@sumago.demo', role: 'HELPDESK' },
  { name: 'Audit Viewer', email: 'viewer@amrut.demo', role: 'VIEWER', active: false },
];

/* Keep one shared password across runs: reuse the one already recorded in .demo-credentials. */
function existingPassword(): string | undefined {
  if (!fs.existsSync(OUT)) return undefined;
  return fs.readFileSync(OUT, 'utf8').split(/\r?\n/)[1]?.replace(/^# /, '').trim() || undefined;
}

function generatePassword(): string {
  return 'Dm' + crypto.randomBytes(9).toString('base64url') + '7a';
}

async function main() {
  if (env.NODE_ENV === 'production') throw new Error('demo:users is disabled in production');
  const password = process.env.DEMO_USER_PASSWORD ?? existingPassword() ?? generatePassword();
  const passwordHash = await bcrypt.hash(password, appConfig.bcryptRounds);

  await AppDataSource.initialize();
  const lines: string[] = [];
  let created = 0;
  try {
    await AppDataSource.transaction(async (m) => {
      const accounts = [
        ...ROLES.map((def) => ({ name: `Demo ${def.name}`, email: `demo.${def.code.toLowerCase().replace(/_/g, '-')}@kalash.local`, role: def.code, active: true })),
        ...NAMED_USERS,
      ];
      for (const acc of accounts) {
        const role = await m.getRepository(Role).findOne({ where: { code: acc.role, isDelete: false } });
        if (!role) throw new Error(`Role ${acc.role} not found: run \`npm run seed\` first`);
        const email = acc.email;
        lines.push(`${acc.role.padEnd(24)} ${email}${acc.active === false ? '  (inactive)' : ''}`);
        if (await m.getRepository(User).exists({ where: { email, isDelete: false } })) continue;
        const user = await m.getRepository(User).save(m.getRepository(User).create({ name: acc.name, email, passwordHash, isActive: acc.active !== false }));
        await m.getRepository(UserRole).insert({ userId: user.id, roleId: role.id });
        created++;
      }
    });
  } finally {
    await AppDataSource.destroy();
  }
  if (created) {
    fs.writeFileSync(OUT, `# Demo accounts (development only). Password for accounts created on ${new Date().toISOString()}:\n# ${password}\n\n${lines.join('\n')}\n`, { mode: 0o600 });
  }
  // eslint-disable-next-line no-console
  console.log(`Demo users: ${created} created, ${lines.length - created} already existed.${created ? ` Credentials written to ${OUT}` : ''}`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('demo:users failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
