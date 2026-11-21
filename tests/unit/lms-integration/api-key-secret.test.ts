import { Writable } from 'stream';
import pino from 'pino';
import { API_KEY_RE, generateApiKey, hashApiKey, keyMatches, keyState, prefixOf } from '../../../src/modules/api-keys/api-key.secret';
import { LOG_REDACT_PATHS } from '../../../src/observability/logger';

describe('Amrut-issued API key secrets', () => {
  it('generates well-formed, unique keys and stores only a hash', () => {
    const a = generateApiKey();
    const b = generateApiKey();
    expect(a.secret).toMatch(API_KEY_RE);
    expect(a.secret.startsWith(`amk_${a.prefix}_`)).toBe(true);
    expect(a.prefix).not.toBe(b.prefix);
    expect(a.secretHash).toBe(hashApiKey(a.secret));
    expect(a.secretHash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.secretHash).not.toContain(a.secret.slice(17));
  });

  it('matches only the exact key, in constant time, and never an unknown one', () => {
    const k = generateApiKey();
    expect(keyMatches(k.secret, k.secretHash)).toBe(true);
    expect(keyMatches(k.secret.slice(0, -1) + (k.secret.endsWith('A') ? 'B' : 'A'), k.secretHash)).toBe(false);
    expect(keyMatches(k.secret, null)).toBe(false);
    expect(keyMatches(k.secret, 'not-a-hash')).toBe(false);
  });

  it('reads the prefix of a well-formed key only', () => {
    const k = generateApiKey();
    expect(prefixOf(k.secret)).toBe(k.prefix);
    for (const bad of [undefined, null, '', 'amk_short_x', `${k.secret}x`, k.secret.toUpperCase()]) expect(prefixOf(bad)).toBeNull();
  });

  it('derives the state the Panel shows', () => {
    const now = new Date('2026-11-21T10:00:00Z');
    const later = new Date('2026-11-22T10:00:00Z');
    const earlier = new Date('2026-11-20T10:00:00Z');
    expect(keyState({ status: 'ACTIVE', expiresAt: null, replacedById: null }, now)).toBe('ACTIVE');
    expect(keyState({ status: 'ACTIVE', expiresAt: later, replacedById: 'x' }, now)).toBe('EXPIRING');
    expect(keyState({ status: 'ACTIVE', expiresAt: earlier, replacedById: 'x' }, now)).toBe('EXPIRED');
    expect(keyState({ status: 'ACTIVE', expiresAt: earlier, replacedById: null }, now)).toBe('EXPIRED');
    expect(keyState({ status: 'REVOKED', expiresAt: later, replacedById: null }, now)).toBe('REVOKED');
  });

  it('censors the X-Api-Key header, keys and Aadhaar numbers in log lines', () => {
    const k = generateApiKey();
    const lines: string[] = [];
    const sink = new Writable({
      write(chunk, _enc, cb) {
        lines.push(String(chunk));
        cb();
      },
    });
    const log = pino({ redact: { paths: LOG_REDACT_PATHS, censor: '[REDACTED]' } }, sink);
    log.info({ req: { headers: { 'x-api-key': k.secret } } }, 'request');
    log.info({ body: { secret: k.secret, apiKey: k.secret, aadhaar_number: '234567890124' } }, 'body');
    const out = lines.join('');
    expect(out).toContain('[REDACTED]');
    expect(out).not.toContain(k.secret);
    expect(out).not.toContain('234567890124');
  });
});
