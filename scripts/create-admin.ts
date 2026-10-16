import 'reflect-metadata';
import bcrypt from 'bcrypt';
import readline from 'readline';
import { appConfig } from '../src/config/app.config';
import { AppDataSource } from '../src/config/database.config';
import { ROLE_CODES } from '../src/constants/role.constants';
import { AuditLog } from '../src/entities/audit-log.entity';
import { Role } from '../src/entities/role.entity';
import { UserRole } from '../src/entities/user-role.entity';
import { User } from '../src/entities/user.entity';
import { email as emailSchema, name as nameSchema, password as passwordSchema } from '../src/validators/common.validator';

/*
 * Secure initial administrator setup:
 *   npm run admin:create -- --email admin@example.org --name "System Administrator"
 * The password is never a command-line argument (it would land in shell history). It is read from
 * ADMIN_INITIAL_PASSWORD if set (for automated provisioning), otherwise typed at a hidden prompt.
 * The account gets the SUPER_ADMIN role. Run `npm run seed` first.
 */

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

function promptHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const out = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WriteStream };
    out._writeToOutput = (s: string) => out.output.write(s.includes(question) ? s : '*');
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

async function main() {
  const email = emailSchema.parse(arg('email'));
  const name = nameSchema.parse(arg('name') ?? 'System Administrator');

  let password = process.env.ADMIN_INITIAL_PASSWORD;
  if (!password) {
    password = await promptHidden('Password for the new administrator: ');
    const again = await promptHidden('Repeat password: ');
    if (password !== again) throw new Error('Passwords do not match');
  }
  const check = passwordSchema.safeParse(password);
  if (!check.success) throw new Error(check.error.issues.map((i) => i.message).join('; '));

  await AppDataSource.initialize();
  try {
    await AppDataSource.transaction(async (m) => {
      const role = await m.getRepository(Role).findOne({ where: { code: ROLE_CODES.SUPER_ADMIN, isDelete: false } });
      if (!role) throw new Error('SUPER_ADMIN role not found: run `npm run seed` first');
      if (await m.getRepository(User).exists({ where: { email, isDelete: false } })) {
        throw new Error(`A user with email ${email} already exists`);
      }
      const passwordHash = await bcrypt.hash(password!, appConfig.bcryptRounds);
      const user = await m.getRepository(User).save(m.getRepository(User).create({ name, email, passwordHash }));
      await m.getRepository(UserRole).insert({ userId: user.id, roleId: role.id });
      await m.getRepository(AuditLog).save(m.getRepository(AuditLog).create({
        action: 'user.create', resource: 'user', resourceId: user.id, outcome: 'SUCCESS',
        details: { email, via: 'admin:create script', roles: [ROLE_CODES.SUPER_ADMIN] },
      }));
      // eslint-disable-next-line no-console
      console.log(`Administrator created: ${email} (id ${user.id}) with role ${ROLE_CODES.SUPER_ADMIN}`);
    });
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('admin:create failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
