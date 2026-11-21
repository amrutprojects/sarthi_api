import pino from 'pino';
import { env } from '../config/env.config';

/* Paths censored in every log line (exported so tests can check them with a captured stream). */
export const LOG_REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  /* M1: Amrut-issued API keys (X-Api-Key) and Aadhaar numbers sent by the LMS. */
  'req.headers["x-api-key"]',
  '*.apiKey',
  '*.secret',
  '*.aadhaar_number',
  'res.headers["set-cookie"]',
  '*.password',
  '*.passwordHash',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  /* M1 sync: the LMS tenant key, wherever an X-Api-Key header object is logged. */
  '*["x-api-key"]',
  '*["X-Api-Key"]',
];

/*
 * Structured JSON logger. Credentials and tokens are redacted wherever they could appear
 * (request headers, cookies, request bodies).
 */
export const logger = pino({
  level: env.isTest ? 'silent' : env.LOG_LEVEL,
  base: { service: 'amrut-admin-backend', env: env.NODE_ENV },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: LOG_REDACT_PATHS,
    censor: '[REDACTED]',
  },
  transport:
    env.isProduction || env.isTest ? undefined : { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:standard' } },
});
