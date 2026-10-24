/*
 * API-122 GET /integration/v1/reference without a database: the real app, signature check, validation, limiter,
 * handler and service, with only the repository's pullSnapshot mocked. The SQL itself (deleted rows included,
 * ordering, paging) is covered by tests/integration/lms/reference-pull.test.ts against the test database.
 */
jest.mock('../../../src/lms/reference/reference.repository', () => ({
  referenceRepository: { pullSnapshot: jest.fn() },
}));

import type { Express, NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { createApp } from '../../../src/app';
import { appConfig } from '../../../src/config/app.config';
import type { ReferencePullRows } from '../../../src/lms/reference/reference.repository';
import { referenceRepository } from '../../../src/lms/reference/reference.repository';
import { referenceService, toReferencePull } from '../../../src/lms/reference/reference.service';
import { sign } from '../../../src/modules/lms-access/integration-signature';
import { LMS_CLIENT_SCOPES, requireClientScope } from '../../../src/modules/lms-access/lms-reference.routes';
import type { AppError } from '../../../src/shared/errors/app-error';

const PATH = '/integration/v1/reference';
const AS_OF = new Date('2026-10-22T06:00:00.000Z');
const T1 = new Date('2026-10-01T10:00:00.000Z');
const T2 = new Date('2026-10-02T10:00:00.000Z');

const rows = (over: Partial<ReferencePullRows> = {}): ReferencePullRows => ({
  asOf: AS_OF,
  districts: [
    { id: 'd1', code: 'PUN', name: 'Pune', isActive: true, isDelete: false, updatedAt: T1 },
    { id: 'd2', code: 'AHM', name: 'Ahmednagar', isActive: false, isDelete: false, updatedAt: T1 },
    { id: 'd3', code: 'RMV', name: 'Removed District', isActive: true, isDelete: true, updatedAt: T2 },
  ],
  centres: [
    {
      id: 'c1',
      code: 'PNC1',
      name: 'Pune Main Centre',
      isActive: true,
      isDelete: false,
      districtCode: 'PUN',
      districtName: 'Pune',
      centreTypeName: 'Owned',
      talukaName: 'Haveli',
      maxSeatingCapacity: 40,
      computerSystems: 30,
      sourceUpdatedAt: T2,
    },
    {
      id: 'c2',
      code: 'OLD1',
      name: 'Old Closed Centre',
      isActive: false,
      isDelete: true,
      districtCode: 'NSK',
      districtName: 'Nashik',
      centreTypeName: null,
      talukaName: null,
      maxSeatingCapacity: null,
      computerSystems: null,
      sourceUpdatedAt: T1,
    },
  ],
  tracks: [
    { id: 't1', code: 'T01', name: 'Track One', sortOrder: 1, isActive: true, isDelete: false, updatedAt: T1 },
    { id: 't2', code: 'T98', name: 'Deleted Track', sortOrder: 98, isActive: true, isDelete: true, updatedAt: T2 },
  ],
  hasMore: false,
  ...over,
});

let app: Express;
beforeAll(() => {
  app = createApp();
});
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(referenceRepository.pullSnapshot).mockResolvedValue(rows());
});

/* Signed the way lms-api's admin-panel.client signs: over the path with its query string and the exact body. */
function signed(
  method: 'get' | 'post' | 'put' | 'patch' | 'delete',
  path: string,
  secret = appConfig.lmsIntegration.secret,
  client = 'lms',
) {
  const ts = String(Math.floor(Date.now() / 1000));
  const body = method === 'get' ? '' : '{}';
  const authorization = `AMK-HMAC ${client}:${sign(secret, method, path, ts, body)}`;
  const req = request(app)[method](path).set('Authorization', authorization).set('X-Timestamp', ts);
  return method === 'get' ? req : req.set('Content-Type', 'application/json').send(body);
}

describe('toReferencePull (API-122 wire shape)', () => {
  it('sends deleted and inactive rows as INACTIVE, and only live active rows as ACTIVE', () => {
    const out = toReferencePull(rows(), { page: 1, pageSize: 500 });
    expect(out.districts.map((d) => [d.district_code, d.status])).toEqual([
      ['PUN', 'ACTIVE'],
      ['AHM', 'INACTIVE'],
      ['RMV', 'INACTIVE'],
    ]);
    expect(out.centres.map((c) => [c.centre_code, c.status])).toEqual([
      ['PNC1', 'ACTIVE'],
      ['OLD1', 'INACTIVE'],
    ]);
    expect(out.tracks.map((t) => [t.track_code, t.status])).toEqual([
      ['T01', 'ACTIVE'],
      ['T98', 'INACTIVE'],
    ]);
  });

  it('maps every field to its contract name, with the values the Admin Panel does not record as null', () => {
    const out = toReferencePull(rows({ hasMore: true }), { page: 3, pageSize: 2 });
    expect(out.districts[0]).toEqual({
      district_id: 'd1',
      district_code: 'PUN',
      name_en: 'Pune',
      name_mr: null,
      status: 'ACTIVE',
      updated_at: T1,
    });
    expect(out.centres[0]).toEqual({
      centre_id: 'c1',
      centre_code: 'PNC1',
      district_code: 'PUN',
      district_name: 'Pune',
      name: 'Pune Main Centre',
      centre_type: 'Owned',
      taluka: 'Haveli',
      readiness_status: null,
      max_seating_capacity: 40,
      computer_systems: 30,
      tracks_offered: null,
      status: 'ACTIVE',
      updated_at: T2,
    });
    expect(out.centres[1]).toMatchObject({ centre_type: null, taluka: null, max_seating_capacity: null, computer_systems: null });
    expect(out.tracks[0]).toEqual({
      track_id: 't1',
      track_code: 'T01',
      name: 'Track One',
      name_mr: null,
      sort_order: 1,
      status: 'ACTIVE',
      updated_at: T1,
    });
    expect(out).toMatchObject({ as_of: AS_OF, page: 3, page_size: 2, has_more: true });
    expect(Object.keys(out).sort()).toEqual(['as_of', 'centres', 'districts', 'has_more', 'page', 'page_size', 'tracks']);
  });

  it('referenceService.pullSnapshot passes the query to the repository and maps the rows', async () => {
    const q = { updatedSince: T1, page: 2, pageSize: 10 };
    await expect(referenceService.pullSnapshot(q)).resolves.toEqual(toReferencePull(rows(), q));
    expect(referenceRepository.pullSnapshot).toHaveBeenCalledWith(q);
  });
});

describe('requireClientScope', () => {
  const run = (authorization: string, scope = 'reference.read') => {
    let result: unknown = 'not-called';
    requireClientScope(scope)(
      { header: (n: string) => (n.toLowerCase() === 'authorization' ? authorization : undefined) } as unknown as Request,
      {} as Response,
      ((err?: unknown) => {
        result = err;
      }) as NextFunction,
    );
    return result as AppError | undefined;
  };
  const hex = 'a'.repeat(64);

  it('gives the LMS client exactly the reference.read scope', () => {
    expect(LMS_CLIENT_SCOPES).toEqual(['reference.read']);
    expect(run(`AMK-HMAC lms:${hex}`)).toBeUndefined();
  });

  it('refuses a scope the client does not hold, or another client, with 403', () => {
    expect(run(`AMK-HMAC lms:${hex}`, 'reference.write')).toMatchObject({ statusCode: 403, code: 'FORBIDDEN' });
    expect(run(`AMK-HMAC web:${hex}`)).toMatchObject({ statusCode: 403, code: 'FORBIDDEN' });
    expect(run('')).toMatchObject({ statusCode: 403, code: 'FORBIDDEN' });
  });
});

describe('GET /integration/v1/reference', () => {
  it('refuses an unsigned call with 401 and never reads', async () => {
    const res = await request(app).get(PATH);
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ success: false, error: { code: 'SIGNATURE_INVALID' } });
    expect(referenceRepository.pullSnapshot).not.toHaveBeenCalled();
  });

  it('refuses a bad signature, another client and a tampered query with 401', async () => {
    expect((await signed('get', PATH, 'another-secret-another-secret-0123456789')).status).toBe(401);
    expect((await signed('get', PATH, appConfig.lmsIntegration.secret, 'web')).status).toBe(401);
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = sign(appConfig.lmsIntegration.secret, 'GET', `${PATH}?page=1`, ts, '');
    const tampered = await request(app).get(`${PATH}?page=2`).set('Authorization', `AMK-HMAC lms:${sig}`).set('X-Timestamp', ts);
    expect(tampered.status).toBe(401);
    expect(referenceRepository.pullSnapshot).not.toHaveBeenCalled();
  });

  it('returns the page in the standard success envelope, with the defaults page 1 and page_size 500', async () => {
    const res = await signed('get', PATH);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, status: 200 });
    expect(referenceRepository.pullSnapshot).toHaveBeenCalledWith({ updatedSince: undefined, page: 1, pageSize: 500 });
    const d = res.body.data;
    expect(d).toMatchObject({ as_of: AS_OF.toISOString(), page: 1, page_size: 500, has_more: false });
    expect(d.districts).toHaveLength(3);
    expect(d.districts[2]).toEqual({
      district_id: 'd3',
      district_code: 'RMV',
      name_en: 'Removed District',
      name_mr: null,
      status: 'INACTIVE',
      updated_at: T2.toISOString(),
    });
    expect(d.centres[1]).toMatchObject({ centre_code: 'OLD1', status: 'INACTIVE', readiness_status: null, tracks_offered: null });
    expect(d.tracks.map((t: { status: string }) => t.status)).toEqual(['ACTIVE', 'INACTIVE']);
  });

  it('passes page, page_size and updated_since through', async () => {
    jest.mocked(referenceRepository.pullSnapshot).mockResolvedValue(rows({ hasMore: true }));
    const res = await signed('get', `${PATH}?page=2&page_size=100&updated_since=2026-01-01T00:00:00Z`);
    expect(res.status).toBe(200);
    expect(referenceRepository.pullSnapshot).toHaveBeenCalledWith({
      updatedSince: new Date('2026-01-01T00:00:00Z'),
      page: 2,
      pageSize: 100,
    });
    expect(res.body.data).toMatchObject({ page: 2, page_size: 100, has_more: true });
  });

  it('rejects page < 1, page_size > 500 and a malformed updated_since (422)', async () => {
    for (const qs of ['page=0', 'page_size=501', 'page_size=0', 'page=x', 'updated_since=yesterday']) {
      const res = await signed('get', `${PATH}?${qs}`);
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
    expect(referenceRepository.pullSnapshot).not.toHaveBeenCalled();
  });

  it('has no write path: other methods answer 404 even when signed', async () => {
    for (const method of ['post', 'put', 'patch', 'delete'] as const) expect((await signed(method, PATH)).status).toBe(404);
    expect(referenceRepository.pullSnapshot).not.toHaveBeenCalled();
  });

  /* Last: it uses up the 30-a-minute allowance. */
  it('allows 30 pulls a minute, then answers 429 RATE_LIMITED with Retry-After', async () => {
    const first = await signed('get', PATH);
    expect(first.status).toBe(200);
    expect(first.headers['ratelimit']).toMatch(/limit=30/);
    const remaining = Number(/remaining=(\d+)/.exec(String(first.headers['ratelimit']))?.[1]);
    for (let i = 0; i < remaining; i++) expect((await signed('get', PATH)).status).toBe(200);
    const limited = await signed('get', PATH);
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('RATE_LIMITED');
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
  });
});
