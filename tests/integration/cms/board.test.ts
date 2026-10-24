import fs from 'fs';
import path from 'path';
import type { Express } from 'express';
import {
  AppDataSource,
  API,
  actorWith,
  auth,
  request,
  setupTestApp,
  superAdmin,
  teardownTestApp,
  type TestActor,
} from '../../helpers/test-app';
import { seedBoardMembers } from '../../../src/database/seeds/seed-board-members';
import { auditService } from '../../../src/modules/audit/audit.service';
import { documentStorage, storageRoot } from '../../../src/modules/students/documents/document-storage';

const ADMIN_URL = `${API}/cms/board-members`;
const PUBLIC_URL = `${API}/public/board-members`;

let app: Express;
let admin: TestActor;

interface Pair {
  mr: string;
  en: string;
}
interface AdminMember {
  id: string;
  name: string | null;
  category: Pair;
  designation: Pair;
  description: Pair;
  subtitle: Pair;
  photoUrl: string | null;
  displayOrder: number;
  isActive: boolean;
  updatedAt: string;
}
interface Detail {
  field: string;
  message: string;
}

const pair = (mr: string, en: string): Pair => ({ mr, en });
const BLANK = pair('', '');

/* Tiny but real images (1×1), so the bytes are what a browser would actually decode. */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
const WEBP = Buffer.from('UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAwA0JaQAA3AA/vuUAAA=', 'base64');
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1), Buffer.from([0xff, 0xd9])]);
const GIF = Buffer.from('R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==', 'base64');

/* The cards the website showed before the section was managed (content/leadership.ts), in order. */
const TO_FILL = pair('नाव अमृत नोंदीनुसार भरावे', 'Name to be filled from AMRUT records');
const SEEDED = [
  { name: null, category: pair('राज्य शासन', 'State Government'), designation: pair('मा. मुख्यमंत्री, महाराष्ट्र राज्य', "Hon'ble Chief Minister, Maharashtra"), description: TO_FILL },
  {
    name: null,
    category: pair('राज्य शासन', 'State Government'),
    designation: pair('मा. उपमुख्यमंत्री, महाराष्ट्र राज्य', "Hon'ble Deputy Chief Minister, Maharashtra"),
    description: TO_FILL,
  },
  {
    name: null,
    category: pair('विभाग', 'Department'),
    designation: pair('मा. मंत्री, इतर मागास बहुजन कल्याण विभाग', "Hon'ble Minister, Other Backward Bahujan Welfare Department"),
    description: TO_FILL,
  },
  {
    name: null,
    category: pair('नियामक मंडळ', 'Governing Board'),
    designation: pair(
      'मा. प्रधान सचिव, इतर मागास बहुजन कल्याण विभाग - अध्यक्ष, नियामक मंडळ (अमृत)',
      "Hon'ble Principal Secretary, OBC & Bahujan Welfare Dept. - Chairperson, AMRUT Governing Board",
    ),
    description: pair('अमृत नियामक मंडळाचे अध्यक्ष', 'Chairperson of the AMRUT Governing Board'),
  },
  {
    name: null,
    category: pair('नियामक मंडळ', 'Governing Board'),
    designation: pair('मा. व्यवस्थापकीय संचालक, अमृत', "Hon'ble Managing Director, AMRUT"),
    description: pair('योजना कार्यान्वयनाचे प्रमुख', 'Heads scheme implementation'),
  },
  {
    name: 'Rajendra Sumago',
    category: pair('अंमलबजावणी भागीदार', 'Implementation Partner'),
    designation: pair('प्रकल्प संचालक, सुमागो इन्फोटेक प्रा. लि. (SUMAGO INFOTECH PVT LTD)', 'Project Director, SUMAGO INFOTECH PVT LTD'),
    description: pair('अंमलबजावणी भागीदार', 'Implementation partner'),
  },
];

const member = (n: number, extra: Record<string, unknown> = {}) => ({
  name: `CMS Test Member ${n}`,
  category: pair('चाचणी', 'Test'),
  designation: pair(`चाचणी पद ${n}`, `Test designation ${n}`),
  description: pair('मराठी वर्णन — चाचणी', 'English description'),
  ...extra,
});

const details = (res: { body: { error: { details: Detail[] } } }) => res.body.error.details;
const fieldsOf = (res: { body: { error: { details: Detail[] } } }) => details(res).map((d) => d.field);

const list = async (): Promise<AdminMember[]> => (await request(app).get(ADMIN_URL).set(auth(admin.token)).expect(200)).body.data;
const createJson = (payload: unknown, token = admin.token) => request(app).post(ADMIN_URL).set(auth(token)).send(payload as object);
const createWithPhoto = (payload: unknown, file: Buffer, filename: string, token = admin.token) =>
  request(app).post(ADMIN_URL).set(auth(token)).field('data', JSON.stringify(payload)).attach('photo', file, { filename });
const patchJson = (id: string, payload: unknown) => request(app).patch(`${ADMIN_URL}/${id}`).set(auth(admin.token)).send(payload as object);
const patchWithPhoto = (id: string, payload: unknown, file: Buffer, filename: string) =>
  request(app).patch(`${ADMIN_URL}/${id}`).set(auth(admin.token)).field('data', JSON.stringify(payload)).attach('photo', file, { filename });

/* Storage paths for the files this suite creates. It never removes anything it did not create. */
const created = new Set<string>();
const fileOf = (photoUrl: string) => photoUrl.split('/').pop()!;
const keyOf = (photoUrl: string) => `cms/board-members/${fileOf(photoUrl)}`;
const onDisk = (photoUrl: string) => fs.existsSync(path.join(storageRoot(), 'cms', 'board-members', fileOf(photoUrl)));
const track = (m: AdminMember) => {
  if (m.photoUrl) created.add(keyOf(m.photoUrl));
  return m;
};

const auditCount = async (action: string) =>
  (await AppDataSource.query(`SELECT count(*)::int AS n FROM "audit_logs" WHERE "action" = $1`, [action]))[0].n as number;

beforeAll(async () => {
  app = await setupTestApp();
  admin = await superAdmin();
});
afterAll(async () => {
  for (const key of created) await documentStorage.remove(key).catch(() => undefined);
  await teardownTestApp();
});
afterEach(() => jest.restoreAllMocks());

describe('Board members — before the seed', () => {
  it('the public feed is null (not an error) while the section is not configured', async () => {
    const res = await request(app).get(PUBLIC_URL);
    expect(res.status).toBe(200);
    expect(res.body.data).toBeNull();
    expect((await request(app).get(`${ADMIN_URL}/settings`).set(auth(admin.token))).status).toBe(404);
  });
});

describe('Board members seed', () => {
  it('seeds exactly the cards and section text the website showed', async () => {
    expect(await seedBoardMembers(AppDataSource)).toEqual({ created: true, membersCreated: 6 });

    const members = await list();
    expect(members.map(({ name, category, designation, description }) => ({ name, category, designation, description }))).toEqual(SEEDED);
    expect(members.map((m) => [m.displayOrder, m.isActive, m.photoUrl, m.subtitle])).toEqual(SEEDED.map((_, i) => [i + 1, true, null, BLANK]));

    const pub = (await request(app).get(PUBLIC_URL).expect(200)).body.data;
    expect(pub.heading).toEqual(pair('मान्यवर व संचालक मंडळ', 'Leadership & Governing Board'));
    expect(pub.subtitle).toEqual(pair('अमृत संस्थेचे नियामक मंडळ व कार्यक्रमाचे नेतृत्व.', 'The AMRUT Governing Board and programme leadership.'));
    expect(pub.notice.title).toEqual(pair('नावे व छायाचित्रे भरावयाची आहेत', 'Names and photographs to be supplied'));
    expect(pub.notice.body.mr).toMatch(/^वरील पदनामे सार्वजनिक नोंदीनुसार आहेत\./);
    expect(pub.members.map(({ id: _id, photoUrl, subtitle, ...rest }: Record<string, unknown>) => ({ ...rest, photoUrl, subtitle }))).toEqual(
      SEEDED.map((s) => ({ ...s, photoUrl: null, subtitle: null })),
    );
  });

  it('is idempotent and never brings back what an administrator changed', async () => {
    const [first] = await list();
    await request(app).delete(`${ADMIN_URL}/${first!.id}`).set(auth(admin.token)).expect(200);
    expect(await seedBoardMembers(AppDataSource)).toEqual({ created: false, membersCreated: 0 });
    expect((await list()).map((m) => m.id)).not.toContain(first!.id);
    const [{ n }] = await AppDataSource.query(`SELECT count(*)::int AS n FROM "board_section"`);
    expect(n).toBe(1);
  });
});

describe('Creating a member', () => {
  it('creates from JSON, trims and collapses text, keeps Marathi intact and appends to the end', async () => {
    const before = await list();
    const res = await createJson(member(1, { name: '  CMS   Test Member 1 ', subtitle: pair(' उपशीर्षक ', ' Subtitle ') }));
    expect(res.status).toBe(201);
    expect(res.body.message).toBe('Board member created successfully');
    const m = res.body.data as AdminMember;
    expect(m).toMatchObject({
      name: 'CMS Test Member 1',
      description: pair('मराठी वर्णन — चाचणी', 'English description'),
      subtitle: pair('उपशीर्षक', 'Subtitle'),
      photoUrl: null,
      isActive: true,
      displayOrder: Math.max(...before.map((b) => b.displayOrder)) + 1,
    });
    expect(Object.keys(m).sort()).toEqual(
      ['category', 'createdAt', 'description', 'designation', 'displayOrder', 'id', 'isActive', 'name', 'photoUrl', 'subtitle', 'updatedAt'].sort(),
    );
    expect((await request(app).get(`${ADMIN_URL}/${m.id}`).set(auth(admin.token)).expect(200)).body.data).toEqual(m);
    expect(await auditCount('cms.board-member.create')).toBeGreaterThanOrEqual(1);
  });

  it('accepts a null name (the website prints its placeholder) and optional text left blank', async () => {
    const res = await createJson({ ...member(2, { name: null }), description: BLANK });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ name: null, description: BLANK, subtitle: BLANK });
    const card = (await request(app).get(PUBLIC_URL)).body.data.members.find((c: { id: string }) => c.id === res.body.data.id);
    expect(card).toMatchObject({ name: null, description: null, subtitle: null, photoUrl: null });
  });

  it.each([
    ['PNG', PNG, 'photo.png', 'image/png'],
    ['JPEG', JPEG, 'photo.JPEG', 'image/jpeg'],
    ['WebP', WEBP, 'photo.webp', 'image/webp'],
  ])('stores a %s photo and serves it publicly and to the admin', async (_label, file, filename, mime) => {
    const res = await createWithPhoto(member(3, { name: `Photo ${filename}` }), file, filename);
    expect(res.status).toBe(201);
    const m = track(res.body.data as AdminMember);
    expect(m.photoUrl).toMatch(/^\/cms\/board-members\/photos\/[0-9a-f-]{36}\.(jpg|png|webp)$/);
    expect(onDisk(m.photoUrl!)).toBe(true);

    const adminImg = await request(app).get(`${API}${m.photoUrl}`).set(auth(admin.token));
    expect(adminImg.status).toBe(200);
    expect(adminImg.headers['content-type']).toBe(mime);
    expect(Buffer.compare(adminImg.body as Buffer, file)).toBe(0);
    expect(adminImg.headers['cross-origin-resource-policy']).toBe('same-site');

    const card = (await request(app).get(PUBLIC_URL)).body.data.members.find((c: { id: string }) => c.id === m.id);
    expect(card.photoUrl).toBe(`/public/board-members/photos/${fileOf(m.photoUrl!)}`);
    const pubImg = await request(app).get(`${API}${card.photoUrl}`);
    expect(pubImg.status).toBe(200);
    expect(pubImg.headers['content-type']).toBe(mime);
    expect(pubImg.headers['x-content-type-options']).toBe('nosniff');
    expect(pubImg.headers['cross-origin-resource-policy']).toBe('cross-origin');
    expect(pubImg.headers['cache-control']).toBe('public, max-age=86400');
  });

  it('refuses a duplicate of the same person for the same office (case-insensitive)', async () => {
    await createJson(member(4)).expect(201);
    const res = await createJson(member(4, { name: 'cms test member 4', designation: pair('दुसरे', 'TEST DESIGNATION 4') }));
    expect(res.status).toBe(409);
    expect(res.body.message).toBe('cms test member 4 is already listed with the designation "TEST DESIGNATION 4".');
  });
});

describe('Validation', () => {
  it('requires a name — a missing key or a blank string is never a name', async () => {
    const { name: _n, ...noName } = member(5);
    for (const payload of [noName, member(5, { name: '   ' })]) {
      const res = await createJson(payload);
      expect(res.status).toBe(422);
      expect(details(res)).toContainEqual({ field: 'body.name', message: 'Name is required' });
    }
  });

  it('names each missing or malformed field', async () => {
    const res = await createJson({
      name: '<script>',
      category: pair('', 'Only English'),
      designation: pair('पद', ''),
      description: pair('फक्त मराठी', ''),
      displayOrder: 0,
      extra: true,
    });
    expect(res.status).toBe(422);
    expect(fieldsOf(res).sort()).toEqual(
      ['body', 'body.category.mr', 'body.description.en', 'body.designation.en', 'body.displayOrder', 'body.name'].sort(),
    );
    expect(details(res)).toContainEqual({ field: 'body.description.en', message: 'Description (English) is required when the Marathi text is filled in' });
  });

  it('refuses control characters and over-long text', async () => {
    const res = await createJson(member(6, { name: 'Bad\u0000Name', designation: pair('x'.repeat(251), 'ok') }));
    expect(res.status).toBe(422);
    expect(details(res)).toEqual(
      expect.arrayContaining([
        { field: 'body.designation.mr', message: 'Designation (Marathi) must be at most 250 characters' },
        expect.objectContaining({ field: 'body.name' }),
      ]),
    );
  });

  it('checks the photo by its content, extension and size, and stores nothing when it is refused', async () => {
    const write = jest.spyOn(documentStorage, 'write');
    const cases: [Buffer, string, string][] = [
      [GIF, 'photo.gif', 'The photo must be a JPEG, PNG or WebP image'],
      [Buffer.from('<html><script>alert(1)</script></html>'), 'photo.png', 'The photo must be a JPEG, PNG or WebP image'],
      [PNG, 'photo.jpg', 'The file name does not match its content: this is a PNG image, so name it .png'],
      [Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)]), 'big.png', 'The photo is larger than 5 MB'],
    ];
    for (const [file, filename, message] of cases) {
      const res = await createWithPhoto(member(7), file, filename);
      expect(res.status).toBe(422);
      expect(details(res)).toEqual([{ field: 'photo', message }]);
    }
    expect(write).not.toHaveBeenCalled();
    expect((await list()).some((m) => m.name === 'CMS Test Member 7')).toBe(false);
  });

  it('refuses malformed multipart data and a second file', async () => {
    const bad = await request(app).post(ADMIN_URL).set(auth(admin.token)).field('data', '{not json').attach('photo', PNG, 'a.png');
    expect(bad.status).toBe(422);
    expect(details(bad)).toEqual([{ field: 'body.data', message: 'data must be valid JSON' }]);

    const two = await request(app)
      .post(ADMIN_URL)
      .set(auth(admin.token))
      .field('data', JSON.stringify(member(8)))
      .attach('photo', PNG, 'a.png')
      .attach('other', PNG, 'b.png');
    expect(two.status).toBe(422);
  });

  it('answers 422 for a malformed id and 404 for an unknown one', async () => {
    expect((await request(app).get(`${ADMIN_URL}/not-a-uuid`).set(auth(admin.token))).status).toBe(422);
    const unknown = '00000000-0000-4000-8000-000000000000';
    expect((await request(app).get(`${ADMIN_URL}/${unknown}`).set(auth(admin.token))).status).toBe(404);
    expect((await patchJson(unknown, { name: 'X' })).status).toBe(404);
    expect((await request(app).delete(`${ADMIN_URL}/${unknown}`).set(auth(admin.token))).status).toBe(404);
    expect((await request(app).get(`${API}/public/board-members/photos/..%2F..%2F.env`)).status).toBe(422);
    expect((await request(app).get(`${API}/public/board-members/photos/${unknown}.png`)).status).toBe(404);
  });
});

describe('Editing a member', () => {
  let m: AdminMember;
  beforeAll(async () => {
    m = track((await createWithPhoto(member(10), PNG, 'first.png').expect(201)).body.data);
  });

  it('changes only the fields sent and keeps the photo when none is uploaded', async () => {
    const res = await patchJson(m.id, { designation: pair('नवीन पद', 'New designation'), description: pair('नवीन वर्णन', 'New description') });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      name: m.name,
      category: m.category,
      designation: pair('नवीन पद', 'New designation'),
      description: pair('नवीन वर्णन', 'New description'),
      photoUrl: m.photoUrl,
    });
    expect(onDisk(m.photoUrl!)).toBe(true);
    m = res.body.data;
  });

  it('replaces the photo under a new URL and removes the old file', async () => {
    const old = m.photoUrl!;
    const res = await patchWithPhoto(m.id, { expectedUpdatedAt: m.updatedAt }, WEBP, 'second.webp');
    expect(res.status).toBe(200);
    const next = track(res.body.data as AdminMember);
    expect(next.photoUrl).not.toBe(old);
    expect(next.photoUrl).toMatch(/\.webp$/);
    expect(onDisk(next.photoUrl!)).toBe(true);
    expect(onDisk(old)).toBe(false);
    expect((await request(app).get(`${API}${old}`).set(auth(admin.token))).status).toBe(404);
    expect(next.designation).toEqual(pair('नवीन पद', 'New designation'));
    m = next;
  });

  it('refuses a save over a newer version (409) and changes nothing', async () => {
    const res = await patchJson(m.id, { name: 'Overwrite', expectedUpdatedAt: '2020-01-01T00:00:00.000Z' });
    expect(res.status).toBe(409);
    expect((await request(app).get(`${ADMIN_URL}/${m.id}`).set(auth(admin.token))).body.data.name).toBe(m.name);
  });

  it('keeps the record and its photo, and discards the new upload, when the database save fails', async () => {
    const write = jest.spyOn(documentStorage, 'write');
    jest.spyOn(auditService, 'recordInTx').mockRejectedValueOnce(new Error('simulated database failure'));
    const res = await patchWithPhoto(m.id, { name: 'Should not stick' }, PNG, 'third.png');
    expect(res.status).toBe(500);

    const attempted = write.mock.calls[0]![0] as string;
    expect(fs.existsSync(path.join(storageRoot(), ...attempted.split('/')))).toBe(false);
    const after = (await request(app).get(`${ADMIN_URL}/${m.id}`).set(auth(admin.token))).body.data as AdminMember;
    expect(after).toEqual(m);
    expect(onDisk(m.photoUrl!)).toBe(true);
  });

  it('keeps the record and its photo when the photo cannot be stored', async () => {
    jest.spyOn(documentStorage, 'write').mockRejectedValueOnce(new Error('disk full'));
    const res = await patchWithPhoto(m.id, { name: 'Should not stick' }, PNG, 'fourth.png');
    expect(res.status).toBe(500);
    expect(res.body.message).toBe('The photo could not be saved, so nothing was changed. Please try again.');
    expect((await request(app).get(`${ADMIN_URL}/${m.id}`).set(auth(admin.token))).body.data).toEqual(m);
  });

  it('removes the photo on request, and refuses removing and uploading at once', async () => {
    const both = await patchWithPhoto(m.id, { removePhoto: true }, PNG, 'x.png');
    expect(both.status).toBe(422);
    expect(details(both)).toEqual([{ field: 'body.removePhoto', message: 'Send a new photo or remove the current one, not both' }]);

    const old = m.photoUrl!;
    const res = await patchJson(m.id, { removePhoto: true });
    expect(res.status).toBe(200);
    expect(res.body.data.photoUrl).toBeNull();
    expect(onDisk(old)).toBe(false);
    m = res.body.data;
  });

  it('can clear a name back to the placeholder', async () => {
    const res = await patchJson(m.id, { name: null });
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBeNull();
  });
});

describe('Visibility, deletion and order', () => {
  it('a hidden member leaves the website; its photo is admin-only until shown again', async () => {
    const m = track((await createWithPhoto(member(20), PNG, 'hidden.png').expect(201)).body.data);
    const pubPhoto = `${API}/public/board-members/photos/${fileOf(m.photoUrl!)}`;

    await request(app).patch(`${ADMIN_URL}/${m.id}/status`).set(auth(admin.token)).send({ isActive: false }).expect(200);
    const pub = (await request(app).get(PUBLIC_URL)).body.data;
    expect(pub.members.map((c: { id: string }) => c.id)).not.toContain(m.id);
    expect((await request(app).get(pubPhoto)).status).toBe(404);
    expect((await request(app).get(`${API}${m.photoUrl}`).set(auth(admin.token))).status).toBe(200);
    expect((await list()).find((x) => x.id === m.id)!.isActive).toBe(false);

    await request(app).patch(`${ADMIN_URL}/${m.id}/status`).set(auth(admin.token)).send({ isActive: true }).expect(200);
    expect((await request(app).get(pubPhoto)).status).toBe(200);
  });

  it('deletes only the chosen member: soft-deleted, photo removed, everyone else untouched', async () => {
    const m = track((await createWithPhoto(member(21), PNG, 'delete-me.png').expect(201)).body.data);
    const others = (await list()).filter((x) => x.id !== m.id);

    const res = await request(app).delete(`${ADMIN_URL}/${m.id}`).set(auth(admin.token));
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Board member deleted successfully');

    expect(await list()).toEqual(others);
    expect((await request(app).get(PUBLIC_URL)).body.data.members.map((c: { id: string }) => c.id)).not.toContain(m.id);
    expect(onDisk(m.photoUrl!)).toBe(false);
    const [row] = await AppDataSource.query(`SELECT "isDelete", "isActive", "photoKey" FROM "board_members" WHERE "id" = $1`, [m.id]);
    expect(row).toEqual({ isDelete: true, isActive: false, photoKey: null });
    expect((await request(app).delete(`${ADMIN_URL}/${m.id}`).set(auth(admin.token))).status).toBe(404);
    expect(await auditCount('cms.board-member.delete')).toBeGreaterThanOrEqual(1);
  });

  it('reorders by id, and refuses a stale or duplicated list', async () => {
    const ids = (await list()).map((m) => m.id);
    const reversed = [...ids].reverse();
    const res = await request(app).put(`${ADMIN_URL}/order`).set(auth(admin.token)).send({ ids: reversed });
    expect(res.status).toBe(200);
    expect((res.body.data as AdminMember[]).map((m) => [m.id, m.displayOrder])).toEqual(reversed.map((id, i) => [id, i + 1]));
    const pubIds = (await request(app).get(PUBLIC_URL)).body.data.members.map((c: { id: string }) => c.id);
    expect(pubIds).toEqual(reversed.filter((id) => pubIds.includes(id)));

    const stale = await request(app).put(`${ADMIN_URL}/order`).set(auth(admin.token)).send({ ids: reversed.slice(1) });
    expect(stale.status).toBe(409);
    const dup = await request(app).put(`${ADMIN_URL}/order`).set(auth(admin.token)).send({ ids: [ids[0], ids[0]] });
    expect(dup.status).toBe(422);
  });
});

describe('Section settings', () => {
  const settings = () => request(app).get(`${ADMIN_URL}/settings`).set(auth(admin.token));
  const put = (payload: unknown) => request(app).put(`${ADMIN_URL}/settings`).set(auth(admin.token)).send(payload as object);

  it('updates the heading, subtitle and notice, and the website follows', async () => {
    const current = (await settings().expect(200)).body.data;
    const res = await put({
      heading: pair('नवीन शीर्षक', 'New heading'),
      subtitle: pair('नवीन उपशीर्षक', 'New subtitle'),
      noticeTitle: BLANK,
      noticeBody: pair('सूचना', 'Notice'),
      showNotice: true,
      expectedUpdatedAt: current.updatedAt,
    });
    expect(res.status).toBe(200);
    const pub = (await request(app).get(PUBLIC_URL)).body.data;
    expect(pub).toMatchObject({
      heading: pair('नवीन शीर्षक', 'New heading'),
      subtitle: pair('नवीन उपशीर्षक', 'New subtitle'),
      notice: { title: null, body: pair('सूचना', 'Notice') },
    });

    await put({ ...res.body.data, id: undefined, createdAt: undefined, updatedAt: undefined, showNotice: false }).expect(200);
    expect((await request(app).get(PUBLIC_URL)).body.data).toMatchObject({ notice: null });
  });

  it('requires notice text while the notice is shown, and refuses stale saves', async () => {
    const res = await put({ heading: pair('अ', 'A'), subtitle: BLANK, noticeTitle: BLANK, noticeBody: BLANK, showNotice: true });
    expect(res.status).toBe(422);
    expect(fieldsOf(res).sort()).toEqual(['body.noticeBody.en', 'body.noticeBody.mr']);

    const stale = await put({
      heading: pair('अ', 'A'),
      subtitle: BLANK,
      noticeTitle: BLANK,
      noticeBody: BLANK,
      showNotice: false,
      expectedUpdatedAt: '2020-01-01T00:00:00.000Z',
    });
    expect(stale.status).toBe(409);
  });
});

describe('Access control', () => {
  it('refuses every admin route without a session', async () => {
    expect((await request(app).get(ADMIN_URL)).status).toBe(401);
    expect((await request(app).post(ADMIN_URL).send(member(30))).status).toBe(401);
    expect((await request(app).post(ADMIN_URL).field('data', JSON.stringify(member(30))).attach('photo', PNG, 'a.png')).status).toBe(401);
  });

  it('a view-only administrator can read but not create, upload, edit, reorder or delete', async () => {
    const viewer = await actorWith(['cms-board.view']);
    const [first] = await list();
    expect((await request(app).get(ADMIN_URL).set(auth(viewer.token))).status).toBe(200);
    expect((await createJson(member(31), viewer.token)).status).toBe(403);
    expect((await createWithPhoto(member(31), PNG, 'a.png', viewer.token)).status).toBe(403);
    expect((await request(app).patch(`${ADMIN_URL}/${first!.id}`).set(auth(viewer.token)).send({ name: 'X' })).status).toBe(403);
    expect((await request(app).put(`${ADMIN_URL}/order`).set(auth(viewer.token)).send({ ids: [first!.id] })).status).toBe(403);
    expect((await request(app).delete(`${ADMIN_URL}/${first!.id}`).set(auth(viewer.token))).status).toBe(403);
    expect((await list()).some((m) => m.name === 'CMS Test Member 31')).toBe(false);
  });

  it('another CMS permission does not open this section', async () => {
    const other = await actorWith(['cms-hero.view', 'cms-hero.update']);
    expect((await request(app).get(ADMIN_URL).set(auth(other.token))).status).toBe(403);
  });
});
