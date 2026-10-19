/* Claims carried in the access token. Authorization data is NOT in the token: it is resolved from the database. */
export interface AccessTokenPayload {
  sub: string;
  jti: string;
  iat: number;
  exp: number;
  iss: string;
  aud: string;
  /* Session id: stable across token renewals; revoked on logout; CSRF tokens are derived from it. */
  sid: string;
  /* Session start (epoch seconds): renewal stops after SESSION_MAX_HOURS. */
  sst: number;
}

/* The authenticated principal attached to the request by authenticate(). */
export interface AuthUser {
  id: string;
  name: string;
  email: string;
  /* Unique token id, used for logout/revocation. */
  tokenId: string;
  tokenExpiresAt: Date;
  sessionId: string;
  sessionStartedAt: number;
  /* How the request authenticated: HttpOnly cookie (browser) or Authorization header (API client). */
  via: 'cookie' | 'bearer';
  /* Effective permission codes from active roles and active, non-deleted grants. */
  permissions: Set<string>;
  roleCodes: string[];
}

export interface LoginResult {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  expiresAt: string;
  /* Send back as X-CSRF-Token on state-changing requests made with the session cookie. */
  csrfToken: string;
  user: PublicUser;
  /* Token payload, for the controller to set the session cookie. */
  payload: AccessTokenPayload;
}

export interface PublicRole {
  id: string;
  name: string;
  code: string;
}

export interface PublicUser {
  id: string;
  name: string;
  email: string;
  isActive: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  roles?: PublicRole[];
}
