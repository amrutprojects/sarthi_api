import type { Request, Response } from 'express';
import { AppDataSource } from '../../config/database.config';
import { ApiResponse } from '../../shared/http/api-response';
import { asyncHandler } from '../../shared/http/async-handler';

const startedAt = Date.now();

export const healthController = {
  /* Liveness + database readiness. 503 when PostgreSQL is unreachable. */
  check: asyncHandler(async (_req: Request, res: Response) => {
    let database: 'up' | 'down' = 'down';
    try {
      if (AppDataSource.isInitialized) {
        await AppDataSource.query('SELECT 1');
        database = 'up';
      }
    } catch {
      database = 'down';
    }
    const data = { status: database === 'up' ? 'ok' : 'degraded', database, uptimeSeconds: Math.round((Date.now() - startedAt) / 1000) };
    if (database === 'up') ApiResponse.ok(res, data, 'Service healthy');
    else ApiResponse.ok(res, data, 'Database unavailable', undefined, 503);
  }),
};
