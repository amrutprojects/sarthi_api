import { createHash, createHmac, timingSafeEqual } from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import { ERROR_CODES, HTTP_STATUS } from '../../constants/api-response.constants';
import { appConfig } from '../../config/app.config';
import { AppError } from '../../shared/errors/app-error';

/*
 * Service authentication for calls from the LMS (SEC-013, simplified).
 *
 *   Authorization: AMK-HMAC lms:<hex signature>
 *   X-Timestamp:   <unix seconds>
 *
 * signature = HMAC-SHA256(LMS_INTEGRATION_SECRET, METHOD \n PATH \n TIMESTAMP \n SHA256-HEX(raw body))
 * where PATH is the request path with its query string as sent (e.g. /integration/v1/lms/sign-in) and the body hash
 * is of the exact bytes sent (empty string for a GET). Requests older or newer than maxSkewSeconds are refused.
 */
export const LMS_CLIENT_ID = 'lms';
const SCHEME = 'AMK-HMAC';

export function signingString(method: string, path: string, timestamp: string, body: Buffer | string): string {
  const bodyHash = createHash('sha256').update(body).digest('hex');
  return [method.toUpperCase(), path, timestamp, bodyHash].join('\n');
}

export function sign(secret: string, method: string, path: string, timestamp: string, body: Buffer | string): string {
  return createHmac('sha256', secret)
    .update(signingString(method, path, timestamp, body))
    .digest('hex');
}

function refuse(message: string): AppError {
  return new AppError(HTTP_STATUS.UNAUTHORIZED, message, ERROR_CODES.SIGNATURE_INVALID);
}

export function verifyLmsSignature(req: Request, _res: Response, next: NextFunction): void {
  const { secret, maxSkewSeconds } = appConfig.lmsIntegration;
  if (!secret) {
    next(new AppError(HTTP_STATUS.SERVICE_UNAVAILABLE, 'LMS integration is not configured', ERROR_CODES.SERVICE_UNAVAILABLE));
    return;
  }
  const header = req.header('authorization') ?? '';
  const timestamp = req.header('x-timestamp') ?? '';
  const match = new RegExp(`^${SCHEME} ([a-z0-9-]+):([0-9a-f]{64})$`).exec(header);
  if (!match || match[1] !== LMS_CLIENT_ID) return next(refuse('Missing or malformed signature'));
  if (!/^\d{9,11}$/.test(timestamp) || Math.abs(Date.now() / 1000 - Number(timestamp)) > maxSkewSeconds) {
    return next(refuse('Request timestamp outside the allowed window'));
  }
  const expected = Buffer.from(sign(secret, req.method, req.originalUrl, timestamp, req.rawBody ?? ''), 'hex');
  const sent = Buffer.from(match[2], 'hex');
  if (sent.length !== expected.length || !timingSafeEqual(sent, expected)) return next(refuse('Signature does not match'));
  next();
}
