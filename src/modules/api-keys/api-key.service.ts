import type { Request } from 'express';
import type { EntityManager } from 'typeorm';
import { MESSAGES } from '../../constants/api-response.constants';
import { AppDataSource } from '../../config/database.config';
import { AppError } from '../../shared/errors/app-error';
import { auditService } from '../audit';
import type { AuthUser } from '../auth';
import { ApiKey } from './api-key.entity';
import {
  API_KEY_SCOPES,
  generateApiKey,
  keyMatches,
  keyState,
  prefixOf,
  ROTATION_OVERLAP,
  type ApiKeyScope,
  type ApiKeyState,
} from './api-key.secret';

/* Audit actions (details carry the key id, prefix, label and scopes; never the secret or its hash). */
export const API_KEY_AUDIT = {
  CREATED: 'api_key.created',
  ROTATED: 'api_key.rotated',
  REVOKED: 'api_key.revoked',
  DENIED: 'api_key.denied',
} as const;

/* The key as the Panel sees it (no hash, no secret). */
export interface ApiKeyDto {
  id: string;
  label: string;
  prefix: string;
  displayPrefix: string;
  scopes: string[];
  status: 'ACTIVE' | 'REVOKED';
  state: ApiKeyState;
  expiresAt: Date | null;
  createdAt: Date;
  createdById: string | null;
  rotatedAt: Date | null;
  rotatedById: string | null;
  replacedById: string | null;
  rotatedFromId: string | null;
  revokedAt: Date | null;
  revokedById: string | null;
  revokedReason: string | null;
  lastUsedAt: Date | null;
}

export const toApiKeyDto = (k: ApiKey, now = new Date()): ApiKeyDto => ({
  id: k.id,
  label: k.label,
  prefix: k.prefix,
  displayPrefix: `amk_${k.prefix}_…`,
  scopes: k.scopes,
  status: k.status,
  state: keyState(k, now),
  expiresAt: k.expiresAt,
  createdAt: k.createdAt,
  createdById: k.createdById,
  rotatedAt: k.rotatedAt,
  rotatedById: k.rotatedById,
  replacedById: k.replacedById,
  rotatedFromId: k.rotatedFromId,
  revokedAt: k.revokedAt,
  revokedById: k.revokedById,
  revokedReason: k.revokedReason,
  lastUsedAt: k.lastUsedAt,
});

/* The verified caller of an X-Api-Key route. */
export interface ApiKeyPrincipal {
  id: string;
  prefix: string;
  label: string;
  scopes: string[];
}

export type VerifyFailure = 'missing' | 'malformed' | 'unknown' | 'revoked' | 'expired' | 'scope';

const repo = (m?: EntityManager) => (m ?? AppDataSource.manager).getRepository(ApiKey);
const auditDetails = (k: ApiKey) => ({ keyId: k.id, prefix: k.prefix, label: k.label, scopes: k.scopes });

export const apiKeyService = {
  async list(q: { state?: ApiKeyState } = {}): Promise<ApiKeyDto[]> {
    const now = new Date();
    const rows = await repo().find({ order: { createdAt: 'DESC' } });
    return rows.map((k) => toApiKeyDto(k, now)).filter((k) => !q.state || k.state === q.state);
  },

  async get(id: string): Promise<ApiKeyDto> {
    const k = await repo().findOne({ where: { id } });
    if (!k) throw AppError.notFound(MESSAGES.notFound('API key'));
    return toApiKeyDto(k);
  },

  /* Generates a key. The secret is in this answer only; Amrut keeps its hash. */
  async create(
    input: { label: string; scopes?: ApiKeyScope[]; expiresAt?: Date | null },
    actor: AuthUser,
    req?: Request,
  ): Promise<{ key: ApiKeyDto; secret: string }> {
    if (input.expiresAt && input.expiresAt.getTime() <= Date.now()) throw AppError.badRequest('The expiry must be in the future');
    const generated = generateApiKey();
    const key = await AppDataSource.transaction(async (m) => {
      const saved = await repo(m).save(
        repo(m).create({
          label: input.label,
          prefix: generated.prefix,
          secretHash: generated.secretHash,
          scopes: [...new Set(input.scopes?.length ? input.scopes : API_KEY_SCOPES)],
          status: 'ACTIVE',
          expiresAt: input.expiresAt ?? null,
          createdById: actor.id,
        }),
      );
      await auditService.recordInTx(m, req, {
        action: API_KEY_AUDIT.CREATED,
        resource: 'api_key',
        resourceId: saved.id,
        details: auditDetails(saved),
      });
      return saved;
    });
    return { key: toApiKeyDto(key), secret: generated.secret };
  },

  /*
   * Rotates a key: a new key (same label and scopes; its secret in this answer only) replaces it, and the old one keeps
   * working for `overlapMinutes` (default one day, 0 = stops now) so the LMS can be updated without a gap.
   */
  async rotate(
    id: string,
    input: { overlapMinutes?: number },
    actor: AuthUser,
    req?: Request,
  ): Promise<{ key: ApiKeyDto; secret: string; previous: ApiKeyDto }> {
    const overlap = input.overlapMinutes ?? ROTATION_OVERLAP.DEFAULT_MINUTES;
    const generated = generateApiKey();
    const result = await AppDataSource.transaction(async (m) => {
      const old = await repo(m).findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!old) throw AppError.notFound(MESSAGES.notFound('API key'));
      const state = keyState(old);
      if (state !== 'ACTIVE') throw AppError.conflict(`A key that is ${state.toLowerCase()} cannot be rotated`);
      const now = new Date();
      const fresh = await repo(m).save(
        repo(m).create({
          label: old.label,
          prefix: generated.prefix,
          secretHash: generated.secretHash,
          scopes: old.scopes,
          status: 'ACTIVE',
          /* An expiry set on the old key carries over (rotation never extends a key's life). */
          expiresAt: old.expiresAt,
          createdById: actor.id,
          rotatedFromId: old.id,
        }),
      );
      const overlapEnd = new Date(now.getTime() + overlap * 60_000);
      old.expiresAt = old.expiresAt && old.expiresAt < overlapEnd ? old.expiresAt : overlapEnd;
      old.rotatedAt = now;
      old.rotatedById = actor.id;
      old.replacedById = fresh.id;
      await repo(m).save(old);
      await auditService.recordInTx(m, req, {
        action: API_KEY_AUDIT.ROTATED,
        resource: 'api_key',
        resourceId: old.id,
        details: {
          ...auditDetails(old),
          newKeyId: fresh.id,
          newPrefix: fresh.prefix,
          overlapMinutes: overlap,
          oldKeyExpiresAt: old.expiresAt,
        },
      });
      return { fresh, old };
    });
    return { key: toApiKeyDto(result.fresh), secret: generated.secret, previous: toApiKeyDto(result.old) };
  },

  /* Revokes a key: refused from the next request on. Revoking twice is a conflict. */
  async revoke(id: string, reason: string, actor: AuthUser, req?: Request): Promise<ApiKeyDto> {
    const key = await AppDataSource.transaction(async (m) => {
      const k = await repo(m).findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!k) throw AppError.notFound(MESSAGES.notFound('API key'));
      if (k.status === 'REVOKED') throw AppError.conflict('The key is already revoked');
      k.status = 'REVOKED';
      k.revokedAt = new Date();
      k.revokedById = actor.id;
      k.revokedReason = reason;
      await repo(m).save(k);
      await auditService.recordInTx(m, req, {
        action: API_KEY_AUDIT.REVOKED,
        resource: 'api_key',
        resourceId: k.id,
        details: { ...auditDetails(k), reason },
      });
      return k;
    });
    return toApiKeyDto(key);
  },

  /*
   * Checks a presented X-Api-Key: well-formed, known (constant-time hash comparison), not revoked, not expired, and
   * holding `scope`. Never throws and never logs the key; the caller answers 401 on any failure.
   */
  async verify(
    presented: string | undefined,
    scope: ApiKeyScope,
  ): Promise<{ ok: true; key: ApiKeyPrincipal } | { ok: false; reason: VerifyFailure; keyId?: string }> {
    if (!presented) return { ok: false, reason: 'missing' };
    const prefix = prefixOf(presented);
    if (!prefix) {
      keyMatches(presented, null);
      return { ok: false, reason: 'malformed' };
    }
    const row = await repo().createQueryBuilder('k').addSelect('k.secretHash').where('k.prefix = :prefix', { prefix }).getOne();
    if (!keyMatches(presented, row?.secretHash ?? null) || !row) return { ok: false, reason: 'unknown' };
    const state = keyState(row);
    if (state === 'REVOKED') return { ok: false, reason: 'revoked', keyId: row.id };
    if (state === 'EXPIRED') return { ok: false, reason: 'expired', keyId: row.id };
    if (!row.scopes.includes(scope)) return { ok: false, reason: 'scope', keyId: row.id };
    return { ok: true, key: { id: row.id, prefix: row.prefix, label: row.label, scopes: row.scopes } };
  },

  /* Last use, written at most once a minute per key (no write on every call). */
  async touch(id: string): Promise<void> {
    await AppDataSource.query(
      `UPDATE "api_keys" SET "lastUsedAt" = now() WHERE "id" = $1 AND ("lastUsedAt" IS NULL OR "lastUsedAt" < now() - interval '1 minute')`,
      [id],
    );
  },
};
