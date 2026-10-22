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
    registrationMax: env.REGISTRATION_RATE_LIMIT_MAX,
  },
  permissionCacheTtlMs: env.PERMISSION_CACHE_TTL_MS,
  session: {
    cookieName: env.SESSION_COOKIE_NAME,
    secure: env.COOKIE_SECURE ? env.COOKIE_SECURE === 'true' : !['development', 'test'].includes(env.NODE_ENV),
    sameSite: env.COOKIE_SAMESITE,
    domain: env.COOKIE_DOMAIN || undefined,
    maxAgeSeconds: Math.round(env.SESSION_MAX_HOURS * 3600),
  },
  bodyLimit: '100kb',
  apiDocsEnabled: env.API_DOCS_ENABLED ? env.API_DOCS_ENABLED === 'true' : !env.isProduction,
  lmsIntegration: {
    secret: env.LMS_INTEGRATION_SECRET ?? '',
    /* Accepted clock difference between the LMS and this API, in seconds. */
    maxSkewSeconds: 300,
  },
} as const;
