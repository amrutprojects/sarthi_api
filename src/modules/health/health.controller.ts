import type { Request, Response } from 'express';
import { AppDataSource } from '../../config/database.config';
import { ApiResponse } from '../../shared/http/api-response';
import { asyncHandler } from '../../shared/http/async-handler';

const startedAt = Date.now();
const uptimeSeconds = () => Math.round((Date.now() - startedAt) / 1000);

export const healthController = {
  /* Liveness: the process is up and serving HTTP. Never touches dependencies (a DB outage must not restart pods). */
  live: (_req: Request, res: Response) => {
    ApiResponse.ok(res, { status: 'ok', uptimeSeconds: uptimeSeconds() }, 'Alive');
  },

  /* Readiness: PostgreSQL reachable and no pending migrations. 503 tells the load balancer to stop routing here. */
  ready: asyncHandler(async (_req: Request, res: Response) => {
    let database: 'up' | 'down' = 'down';
    let migrations: 'current' | 'pending' | 'unknown' = 'unknown';
    try {
      if (AppDataSource.isInitialized) {
        await AppDataSource.query('SELECT 1');
        database = 'up';
        migrations = (await AppDataSource.showMigrations()) ? 'pending' : 'current';
      }
    } catch {
      database = 'down';
    }
    const ready = database === 'up' && migrations === 'current';
    const data = { status: ready ? 'ok' : 'degraded', database, migrations, uptimeSeconds: uptimeSeconds() };
    ApiResponse.ok(res, data, ready ? 'Service healthy' : 'Service not ready', undefined, ready ? 200 : 503);
  }),
};
