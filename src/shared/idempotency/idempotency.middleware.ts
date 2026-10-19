import { createHash } from 'crypto';
import type { RequestHandler } from 'express';
import { LessThan } from 'typeorm';
import { AppDataSource } from '../../config/database.config';
import { logger } from '../../observability/logger';
import { AppError } from '../errors/app-error';
import { IdempotencyKey } from './idempotency-key.entity';

const HEADER = 'idempotency-key';
const TTL_MS = 24 * 60 * 60 * 1000;
const KEY_RE = /^[A-Za-z0-9_-]{8,100}$/;

/*
 * Idempotency for retryable state-changing requests (ADR-0005). Optional: requests without the
 * header behave normally. With it, the first response (status < 500) is stored per user and key and
 * replayed for retries with the same method, path and body; a different body under the same key is
 * 422, and a retry while the first request is still running is 409. Use after authenticate().
 */
export const idempotent: RequestHandler = (req, res, next) => {
  const key = req.header(HEADER);
  if (!key) return next();
  if (!KEY_RE.test(key)) return next(AppError.badRequest('Idempotency-Key must be 8–100 characters: letters, digits, - or _'));
  const userId = req.auth?.id;
  if (!userId) return next(AppError.unauthorized());

  const requestHash = createHash('sha256').update(JSON.stringify([req.method, req.originalUrl, req.body ?? null])).digest('hex');
  const repo = AppDataSource.getRepository(IdempotencyKey);

  (async () => {
    await repo.delete({ expiresAt: LessThan(new Date()) });
    const inserted = await repo
      .createQueryBuilder().insert()
      .values({ key, userId, method: req.method, path: req.originalUrl.slice(0, 300), requestHash, expiresAt: new Date(Date.now() + TTL_MS) })
      .orIgnore().returning(['id']).execute();

    if (!inserted.identifiers.length || !inserted.identifiers[0]?.id) {
      const existing = await repo.findOneByOrFail({ userId, key });
      if (existing.requestHash !== requestHash) {
        throw new AppError(422, 'This Idempotency-Key was already used for a different request', 'IDEMPOTENCY_KEY_REUSED');
      }
      if (existing.statusCode === null) throw new AppError(409, 'A request with this Idempotency-Key is still in progress', 'IDEMPOTENCY_IN_PROGRESS');
      res.setHeader('Idempotent-Replayed', 'true');
      res.status(existing.statusCode).json(existing.responseBody);
      return;
    }

    const id = inserted.identifiers[0].id as string;
    let body: unknown = null;
    const json = res.json.bind(res);
    res.json = (payload: unknown) => { body = payload; return json(payload); };
    res.on('finish', () => {
      const done = res.statusCode < 500
        ? repo.update(id, { statusCode: res.statusCode, responseBody: body as object })
        : repo.delete(id); // server errors may be retried with the same key
      done.catch((err) => logger.error({ err }, 'failed to store idempotent response'));
    });
    next();
  })().catch(next);
};
