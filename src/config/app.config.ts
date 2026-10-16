import { env } from './env.config';

/* Application-level settings derived from the environment. */
export const appConfig = {
  apiPrefix: '/api/v1',
  port: env.PORT,
  corsOrigins: env.corsOrigins,
  jwt: {
    secret: env.JWT_SECRET,
    expiresIn: env.JWT_EXPIRES_IN,
    issuer: env.JWT_ISSUER,
    audience: env.JWT_AUDIENCE,
    algorithm: 'HS256' as const,
  },
  bcryptRounds: env.BCRYPT_ROUNDS,
  rateLimit: {
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    max: env.RATE_LIMIT_MAX,
    loginMax: env.LOGIN_RATE_LIMIT_MAX,
  },
  permissionCacheTtlMs: env.PERMISSION_CACHE_TTL_MS,
  bodyLimit: '100kb',
} as const;
