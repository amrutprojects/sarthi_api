import type { NextFunction, Request, Response } from 'express';
import { sign, verifyLmsSignature } from '../../../src/modules/lms-access/integration-signature';
import type { AppError } from '../../../src/shared/errors/app-error';

const SECRET = 'unit-test-lms-integration-secret-0123456789';
const PATH = '/integration/v1/lms/sign-in';
const BODY = Buffer.from(JSON.stringify({ identifier: 'lms@example.test', password: 'x' }));

function call(headers: Record<string, string>, body: Buffer = BODY, path = PATH): AppError | undefined {
  const req = {
    method: 'POST',
    originalUrl: path,
    rawBody: body,
    header: (name: string) => headers[name.toLowerCase()],
  } as unknown as Request;
  let result: unknown = 'not-called';
  verifyLmsSignature(
    req,
    {} as Response,
    ((err?: unknown) => {
      result = err;
    }) as NextFunction,
  );
  return result as AppError | undefined;
}

const now = () => String(Math.floor(Date.now() / 1000));
const signed = (ts = now(), body: Buffer = BODY, path = PATH, secret = SECRET) => ({
  authorization: `AMK-HMAC lms:${sign(secret, 'POST', path, ts, body)}`,
  'x-timestamp': ts,
});

describe('LMS integration signature', () => {
  it('accepts a correctly signed request', () => {
    expect(call(signed())).toBeUndefined();
  });

  it('refuses a missing or malformed Authorization header', () => {
    expect(call({ 'x-timestamp': now() })?.code).toBe('SIGNATURE_INVALID');
    expect(call({ authorization: 'Bearer abc', 'x-timestamp': now() })?.code).toBe('SIGNATURE_INVALID');
  });

  it('refuses another client id', () => {
    const h = signed();
    expect(call({ ...h, authorization: h.authorization.replace('lms:', 'web:') })?.code).toBe('SIGNATURE_INVALID');
  });

  it('refuses a stale timestamp', () => {
    const old = String(Math.floor(Date.now() / 1000) - 600);
    expect(call(signed(old))?.code).toBe('SIGNATURE_INVALID');
  });

  it('refuses a body or path that differs from what was signed', () => {
    expect(call(signed(), Buffer.from('{"identifier":"other@example.test","password":"x"}'))?.code).toBe('SIGNATURE_INVALID');
    expect(call(signed(), BODY, '/integration/v1/lms/users/1/access')?.code).toBe('SIGNATURE_INVALID');
  });

  it('refuses a signature made with another secret', () => {
    expect(call(signed(now(), BODY, PATH, 'another-secret-another-secret-0123456789'))?.code).toBe('SIGNATURE_INVALID');
  });
});
