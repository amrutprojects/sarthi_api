import fs from 'fs';
import path from 'path';
import readline from 'readline';

/*
 * Local development helper: npm run set-db-password
 * Prompts (hidden input) for the PostgreSQL password and writes it to DB_PASSWORD in .env and
 * .env.test. The password is never printed or logged. Both files are git-ignored.
 */
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
  const password = await promptHidden('PostgreSQL password for DB_USERNAME in .env: ');
  if (!password) throw new Error('No password entered');
  if (/[\r\n]/.test(password)) throw new Error('Password cannot contain line breaks');
  for (const file of ['.env', '.env.test']) {
    const full = path.resolve(__dirname, '..', file);
    if (!fs.existsSync(full)) {
      // eslint-disable-next-line no-console
      console.log(`${file}: not found, skipped`);
      continue;
    }
    const text = fs.readFileSync(full, 'utf8');
    const next = /^DB_PASSWORD=.*$/m.test(text) ? text.replace(/^DB_PASSWORD=.*$/m, () => `DB_PASSWORD=${password}`) : `${text}\nDB_PASSWORD=${password}\n`;
    fs.writeFileSync(full, next);
    // eslint-disable-next-line no-console
    console.log(`${file}: DB_PASSWORD updated`);
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('set-db-password failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
