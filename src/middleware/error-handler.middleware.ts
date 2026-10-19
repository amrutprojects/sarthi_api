import type { ErrorRequestHandler } from 'express';
import { QueryFailedError } from 'typeorm';
import { logger } from '../observability/logger';
import { PG_ERROR } from '../shared/constants/app.constants';
import { ApiResponse } from '../shared/http/api-response';
import { AppError } from '../shared/errors/app-error';

interface PgDriverError { code?: string; constraint?: string }

/*
 * Central error handler. AppErrors map to their status; known PostgreSQL errors map to 4xx;
 * everything else is a 500 with a generic message. SQL text, stack traces and configuration are
 * never sent to the client.
 */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof AppError) {
    if (err.statusCode >= 500) logger.error({ err, requestId: req.id }, err.message);
    ApiResponse.error(res, err.statusCode, err.message, err.code, err.details);
    return;
  }

  /* Malformed JSON body (express.json). */
  if (err?.type === 'entity.parse.failed') {
    ApiResponse.error(res, 400, 'Malformed JSON body', 'BAD_REQUEST');
    return;
  }
  if (err?.type === 'entity.too.large') {
    ApiResponse.error(res, 413, 'Request body too large', 'PAYLOAD_TOO_LARGE');
    return;
  }

  if (err instanceof QueryFailedError) {
    const pg = err.driverError as PgDriverError;
    logger.warn({ requestId: req.id, code: pg.code, constraint: pg.constraint }, 'database constraint error');
    switch (pg.code) {
      case PG_ERROR.UNIQUE_VIOLATION:
        ApiResponse.error(res, 409, 'A record with the same unique value already exists', 'CONFLICT');
        return;
      case PG_ERROR.FOREIGN_KEY_VIOLATION:
        ApiResponse.error(res, 409, 'The operation conflicts with related records', 'CONFLICT');
        return;
      case PG_ERROR.CHECK_VIOLATION:
      case PG_ERROR.INVALID_TEXT_REPRESENTATION:
        ApiResponse.error(res, 400, 'Invalid value', 'BAD_REQUEST');
        return;
      default:
        break;
    }
  }

  /* The full error (with stack) goes to the server log only; the client gets a generic message. */
  logger.error({ err, requestId: req.id }, 'unhandled error');
  ApiResponse.error(res, 500, 'Internal server error', 'INTERNAL_ERROR');
};
