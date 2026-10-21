import 'reflect-metadata';
import { DataSource, type DataSourceOptions } from 'typeorm';
import { env } from './env.config';
import { ENTITIES } from '../database/entities';
import { MIGRATIONS } from '../database/migrations';

/*
 * PostgreSQL connection (TypeORM + pg).
 * - Entities and migrations are registered explicitly.
 * - synchronize is always false: the schema is owned by migrations, in every environment.
 * - Each pooled connection is put in UTC so TIMESTAMPTZ values round-trip in UTC.
 */
const primary = {
  host: env.DB_HOST,
  port: env.DB_PORT,
  username: env.DB_USERNAME,
  password: env.DB_PASSWORD,
  database: env.DB_DATABASE,
};

/*
 * Read replica (optional, DB_READ_HOST). TypeORM then sends SELECTs made outside a transaction (find, query builder
 * reads) to the replica, and everything else (saves, updates, transactions, raw queries, migrations) to the primary.
 * The primary should run with synchronous_commit = remote_apply so a read right after a write sees it (see
 * docs/database/read-replica.md).
 */
export const readReplicaEnabled = !!env.DB_READ_HOST;
const connection = readReplicaEnabled
  ? {
      replication: {
        master: primary,
        slaves: [
          {
            host: env.DB_READ_HOST!,
            port: env.DB_READ_PORT ?? env.DB_PORT,
            username: env.DB_READ_USERNAME ?? env.DB_USERNAME,
            password: env.DB_READ_PASSWORD ?? env.DB_PASSWORD,
            database: env.DB_DATABASE,
          },
        ],
      },
    }
  : primary;

export const dataSourceOptions: DataSourceOptions = {
  type: 'postgres',
  ...connection,
  ssl: env.DB_SSL ? { rejectUnauthorized: true } : false,
  entities: ENTITIES,
  migrations: MIGRATIONS,
  migrationsTableName: 'typeorm_migrations',
  migrationsTransactionMode: 'each',
  synchronize: false,
  dropSchema: false,
  /* Tests trigger constraint errors on purpose; the error handler / assertions cover them. */
  logging: env.DB_LOGGING ? ['query', 'error'] : env.isTest ? false : ['error'],
  extra: {
    max: env.DB_POOL_MAX,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    options: '-c timezone=UTC',
    application_name: 'amrut-admin-backend',
  },
};

/* The TypeORM CLI (migration:run / revert / generate) loads this file; it must export exactly one DataSource. */
export const AppDataSource = new DataSource(dataSourceOptions);

/* Connect with a small retry loop so the API survives the database starting a little later. */
export async function initializeDatabase(retries = 5, delayMs = 2_000): Promise<DataSource> {
  for (let attempt = 1; ; attempt++) {
    try {
      if (!AppDataSource.isInitialized) await AppDataSource.initialize();
      return AppDataSource;
    } catch (err) {
      if (attempt >= retries) throw err;
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}
