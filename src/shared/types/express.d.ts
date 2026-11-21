import type { AuthUser } from '../../modules/auth';
import type { ApiKeyPrincipal } from '../../modules/api-keys';

declare global {
  namespace Express {
    interface Request {
      /* Correlation id set by requestId middleware (also returned as X-Request-Id). */
      id: string;
      /* Set by authenticate(). */
      auth?: AuthUser;
      /* Parsed, validated inputs set by validateRequest(). */
      validated?: { body?: unknown; query?: unknown; params?: unknown };
      /* Exact request body bytes, kept only on /integration/v1 so its signature can be checked. */
      rawBody?: Buffer;
      /* Set by requireApiKey(): the Amrut-issued key that called (never the secret). */
      apiKey?: ApiKeyPrincipal;
    }
  }
}

export {};
