import { createHash, createHmac } from 'crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { env } from '../../../src/config/env.config';
import { signCall, signedHeaders, signingText, ippLinkGate, verifyIppSignature } from '../../../src/modules/ipp-approvals/ipp-signature';
import type { AppError } from '../../../src/shared/errors/app-error';

/* Contract ipp_backend/docs/SARTHI_LINK.md section 1. */
const SECRET = 'unit-test-ipp-link-secret-0123456789';
const PATH = '/integration/v1/ipp/messages';
const BODY = Buffer.from('{"a":1}');
const now = () => String(Math.floor(Date.now() / 1000));

beforeAll(() => {
  Object.assign(env, { IPP_LINK_ENABLED: true, IPP_API_URL: 'https://ipp.example.test/api/v1', IPP_LINK_SECRET: SECRET });
});
afterAll(() => {
  Object.assign(env, { IPP_LINK_ENABLED: false, IPP_API_URL: undefined, IPP_LINK_SECRET: undefined });
});

function run(
  handler: RequestHandler,
  headers: Record<string, string>,
  o: { body?: Buffer; path?: string; method?: string } = {},
): AppError | undefined {
  const req = {
    method: o.method ?? 'POST',
    originalUrl: o.path ?? PATH,
    rawBody: o.body ?? BODY,
    header: (name: string) => headers[name.toLowerCase()],
  } as unknown as Request;
  let result: unknown = 'not-called';
  handler(
    req,
    {} as Response,
    ((err?: unknown) => {
      result = err;
    }) as NextFunction,
  );
  return result as AppError | undefined;
}

const signed = (o: { client?: string; timestamp?: string; path?: string; body?: Buffer; secret?: string; method?: string } = {}) => {
  const timestamp = o.timestamp ?? now();
  const signature = signCall(o.secret ?? SECRET, {
    client: o.client ?? 'ipp',
    method: o.method ?? 'POST',
    path: o.path ?? PATH,
    timestamp,
    body: o.body ?? BODY,
  });
  return { authorization: `IPP-SARTHI ipp:${signature}`, 'x-timestamp': timestamp };
};

describe('the signed text', () => {
  it('is client, method, path with query, timestamp and the body hash, one per line', () => {
    const text = signingText({ client: 'sarthi', method: 'post', path: '/api/v1/link/decisions?x=1', timestamp: '1764000000', body: BODY });
    expect(text).toBe(
      ['sarthi', 'POST', '/api/v1/link/decisions?x=1', '1764000000', createHash('sha256').update('{"a":1}').digest('hex')].join('\n'),
    );
  });

  it('is signed with HMAC-SHA256, lower-case hex; no body counts as an empty string', () => {
    const call = { client: 'ipp', method: 'GET', path: '/integration/v1/ipp/ping', timestamp: '1764000000', body: '' };
    const emptyHash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
    const expected = createHmac('sha256', SECRET).update(`ipp\nGET\n/integration/v1/ipp/ping\n1764000000\n${emptyHash}`).digest('hex');
    expect(signCall(SECRET, call)).toBe(expected);
    expect(expected).toMatch(/^[0-9a-f]{64}$/);
  });

  it('calls of Sarthi carry the client sarthi and the time', () => {
    const headers = signedHeaders(SECRET, 'POST', '/api/v1/link/decisions', '{}');
    expect(Object.keys(headers)).toEqual(['Authorization', 'X-Timestamp']);
    expect(Math.abs(Number(headers['X-Timestamp']) - Date.now() / 1000)).toBeLessThan(5);
    const signature = signCall(SECRET, {
      client: 'sarthi',
      method: 'POST',
      path: '/api/v1/link/decisions',
      timestamp: headers['X-Timestamp'],
      body: '{}',
    });
    expect(headers.Authorization).toBe(`IPP-SARTHI sarthi:${signature}`);
  });
});

describe('a call of IPP', () => {
  it('is accepted with a good signature', () => {
    expect(run(verifyIppSignature, signed())).toBeUndefined();
    expect(run(ippLinkGate, signed())).toBeUndefined();
  });

  it.each([
    ['another secret', signed({ secret: 'another-secret-another-secret-012345' })],
    ['another path', signed({ path: '/integration/v1/ipp/ping' })],
    ['another body', signed({ body: Buffer.from('{"a":2}') })],
    ['another method', signed({ method: 'PUT' })],
    ["Sarthi's own client", signed({ client: 'sarthi' })],
    ['no signature', { 'x-timestamp': now() }],
    ['another scheme', { ...signed(), authorization: signed().authorization.replace('IPP-SARTHI', 'AMK-HMAC') }],
    ['upper-case hex', { ...signed(), authorization: signed().authorization.replace(/[0-9a-f]{64}$/, (h) => h.toUpperCase()) }],
    ['a cut signature', { ...signed(), authorization: signed().authorization.slice(0, -2) }],
  ])('is refused with %s', (_name, headers) => {
    const err = run(verifyIppSignature, headers as Record<string, string>);
    expect(err).toMatchObject({ statusCode: 401, code: 'LINK_UNAUTHORIZED' });
    expect(err?.message).not.toContain(SECRET);
  });

  it.each(['600', '-600'])('is refused with a timestamp %s seconds away, before the body is read', (offset) => {
    const headers = signed({ timestamp: String(Number(now()) + Number(offset)) });
    expect(run(ippLinkGate, headers)).toMatchObject({ statusCode: 401, code: 'LINK_UNAUTHORIZED' });
    expect(run(verifyIppSignature, headers)).toMatchObject({ statusCode: 401 });
  });

  it('is 503 while the link is off', () => {
    Object.assign(env, { IPP_LINK_ENABLED: false });
    expect(run(ippLinkGate, signed())).toMatchObject({ statusCode: 503, code: 'LINK_NOT_CONFIGURED' });
    Object.assign(env, { IPP_LINK_ENABLED: true });
  });
});
