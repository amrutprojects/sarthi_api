import path from 'path';
import dotenv from 'dotenv';
import { Client } from 'pg';

/*
 * npm run db:create — creates the development database (from .env) and the isolated test database
 * (from .env.test) if they do not exist. Never drops or alters an existing database.
 * Connects to the server's maintenance database `postgres` with the same credentials.
 */

interface DbTarget { file: string; host: string; port: number; user: string; password: string; database: string; ssl: boolean }

function readTarget(file: string): DbTarget | null {
  const parsed = dotenv.config({ path: path.resolve(__dirname, '..', file), processEnv: {} }).parsed;
  if (!parsed?.DB_DATABASE) return null;
  return {
    file,
    host: parsed.DB_HOST ?? 'localhost',
    port: Number(parsed.DB_PORT ?? 5432),
    user: parsed.DB_USERNAME ?? 'postgres',
    password: parsed.DB_PASSWORD ?? '',
    database: parsed.DB_DATABASE,
    ssl: parsed.DB_SSL === 'true',
  };
}

const IDENT = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;

async function ensure(t: DbTarget) {
  if (!IDENT.test(t.database)) throw new Error(`${t.file}: DB_DATABASE "${t.database}" is not a plain identifier`);
  const client = new Client({ host: t.host, port: t.port, user: t.user, password: t.password, database: 'postgres', ssl: t.ssl });
  await client.connect();
  try {
    const { rowCount } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [t.database]);
    if (rowCount) {
      // eslint-disable-next-line no-console
      console.log(`${t.file}: database "${t.database}" already exists`);
    } else {
      await client.query(`CREATE DATABASE "${t.database}" ENCODING 'UTF8'`);
      // eslint-disable-next-line no-console
      console.log(`${t.file}: created database "${t.database}"`);
    }
  } finally {
    await client.end();
  }
}

async function main() {
  const targets = ['.env', '.env.test'].map(readTarget).filter((t): t is DbTarget => !!t);
  if (!targets.length) throw new Error('No .env or .env.test with DB_DATABASE found (copy .env.example first)');
  const names = targets.map((t) => t.database);
  if (new Set(names).size !== names.length) throw new Error('.env and .env.test must point to different databases');
  for (const t of targets) await ensure(t);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('db:create failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
