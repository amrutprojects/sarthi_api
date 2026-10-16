import { randomUUID } from 'crypto';
import bcrypt from 'bcrypt';
import jwt, { type JwtPayload } from 'jsonwebtoken';
import type { Request } from 'express';
import { LessThan } from 'typeorm';
import { AppDataSource } from '../config/database.config';
import { appConfig } from '../config/app.config';
import { AUDIT_ACTIONS } from '../constants/app.constants';
import { RevokedToken } from '../entities/revoked-token.entity';
import { userRepository } from '../repositories/user.repository';
import type { AccessTokenPayload, AuthUser, LoginResult } from '../types/auth.types';
import { AppError } from '../utils/app-error';
import { auditService } from './audit.service';
import { rbacService } from './rbac.service';
import { toPublicUser } from './user.service';

/* Same message for unknown email, wrong password and disabled account, so accounts cannot be enumerated. */
const INVALID_CREDENTIALS = 'Invalid email or password';

/*
 * A real bcrypt hash of a random value. Compared against when the email is unknown so that a
 * failed login takes the same time whether or not the account exists.
 */
const DUMMY_HASH = bcrypt.hashSync(randomUUID(), 10);

export class AuthService {
  async login(email: string, password: string, req?: Request): Promise<LoginResult> {
    const user = await userRepository.findByEmailWithPassword(email);
    const passwordOk = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);

    if (!user || !passwordOk || !user.isActive) {
      await auditService.record(req, {
        action: AUDIT_ACTIONS.LOGIN_FAILED,
        resource: 'auth',
        resourceId: user?.id ?? null,
        actorUserId: user?.id ?? null,
        outcome: 'FAILURE',
        details: { reason: !user ? 'unknown_email' : !passwordOk ? 'bad_password' : 'inactive' },
      });
      throw AppError.unauthorized(INVALID_CREDENTIALS);
    }

    const { token, payload } = this.signAccessToken(user.id);
    await userRepository.update(user.id, { lastLoginAt: new Date() });
    await auditService.record(req, { action: AUDIT_ACTIONS.LOGIN, resource: 'auth', resourceId: user.id, actorUserId: user.id });

    const fresh = await userRepository.findById(user.id);
    return {
      accessToken: token,
      tokenType: 'Bearer',
      expiresIn: payload.exp - payload.iat,
      expiresAt: new Date(payload.exp * 1000).toISOString(),
      user: toPublicUser(fresh ?? user),
    };
  }

  signAccessToken(userId: string): { token: string; payload: AccessTokenPayload } {
    const token = jwt.sign({}, appConfig.jwt.secret, {
      algorithm: appConfig.jwt.algorithm,
      subject: userId,
      jwtid: randomUUID(),
      issuer: appConfig.jwt.issuer,
      audience: appConfig.jwt.audience,
      expiresIn: appConfig.jwt.expiresIn as jwt.SignOptions['expiresIn'],
    });
    return { token, payload: jwt.decode(token) as AccessTokenPayload };
  }

  /* Signature, algorithm, expiry, issuer and audience are all checked; anything else is a 401. */
  verifyAccessToken(token: string): AccessTokenPayload {
    try {
      const decoded = jwt.verify(token, appConfig.jwt.secret, {
        algorithms: [appConfig.jwt.algorithm],
        issuer: appConfig.jwt.issuer,
        audience: appConfig.jwt.audience,
      }) as JwtPayload;
      if (!decoded.sub || !decoded.jti || !decoded.exp) throw new Error('missing claims');
      return decoded as AccessTokenPayload;
    } catch {
      throw AppError.unauthorized('Invalid or expired token');
    }
  }

  /*
   * Builds the request principal from a verified token: rejects revoked tokens and users that are
   * deleted or inactive *now* (not just at login), then resolves permissions from the database.
   */
  async resolvePrincipal(payload: AccessTokenPayload): Promise<AuthUser> {
    const revoked = await AppDataSource.getRepository(RevokedToken).exists({ where: { jti: payload.jti } });
    if (revoked) throw AppError.unauthorized('Token has been revoked');

    const user = await userRepository.findById(payload.sub);
    if (!user || !user.isActive) throw AppError.unauthorized('Account is not active');

    const { permissions, roleCodes } = await rbacService.getAuthorization(user.id);
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      tokenId: payload.jti,
      tokenExpiresAt: new Date(payload.exp * 1000),
      permissions,
      roleCodes,
    };
  }

  /* Logout revokes this token until its natural expiry, and purges entries that have already expired. */
  async logout(auth: AuthUser, req?: Request): Promise<void> {
    const repo = AppDataSource.getRepository(RevokedToken);
    await repo.upsert({ jti: auth.tokenId, userId: auth.id, expiresAt: auth.tokenExpiresAt }, ['jti']);
    await repo.delete({ expiresAt: LessThan(new Date()) });
    await auditService.record(req, { action: AUDIT_ACTIONS.LOGOUT, resource: 'auth', resourceId: auth.id });
  }
}

export const authService = new AuthService();
