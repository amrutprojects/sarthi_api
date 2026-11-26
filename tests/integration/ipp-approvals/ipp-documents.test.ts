import type { Express } from 'express';
import { appConfig } from '../../../src/config/app.config';
import { env } from '../../../src/config/env.config';
import {
  audits,
  divisionalOfficer,
  FakeIpp,
  resetIpp,
  restoreLink,
  seedDistricts,
  submit,
  switchLink,
  wireApplication,
  wireBatch,
} from '../../helpers/ipp';
import { API, auth, request, setupTestApp, teardownTestApp, type TestActor } from '../../helpers/test-app';

/* A document of a form: fetched from IPP when an officer opens it, streamed, never stored. */
const BASE = `${API}/ipp-approvals`;
const fake = new FakeIpp();
let app: Express;
let pune: TestActor;
let id: string;

beforeAll(async () => {
  app = await setupTestApp();
  const districts = await seedDistricts();
  pune = await divisionalOfficer([districts.PUN]);
  await fake.start();
});
afterAll(async () => {
  restoreLink();
  Object.assign(appConfig.ippLink, { documentMaxBytes: 60 * 1024 * 1024 });
  await fake.stop();
  await teardownTestApp();
});
beforeEach(async () => {
  fake.reset();
  switchLink(true, fake.url);
  Object.assign(appConfig.ippLink, { documentMaxBytes: 60 * 1024 * 1024 });
  await resetIpp();
  [id] = await submit(app, wireBatch(), [wireApplication()]);
});

const open = (code: string, who = pune) =>
  request(app)
    .get(`${BASE}/applications/${id}/documents/${code}`)
    .set(auth(who.token))
    .buffer(true)
    .parse((res, done) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => done(null, Buffer.concat(chunks)));
    });
const json = (res: { body: Buffer }) => JSON.parse(res.body.toString('utf8')) as { error: { code: string } };
const PDF = Buffer.from('%PDF-1.4 synthetic');
const give = (type: string, content: Buffer, length = true) => {
  fake.document = (_req, res) => {
    res.writeHead(200, { 'Content-Type': type, ...(length ? { 'Content-Length': String(content.length) } : {}) });
    res.end(content);
  };
};

it('streams the file as an attachment, not to be kept or sniffed, and audits the view without personal data', async () => {
  give('application/pdf', PDF);
  const res = await open('AADHAAR_CARD');
  expect(res.status).toBe(200);
  expect((res.body as Buffer).equals(PDF)).toBe(true);
  expect(res.headers['content-type']).toBe('application/pdf');
  expect(res.headers['content-length']).toBe(String(PDF.length));
  expect(res.headers['cache-control']).toBe('private, no-store');
  expect(res.headers['x-content-type-options']).toBe('nosniff');
  expect(res.headers['content-disposition']).toBe(
    `attachment; filename="____ card.pdf"; filename*=UTF-8''${encodeURIComponent('आधार card.pdf')}`,
  );
  expect(fake.documentCalls).toEqual([`/api/v1/link/applications/${id}/documents/AADHAAR_CARD`]);
  expect(fake.unauthorized).toBe(0);
  const trail = await audits('ipp.document.view');
  expect(trail).toEqual([
    expect.objectContaining({ actorUserId: pune.user.id, resource: 'ipp_application', resourceId: id, details: { code: 'AADHAAR_CARD' } }),
  ]);
  expect(JSON.stringify(trail)).not.toMatch(/Asha|card\.pdf/);
});

it('passes on a video, also without a length, and a type with a parameter', async () => {
  const video = Buffer.alloc(3 * 1024 * 1024, 7);
  give('video/mp4; codecs="avc1"', video, false);
  const res = await open('INTRO_VIDEO');
  expect(res.status).toBe(200);
  expect(res.headers['content-type']).toBe('video/mp4');
  expect((res.body as Buffer).length).toBe(video.length);
});

it('404: no file uploaded, a code the form does not list, not in IPP, or a form I may not see', async () => {
  give('application/pdf', PDF);
  for (const code of ['PAN', 'OTHER', '..%2F..', 'aadhaar_card']) expect((await open(code)).status).toBe(404);
  expect(fake.documentCalls).toEqual([]);
  const stranger = await divisionalOfficer([]);
  expect((await open('AADHAAR_CARD', stranger)).status).toBe(404);
  expect(fake.documentCalls).toEqual([]);
  fake.document = null;
  const res = await open('AADHAAR_CARD');
  expect(res.status).toBe(404);
  expect(json(res).error.code).toBe('NOT_FOUND');
  expect(await audits('ipp.document.view')).toEqual([]);
});

it.each([
  ['a page', 'text/html'],
  ['a script', 'image/svg+xml'],
  ['an unnamed type', 'application/octet-stream'],
])('502 for %s', async (_name, type) => {
  give(type, Buffer.from('<script>alert(1)</script>'));
  const res = await open('AADHAAR_CARD');
  expect(res.status).toBe(502);
  expect(json(res).error.code).toBe('IPP_UNAVAILABLE');
  expect(res.body.toString()).not.toContain('script');
  expect(await audits('ipp.document.view')).toEqual([]);
});

it('502 while IPP refuses, fails, does not answer or is down', async () => {
  for (const status of [401, 403, 500, 503]) {
    fake.document = (_req, res) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end('{"error":{"code":"X"}}');
    };
    const res = await open('AADHAAR_CARD');
    expect(res.status).toBe(502);
    expect(json(res).error.code).toBe('IPP_UNAVAILABLE');
  }
  fake.document = () => undefined;
  expect((await open('AADHAAR_CARD')).status).toBe(502);
  fake.document = (req) => req.socket.destroy();
  expect((await open('AADHAAR_CARD')).status).toBe(502);
  fake.document = (_req, res) => {
    res.writeHead(302, { Location: 'http://127.0.0.1:9/elsewhere' });
    res.end();
  };
  expect((await open('AADHAAR_CARD')).status).toBe(502);
  switchLink(true, 'http://127.0.0.1:9/api/v1');
  expect((await open('AADHAAR_CARD')).status).toBe(502);
});

it('503 while the link is off', async () => {
  switchLink(false, fake.url);
  const res = await open('AADHAAR_CARD');
  expect(res.status).toBe(503);
  expect(json(res).error.code).toBe('LINK_NOT_CONFIGURED');
});

it('a file over the limit is refused, or cut when IPP did not say how long it is', async () => {
  Object.assign(appConfig.ippLink, { documentMaxBytes: 1_000 });
  give('application/pdf', Buffer.alloc(1_001, 1));
  expect((await open('AADHAAR_CARD')).status).toBe(502);
  give('application/pdf', Buffer.alloc(1_000, 1));
  expect((await open('AADHAAR_CARD')).status).toBe(200);
  give('application/pdf', Buffer.alloc(500_000, 1), false);
  await expect(open('AADHAAR_CARD')).rejects.toThrow();
});

it('a file that stops coming is cut after the time limit', async () => {
  Object.assign(env, { IPP_HTTP_TIMEOUT_MS: 500 });
  fake.document = (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': '1000' });
    res.write(Buffer.alloc(10, 1));
  };
  await expect(open('AADHAAR_CARD')).rejects.toThrow();
});

it('a slow file that keeps coming is not cut', async () => {
  Object.assign(env, { IPP_HTTP_TIMEOUT_MS: 700 });
  fake.document = (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/pdf' });
    let n = 0;
    const tick = setInterval(() => {
      res.write(Buffer.alloc(100, 1));
      if (++n === 8) {
        clearInterval(tick);
        res.end();
      }
    }, 250);
  };
  const res = await open('AADHAAR_CARD');
  expect(res.status).toBe(200);
  expect((res.body as Buffer).length).toBe(800);
});
