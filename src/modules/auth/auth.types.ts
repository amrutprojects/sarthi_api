/* Claims carried in the access token. Authorization data is NOT in the token: it is resolved from the database. */
export interface AccessTokenPayload {
  sub: string;
  jti: string;
  iat: number;
  exp: number;
  iss: string;
  aud: string;
}

/* The authenticated principal attached to the request by authenticate(). */
export interface AuthUser {
  id: string;
  name: string;
  email: string;
  /* Unique token id, used for logout/revocation. */
  tokenId: string;
  tokenExpiresAt: Date;
  /* Effective permission codes from active roles and active, non-deleted grants. */
  permissions: Set<string>;
  roleCodes: string[];
}

export interface LoginResult {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  expiresAt: string;
  user: PublicUser;
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
