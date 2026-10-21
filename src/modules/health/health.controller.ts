import type { Request, Response } from 'express';
import { HTTP_STATUS, RESPONSE_MESSAGES } from '../../constants/api-response.constants';
import { AppDataSource, readReplicaEnabled } from '../../config/database.config';
import { ApiResponse } from '../../utils/api-response';
import { asyncHandler } from '../../shared/http/async-handler';

const startedAt = Date.now();
const uptimeSeconds = () => Math.round((Date.now() - startedAt) / 1000);

export const healthController = {
  /* Liveness: the process is up and serving HTTP. Never touches dependencies (a DB outage must not restart pods). */
  live: (_req: Request, res: Response) => {
    ApiResponse.ok(res, { status: 'ok', uptimeSeconds: uptimeSeconds() }, RESPONSE_MESSAGES.SERVICE_HEALTHY);
  },

  /*
   * Readiness: PostgreSQL reachable, no pending migrations and, when configured, the read replica reachable and in
   * recovery (a real read-only copy). 503 tells the load balancer to stop routing here.
   */
  ready: asyncHandler(async (_req: Request, res: Response) => {
    let database: 'up' | 'down' = 'down';
    let migrations: 'current' | 'pending' | 'unknown' = 'unknown';
    let readReplica: 'up' | 'down' | 'off' = readReplicaEnabled ? 'down' : 'off';
    try {
      if (AppDataSource.isInitialized) {
        await AppDataSource.query('SELECT 1');
        database = 'up';
        migrations = (await AppDataSource.showMigrations()) ? 'pending' : 'current';
      }
    } catch {
      database = 'down';
    }
    if (readReplicaEnabled && AppDataSource.isInitialized) {
      const runner = AppDataSource.createQueryRunner('slave');
      try {
        const [row] = await runner.query('SELECT pg_is_in_recovery() AS replica');
        readReplica = row?.replica ? 'up' : 'down';
      } catch {
        readReplica = 'down';
      } finally {
        await runner.release();
      }
    }
    const ready = database === 'up' && migrations === 'current' && readReplica !== 'down';
    const data = { status: ready ? 'ok' : 'degraded', database, migrations, readReplica, uptimeSeconds: uptimeSeconds() };
    /* 503 tells the load balancer to stop routing here; the body still carries the details. */
    ApiResponse.success(
      res,
      ready ? HTTP_STATUS.OK : HTTP_STATUS.SERVICE_UNAVAILABLE,
      data,
      ready ? RESPONSE_MESSAGES.SERVICE_HEALTHY : RESPONSE_MESSAGES.SERVICE_NOT_READY,
    );
  }),
};
