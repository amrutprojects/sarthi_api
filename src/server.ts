import 'reflect-metadata';
import { createServer } from 'http';
import { appConfig } from './config/app.config';
import { AppDataSource, initializeDatabase } from './config/database.config';
import { logger } from './observability/logger';
import { createApp } from './app';

async function main() {
  await initializeDatabase();
  logger.info('database connected');

  /* Refuse to serve against a schema with pending migrations: run `npm run migration:run` first. */
  if (await AppDataSource.showMigrations()) {
    logger.fatal('database has pending migrations; run the migrations before starting the server');
    await AppDataSource.destroy();
    process.exit(1);
  }

  const server = createServer(createApp());
  server.listen(appConfig.port, () => logger.info({ port: appConfig.port, prefix: appConfig.apiPrefix }, 'server listening'));

  /* Graceful shutdown: stop accepting connections, finish in-flight requests, close the pool. */
  const shutdown = (signal: string) => {
    logger.info({ signal }, 'shutting down');
    server.close(() => {
      AppDataSource.destroy()
        .catch((err) => logger.error({ err }, 'error closing database'))
        .finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

process.on('unhandledRejection', (reason) => logger.error({ err: reason }, 'unhandled promise rejection'));

main().catch((err) => {
  logger.fatal({ err }, 'failed to start');
  process.exit(1);
});
