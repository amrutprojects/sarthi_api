import pino from 'pino';
import { env } from '../config/env.config';

/*
 * Structured JSON logger. Credentials and tokens are redacted wherever they could appear
 * (request headers, cookies, request bodies).
 */
export const logger = pino({
  level: env.isTest ? 'silent' : env.LOG_LEVEL,
  base: { service: 'amrut-admin-backend', env: env.NODE_ENV },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
      '*.password',
      '*.passwordHash',
      '*.token',
      '*.accessToken',
      '*.refreshToken',
    ],
    censor: '[REDACTED]',
  },
  transport: env.isProduction || env.isTest ? undefined : { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:standard' } },
});
