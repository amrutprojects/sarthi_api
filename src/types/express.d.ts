import type { AuthUser } from './auth.types';

declare global {
  namespace Express {
    interface Request {
      /* Correlation id set by requestId middleware (also returned as X-Request-Id). */
      id: string;
      /* Set by authenticate(). */
      auth?: AuthUser;
      /* Parsed, validated inputs set by validateRequest(). */
      validated?: { body?: unknown; query?: unknown; params?: unknown };
    }
  }
}

export {};
