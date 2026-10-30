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
  edp: {
    sessionHours: env.EDP_SESSION_HOURS,
    otpTtlSeconds: env.EDP_OTP_TTL_SECONDS,
    /* A new code only once the current one has expired, unless a shorter wait is set. */
    otpResendSeconds: Math.min(env.EDP_OTP_RESEND_SECONDS ?? env.EDP_OTP_TTL_SECONDS, env.EDP_OTP_TTL_SECONDS),
    rateLimitMax: env.EDP_RATE_LIMIT_MAX,
    support: { email: env.EDP_SUPPORT_EMAIL ?? null, mobile: env.EDP_SUPPORT_MOBILE ?? null },
    portalUrl: (env.EDP_PORTAL_URL ?? (env.isProduction ? 'https://edp.sumago.ai' : 'http://localhost:5175')).replace(/\/+$/, ''),
    sms: {
      url: env.SMS_API_URL ?? 'http://sms.happysms.in/api/sendhttp.php',
      authKey: env.SMS_AUTH_KEY,
      sender: env.SMS_SENDER,
      templateId: env.SMS_DLT_TEMPLATE_ID,
      route: env.SMS_ROUTE ?? '4',
      country: env.SMS_COUNTRY ?? '91',
      otpMessage:
        env.SMS_OTP_MESSAGE ?? 'Your OTP for Entrepreneurship Development Program registration is {otp}. Valid for {seconds} seconds. - Sumago Infotech',
    },
    smtp: {
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      user: env.SMTP_USER,
      pass: env.SMTP_PASS,
      from: env.SMTP_FROM ?? env.SMTP_USER,
    },
  },
  lmsIntegration: {
    secret: env.LMS_INTEGRATION_SECRET ?? '',
    /* Accepted clock difference between the LMS and this API, in seconds. */
    maxSkewSeconds: 300,
  },
} as const;
