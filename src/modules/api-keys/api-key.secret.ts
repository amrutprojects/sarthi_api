import crypto from 'crypto';

/*
 * The shape of an Amrut-issued API key and its hash. Pure (no database), so unit tests cover it directly.
 *
 *   amk_<prefix>_<secret>     prefix: 12 lowercase hex characters (6 random bytes), public, unique, shown in the Panel
 *                             secret: 43 base64url characters (32 random bytes)
 *
 * Only sha256(<whole key>) is stored. The key has 256 bits of randomness, so a plain hash is enough (no slow hash:
 * nothing to brute-force), and it is compared in constant time.
 */
export const API_KEY_RE = /^amk_([0-9a-f]{12})_([A-Za-z0-9_-]{43})$/;

export interface GeneratedKey {
  /* The full key: returned once to the person who generates it, never stored, never logged. */
  secret: string;
  prefix: string;
  secretHash: string;
}

export const hashApiKey = (key: string): string => crypto.createHash('sha256').update(key, 'utf8').digest('hex');

export function generateApiKey(): GeneratedKey {
  const prefix = crypto.randomBytes(6).toString('hex');
  const secret = `amk_${prefix}_${crypto.randomBytes(32).toString('base64url')}`;
  return { secret, prefix, secretHash: hashApiKey(secret) };
}

/* The prefix of a well-formed key, or null. */
export function prefixOf(key: string | undefined | null): string | null {
  if (typeof key !== 'string') return null;
  const m = API_KEY_RE.exec(key);
  return m ? m[1] : null;
}

/* A hash of the right length that matches no key: compared against when the prefix is unknown, so timing tells nothing. */
const DUMMY_HASH = hashApiKey('amk_000000000000_unused-unused-unused-unused-unused-unus');

/* Constant-time comparison of the presented key with a stored hash (null = no such key). */
export function keyMatches(presented: string, storedHash: string | null): boolean {
  const a = Buffer.from(hashApiKey(presented), 'hex');
  const b = Buffer.from(storedHash && /^[0-9a-f]{64}$/.test(storedHash) ? storedHash : DUMMY_HASH, 'hex');
  return crypto.timingSafeEqual(a, b) && storedHash !== null;
}

/* What a key may call. The LMS key needs all three (contract amrut-student-api.md §2–§4). */
export const API_KEY_SCOPES = ['lms.students.match', 'lms.students.create', 'lms.students.update'] as const;
export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

/* The key's state as the Panel shows it: a rotated key is EXPIRING during its overlap window, then EXPIRED. */
export type ApiKeyState = 'ACTIVE' | 'EXPIRING' | 'EXPIRED' | 'REVOKED';
export function keyState(k: { status: string; expiresAt: Date | null; replacedById: string | null }, now = new Date()): ApiKeyState {
  if (k.status === 'REVOKED') return 'REVOKED';
  if (k.expiresAt && k.expiresAt.getTime() <= now.getTime()) return 'EXPIRED';
  if (k.replacedById) return 'EXPIRING';
  return 'ACTIVE';
}

/* Rotation overlap: how long the replaced key keeps working (minutes). */
export const ROTATION_OVERLAP = { DEFAULT_MINUTES: 24 * 60, MAX_MINUTES: 7 * 24 * 60 } as const;
