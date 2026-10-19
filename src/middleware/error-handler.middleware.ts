import type { ErrorRequestHandler, RequestHandler } from 'express';
import { QueryFailedError } from 'typeorm';
import { ERROR_CODES, HTTP_STATUS, RESPONSE_MESSAGES } from '../constants/api-response.constants';
import { logger } from '../observability/logger';
import { PG_ERROR } from '../shared/constants/app.constants';
import { AppError } from '../shared/errors/app-error';
import { ApiResponse } from '../utils/api-response';

interface PgDriverError {
  code?: string;
  constraint?: string;
}

/* Unknown routes: a JSON 404 in the standard envelope. */
export const notFoundHandler: RequestHandler = (req, res) => {
  ApiResponse.error(
    res,
    HTTP_STATUS.NOT_FOUND,
    `${RESPONSE_MESSAGES.ROUTE_NOT_FOUND}: ${req.method} ${req.path}`,
    ERROR_CODES.ROUTE_NOT_FOUND,
  );
};

/*
 * The global error handler for every API. AppErrors map to their status; body-parser and known PostgreSQL
 * errors map to 4xx; anything else is a 500 with a generic message. SQL text, stack traces and configuration
 * are never sent to the client — they go to the server log with the request id.
 */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof AppError) {
    if (err.statusCode >= HTTP_STATUS.INTERNAL_SERVER_ERROR) logger.error({ err, requestId: req.id }, err.message);
    ApiResponse.error(res, err.statusCode, err.message, err.code, err.details);
    return;
  }

  /* Malformed or oversized JSON body (express.json). */
  if (err?.type === 'entity.parse.failed') {
    ApiResponse.error(res, HTTP_STATUS.BAD_REQUEST, RESPONSE_MESSAGES.MALFORMED_JSON, ERROR_CODES.BAD_REQUEST);
    return;
  }
  if (err?.type === 'entity.too.large') {
    ApiResponse.error(res, HTTP_STATUS.PAYLOAD_TOO_LARGE, RESPONSE_MESSAGES.PAYLOAD_TOO_LARGE, ERROR_CODES.PAYLOAD_TOO_LARGE);
    return;
  }

  if (err instanceof QueryFailedError) {
    const pg = err.driverError as PgDriverError;
    logger.warn({ requestId: req.id, code: pg.code, constraint: pg.constraint }, 'database constraint error');
    switch (pg.code) {
      case PG_ERROR.UNIQUE_VIOLATION:
        ApiResponse.error(res, HTTP_STATUS.CONFLICT, RESPONSE_MESSAGES.DUPLICATE_RECORD, ERROR_CODES.CONFLICT);
        return;
      case PG_ERROR.FOREIGN_KEY_VIOLATION:
        ApiResponse.error(res, HTTP_STATUS.CONFLICT, RESPONSE_MESSAGES.RELATED_RECORDS_CONFLICT, ERROR_CODES.CONFLICT);
        return;
      case PG_ERROR.CHECK_VIOLATION:
      case PG_ERROR.INVALID_TEXT_REPRESENTATION:
        ApiResponse.error(res, HTTP_STATUS.BAD_REQUEST, RESPONSE_MESSAGES.INVALID_VALUE, ERROR_CODES.BAD_REQUEST);
        return;
      default:
        logger.error({ err, requestId: req.id }, 'database error');
        ApiResponse.error(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, RESPONSE_MESSAGES.DATABASE_ERROR, ERROR_CODES.INTERNAL_ERROR);
        return;
    }
  }

  /* The full error (with stack) goes to the server log only; the client gets a generic message. */
  logger.error({ err, requestId: req.id }, 'unhandled error');
  ApiResponse.error(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, RESPONSE_MESSAGES.INTERNAL_SERVER_ERROR, ERROR_CODES.INTERNAL_ERROR);
};
