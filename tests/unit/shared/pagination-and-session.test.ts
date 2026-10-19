import type { Request } from 'express';
import { PAGINATION } from '../../../src/shared/constants/app.constants';
import { buildMeta, listQuerySchema, toSkipTake } from '../../../src/shared/utils/pagination';
import { csrfTokenFor, csrfValid, needsCsrf, readSessionCookie } from '../../../src/modules/auth/session';

const req = (headers: Record<string, string>, method = 'POST') =>
  ({ method, headers, header: (n: string) => headers[n.toLowerCase()] }) as unknown as Request;

describe('pagination', () => {
  it('applies defaults, caps the limit and whitelists sort fields', () => {
    const schema = listQuerySchema(['createdAt', 'name'] as const);
    expect(schema.parse({})).toMatchObject({ page: 1, limit: PAGINATION.DEFAULT_LIMIT, sortBy: 'createdAt', sortOrder: 'DESC' });
    expect(schema.safeParse({ limit: String(PAGINATION.MAX_LIMIT + 1) }).success).toBe(false);
    expect(schema.safeParse({ sortBy: 'passwordHash' }).success).toBe(false);
  });

  it('computes offsets and page counts', () => {
    expect(toSkipTake({ page: 3, limit: 20 })).toEqual({ skip: 40, take: 20 });
    expect(buildMeta({ page: 1, limit: 20 }, 0)).toEqual({ page: 1, limit: 20, total: 0, totalPages: 1 });
    expect(buildMeta({ page: 1, limit: 20 }, 41).totalPages).toBe(3);
  });
});

describe('session cookie and CSRF', () => {
  it('reads only the session cookie', () => {
    expect(readSessionCookie(req({ cookie: 'a=1; amrut_session=tok%2E1; b=2' }))).toBe('tok.1');
    expect(readSessionCookie(req({ cookie: 'other=1' }))).toBeNull();
  });

  it('requires CSRF only for state-changing methods, and validates it against the session', () => {
    expect(needsCsrf(req({}, 'GET'))).toBe(false);
    expect(needsCsrf(req({}, 'DELETE'))).toBe(true);
    const token = csrfTokenFor('session-1');
    expect(csrfValid(req({ 'x-csrf-token': token }), 'session-1')).toBe(true);
    expect(csrfValid(req({ 'x-csrf-token': token }), 'session-2')).toBe(false);
    expect(csrfValid(req({}), 'session-1')).toBe(false);
  });
});
