import fs from 'fs';
import path from 'path';
import type { Express } from 'express';
import type { QueryRunner } from 'typeorm';
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
import { seedAdvisoryCommittee } from '../../../src/database/seeds/seed-advisory-committee';
import { documentStorage, storageRoot } from '../../../src/modules/students/documents/document-storage';
import { AdvisoryProfiles1796400000000 } from '../../../src/database/migrations/1796400000000-AdvisoryProfiles';
import { AdvisoryGroups1796700000000 } from '../../../src/database/migrations/1796700000000-AdvisoryGroups';

const ADMIN_URL = `${API}/cms/advisory-committee`;
const PUBLIC_URL = `${API}/public/advisory-committee`;

let app: Express;
let admin: TestActor;

interface Pair {
  mr: string;
  en: string;
}
interface List {
  mr: string[];
  en: string[];
}
interface AdminMember {
  id: string;
  name: Pair;
  designation: Pair;
  experience: Pair;
  administrativeRoles: List;
  keyAchievements: List;
  majorContributions: List;
  researchLeadership: List;
  education: List;
  photoUrl: string | null;
  displayOrder: number;
  isActive: boolean;
  groupId: string | null;
  group: { id: string; name: Pair } | null;
  updatedAt: string;
}
interface AdminGroup {
  id: string;
  name: Pair;
  displayOrder: number;
  isActive: boolean;
  memberCount: number;
  createdAt: string;
  updatedAt: string;
}
interface Detail {
  field: string;
  message: string;
}

const pair = (mr: string, en: string): Pair => ({ mr, en });
const BLANK = pair('', '');
const list = (mr: string[], en: string[]): List => ({ mr, en });
const EMPTY = list([], []);

/* Tiny but real images (1×1), so the bytes are what a browser would actually decode. */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
const WEBP = Buffer.from('UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAwA0JaQAA3AA/vuUAAA=', 'base64');

const member = (n: number, extra: Record<string, unknown> = {}) => ({
  name: pair(`चाचणी प्रशिक्षक ${n}`, `Advisory Test Trainer ${n}`),
  designation: pair(`मास्टर प्रशिक्षक, चाचणी संस्था ${n}`, `Master Trainer, Test Institute ${n}`),
  ...extra,
});

const details = (res: { body: { error: { details: Detail[] } } }) => res.body.error.details;

const listAll = async (): Promise<AdminMember[]> => (await request(app).get(ADMIN_URL).set(auth(admin.token)).expect(200)).body.data;
const publicFeed = async () => (await request(app).get(PUBLIC_URL).expect(200)).body.data;
const createJson = (payload: unknown, token = admin.token) =>
  request(app)
    .post(ADMIN_URL)
    .set(auth(token))
    .send(payload as object);
const createWithPhoto = (payload: unknown, file: Buffer, filename: string, token = admin.token) =>
  request(app).post(ADMIN_URL).set(auth(token)).field('data', JSON.stringify(payload)).attach('photo', file, { filename });
const patchJson = (id: string, payload: unknown, token = admin.token) =>
  request(app)
    .patch(`${ADMIN_URL}/${id}`)
    .set(auth(token))
    .send(payload as object);
const patchWithPhoto = (id: string, payload: unknown, file: Buffer, filename: string) =>
  request(app)
    .patch(`${ADMIN_URL}/${id}`)
    .set(auth(admin.token))
    .field('data', JSON.stringify(payload))
    .attach('photo', file, { filename });

/* Storage paths for the files this suite creates. It never removes anything it did not create. */
const created = new Set<string>();
const fileOf = (photoUrl: string) => photoUrl.split('/').pop()!;
const onDisk = (photoUrl: string) => fs.existsSync(path.join(storageRoot(), 'cms', 'advisory-committee', fileOf(photoUrl)));
const track = (m: AdminMember) => {
  if (m.photoUrl) created.add(`cms/advisory-committee/${fileOf(m.photoUrl)}`);
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

describe('Advisory Committee — before the seed', () => {
  it('the public feed is null (not an error) while the section is not configured', async () => {
    const res = await request(app).get(PUBLIC_URL);
    expect(res.status).toBe(200);
    expect(res.body.data).toBeNull();
    expect((await request(app).get(`${ADMIN_URL}/settings`).set(auth(admin.token))).status).toBe(404);
  });
});

describe('Advisory Committee seed', () => {
  it('seeds the heading and subtitle only, and is idempotent', async () => {
    expect(await seedAdvisoryCommittee(AppDataSource)).toEqual({ created: true });
    expect(await publicFeed()).toEqual({
      heading: pair('सारथी सल्लागार समिती', 'Sarthi Advisory Committee'),
      subtitle: pair(
        'कार्यक्रमाला मार्गदर्शन करणारे तज्ज्ञ प्रशिक्षक व सल्लागार.',
        'The expert trainers and advisors who guide the Sarthi programme.',
      ),
      members: [],
      groups: [],
    });
    /* No groups are seeded either. */
    expect((await request(app).get(`${ADMIN_URL}/groups`).set(auth(admin.token)).expect(200)).body.data).toEqual([]);
    expect(await listAll()).toEqual([]);

    expect(await seedAdvisoryCommittee(AppDataSource)).toEqual({ created: false });
    const [{ n }] = await AppDataSource.query(`SELECT count(*)::int AS n FROM "advisory_section"`);
    expect(n).toBe(1);
  });
});

describe('Members: create, read, edit, delete', () => {
  let m: AdminMember;

  it('creates from JSON, trims text, leaves the profile blank and appends to the end', async () => {
    await createJson(member(1)).expect(201);
    const res = await createJson(member(2, { name: pair('  चाचणी   प्रशिक्षक 2 ', ' Advisory  Test Trainer 2 ') }));
    expect(res.status).toBe(201);
    expect(res.body.message).toBe('Advisory committee member created successfully');
    m = res.body.data;
    expect(m).toMatchObject({
      name: pair('चाचणी प्रशिक्षक 2', 'Advisory Test Trainer 2'),
      designation: pair('मास्टर प्रशिक्षक, चाचणी संस्था 2', 'Master Trainer, Test Institute 2'),
      experience: BLANK,
      administrativeRoles: EMPTY,
      keyAchievements: EMPTY,
      majorContributions: EMPTY,
      researchLeadership: EMPTY,
      education: EMPTY,
      photoUrl: null,
      isActive: true,
      displayOrder: 2,
      groupId: null,
      group: null,
    });
    expect(Object.keys(m).sort()).toEqual(
      [
        'administrativeRoles',
        'createdAt',
        'designation',
        'displayOrder',
        'education',
        'experience',
        'group',
        'groupId',
        'id',
        'isActive',
        'keyAchievements',
        'majorContributions',
        'name',
        'photoUrl',
        'researchLeadership',
        'updatedAt',
      ].sort(),
    );
    expect((await request(app).get(`${ADMIN_URL}/${m.id}`).set(auth(admin.token)).expect(200)).body.data).toEqual(m);

    /* A blank profile is all nulls on the website, so the card shows no "View Profile" button. */
    const card = (await publicFeed()).members.find((c: { id: string }) => c.id === m.id);
    expect(card).toEqual({
      id: m.id,
      name: m.name,
      designation: m.designation,
      photoUrl: null,
      experience: null,
      administrativeRoles: null,
      keyAchievements: null,
      majorContributions: null,
      researchLeadership: null,
      education: null,
    });
    expect(await auditCount('cms.advisory-member.create')).toBe(2);
  });

  it('changes only the fields sent', async () => {
    const res = await patchJson(m.id, {
      experience: pair('शिवणकाम प्रशिक्षण', 'Tailoring training'),
      education: list(['बी.ए.'], ['B.A.']),
      expectedUpdatedAt: m.updatedAt,
    });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      name: m.name,
      designation: m.designation,
      experience: pair('शिवणकाम प्रशिक्षण', 'Tailoring training'),
      education: list(['बी.ए.'], ['B.A.']),
      keyAchievements: EMPTY,
    });
    m = res.body.data;
  });

  it('refuses a save over a newer version (409) and changes nothing', async () => {
    const res = await patchJson(m.id, { name: pair('बदल', 'Overwrite'), expectedUpdatedAt: '2020-01-01T00:00:00.000Z' });
    expect(res.status).toBe(409);
    expect((await request(app).get(`${ADMIN_URL}/${m.id}`).set(auth(admin.token))).body.data).toEqual(m);
  });

  it('refuses the same person in the same position (case-insensitive), on create and on edit', async () => {
    const dup = await createJson(
      member(1, { name: pair('दुसरे', 'ADVISORY TEST TRAINER 1'), designation: pair('दुसरे पद', 'master trainer, test institute 1') }),
    );
    expect(dup.status).toBe(409);
    expect(dup.body.message).toBe('ADVISORY TEST TRAINER 1 is already listed with the position "master trainer, test institute 1".');

    /* The same name in another position is a different listing. */
    await createJson(member(1, { designation: pair('संचालक', 'Director') })).expect(201);

    const rename = await patchJson(m.id, { name: pair('नाव', 'Advisory Test Trainer 1'), designation: pair('पद', 'director') });
    expect(rename.status).toBe(409);
    /* The profile is not part of the identity: editing it never trips the check. */
    await patchJson(m.id, { experience: pair('नवा अनुभव', 'New experience') }).expect(200);

    /* A blank position is a value too: the same name without one is listed once. */
    await createJson(member(3, { designation: BLANK })).expect(201);
    const blank = await createJson(member(3, { designation: BLANK }));
    expect(blank.status).toBe(409);
    expect(blank.body.message).toBe('Advisory Test Trainer 3 is already listed without a position.');
  });

  it('soft-deletes only the chosen member', async () => {
    const victim = (await createJson(member(4)).expect(201)).body.data as AdminMember;
    const others = (await listAll()).filter((x) => x.id !== victim.id);

    const res = await request(app).delete(`${ADMIN_URL}/${victim.id}`).set(auth(admin.token));
    expect(res.status).toBe(200);
    expect(res.body.data).toBeNull();
    expect(await listAll()).toEqual(others);
    const [row] = await AppDataSource.query(`SELECT "isDelete", "isActive" FROM "advisory_members" WHERE "id" = $1`, [victim.id]);
    expect(row).toEqual({ isDelete: true, isActive: false });
    expect((await request(app).delete(`${ADMIN_URL}/${victim.id}`).set(auth(admin.token))).status).toBe(404);

    /* A deleted member no longer blocks the same name and position. */
    await createJson(member(4)).expect(201);
    expect(await auditCount('cms.advisory-member.delete')).toBe(1);
  });
});

describe('Validation', () => {
  it('requires the name in both languages', async () => {
    const { name: _n, ...noName } = member(5);
    const missing = await createJson(noName);
    expect(missing.status).toBe(422);
    expect(details(missing)).toContainEqual({ field: 'body.name', message: 'Name is required' });

    const half = await createJson(member(5, { name: pair('   ', 'Advisory Test Trainer 5') }));
    expect(half.status).toBe(422);
    expect(details(half)).toEqual([{ field: 'body.name.mr', message: 'Name (Marathi) is required' }]);

    expect((await createJson(member(5, { name: null }))).status).toBe(422);
  });

  it('refuses a position filled in one language only', async () => {
    const mrOnly = await createJson(member(6, { designation: pair('फक्त मराठी', '') }));
    expect(mrOnly.status).toBe(422);
    expect(details(mrOnly)).toEqual([
      { field: 'body.designation.en', message: 'Position (English) is required when the Marathi text is filled in' },
    ]);
    const enOnly = await createJson(member(6, { designation: pair('', 'English only') }));
    expect(details(enOnly)).toEqual([
      { field: 'body.designation.mr', message: 'Position (Marathi) is required when the English text is filled in' },
    ]);
  });

  it('refuses over-long text, unknown keys, and a malformed id', async () => {
    /* The position line holds the role and the institution: up to 300 characters. */
    await createJson(member(7, { designation: pair('प'.repeat(300), 'P'.repeat(300)) })).expect(201);

    const res = await createJson(member(7, { designation: pair('x'.repeat(301), 'ok'), extra: true }));
    expect(res.status).toBe(422);
    expect(
      details(res)
        .map((d) => d.field)
        .sort(),
    ).toEqual(['body', 'body.designation.mr']);
    expect((await request(app).get(`${ADMIN_URL}/not-a-uuid`).set(auth(admin.token))).status).toBe(422);
    expect((await request(app).get(`${API}/public/advisory-committee/photos/..%2F..%2F.env`)).status).toBe(422);
  });

  it('refuses the removed organisation and expertise keys, on create and on edit', async () => {
    const create = await createJson(member(8, { organisation: pair('संस्था', 'Institute') }));
    expect(create.status).toBe(422);
    expect(details(create)).toEqual([{ field: 'body', message: expect.stringContaining('organisation') }]);

    const [first] = await listAll();
    const edit = await patchJson(first!.id, { expertise: pair('शिवणकाम', 'Tailoring') });
    expect(edit.status).toBe(422);
    expect(details(edit)).toEqual([{ field: 'body', message: expect.stringContaining('expertise') }]);
    expect((await request(app).get(`${ADMIN_URL}/${first!.id}`).set(auth(admin.token))).body.data).toEqual(first);
  });
});

describe('Profile ("View Profile")', () => {
  let m: AdminMember;
  const cardOf = async (id: string) => (await publicFeed()).members.find((c: { id: string }) => c.id === id);

  it('normalises each list — one item per line, trimmed, de-bulleted, blank lines dropped — and returns arrays', async () => {
    const res = await createJson(
      member(40, {
        experience: pair('  ३० वर्षांचा\n  अनुभव ', 'Thirty years\nin   engineering education.'),
        administrativeRoles: list(['• कुलगुरू', '', '  - अधिष्ठाता  '], ['•Vice Chancellor', '   ', '- Dean,  Faculty of Engineering']),
        keyAchievements: list(
          [],
          ['1. First item', '2) Second item\n3. Third item\r\n\n', '* Starred', '– Dashed', '-5 °C cold-chain trial', '1.5 lakh trainees'],
        ),
        education: list(['पीएच.डी.'], ['Ph.D., IIT Bombay']),
      }),
    );
    expect(res.status).toBe(201);
    m = res.body.data;
    /* The experience is one paragraph: line breaks become spaces. */
    expect(m.experience).toEqual(pair('३० वर्षांचा अनुभव', 'Thirty years in engineering education.'));
    expect(m.administrativeRoles).toEqual(list(['कुलगुरू', 'अधिष्ठाता'], ['Vice Chancellor', 'Dean, Faculty of Engineering']));
    /* Only a marker followed by a space is a bullet: "-5 °C" and "1.5 lakh" are text. */
    expect(m.keyAchievements).toEqual(
      list([], ['First item', 'Second item', 'Third item', 'Starred', 'Dashed', '-5 °C cold-chain trial', '1.5 lakh trainees']),
    );
    expect(m.majorContributions).toEqual(EMPTY);
    expect(m.researchLeadership).toEqual(EMPTY);
    expect(m.education).toEqual(list(['पीएच.डी.'], ['Ph.D., IIT Bombay']));

    /* Stored one item per line, '' when empty. */
    const [row] = await AppDataSource.query(
      `SELECT "keyAchievementsMr", "keyAchievementsEn", "majorContributionsEn" FROM "advisory_members" WHERE "id" = $1`,
      [m.id],
    );
    expect(row).toEqual({
      keyAchievementsMr: '',
      keyAchievementsEn: 'First item\nSecond item\nThird item\nStarred\nDashed\n-5 °C cold-chain trial\n1.5 lakh trainees',
      majorContributionsEn: '',
    });

    expect(await cardOf(m.id)).toEqual({
      id: m.id,
      name: m.name,
      designation: m.designation,
      photoUrl: null,
      experience: m.experience,
      administrativeRoles: m.administrativeRoles,
      keyAchievements: m.keyAchievements,
      majorContributions: null,
      researchLeadership: null,
      education: m.education,
    });
  });

  it('accepts a profile field in one language only, and the website gets it as stored (no fallback)', async () => {
    const res = await createJson(
      member(41, { experience: pair('फक्त मराठीत अनुभव', ''), researchLeadership: list([], ['Only in English']) }),
    );
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ experience: pair('फक्त मराठीत अनुभव', ''), researchLeadership: list([], ['Only in English']) });

    const card = await cardOf(res.body.data.id);
    expect(card.experience).toEqual({ mr: 'फक्त मराठीत अनुभव', en: null });
    expect(card.researchLeadership).toEqual(list([], ['Only in English']));
    expect(card.administrativeRoles).toBeNull();
  });

  it('an update replaces a whole list and leaves the others; an empty list or blank experience clears it', async () => {
    const res = await patchJson(m.id, { keyAchievements: list(['नवीन कामगिरी'], []) });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      keyAchievements: list(['नवीन कामगिरी'], []),
      administrativeRoles: m.administrativeRoles,
      education: m.education,
      experience: m.experience,
    });

    const cleared = await patchJson(m.id, { keyAchievements: EMPTY, administrativeRoles: list(['', ' • '], ['-']), experience: BLANK });
    expect(cleared.status).toBe(200);
    expect(cleared.body.data).toMatchObject({ keyAchievements: EMPTY, administrativeRoles: EMPTY, experience: BLANK });
    const card = await cardOf(m.id);
    expect(card).toMatchObject({ keyAchievements: null, administrativeRoles: null, experience: null, education: m.education });
  });

  it('refuses too many items, an over-long item (at its index), a non-text item and over-long experience', async () => {
    const res = await createJson(
      member(42, {
        keyAchievements: list(
          Array.from({ length: 31 }, (_, i) => `कामगिरी ${i + 1}`),
          ['ok', 'ok', 'ok', 'x'.repeat(401)],
        ),
        education: list(['ok', 7 as unknown as string], []),
        experience: pair('अ'.repeat(1001), ''),
      }),
    );
    expect(res.status).toBe(422);
    expect(details(res)).toEqual(
      expect.arrayContaining([
        { field: 'body.keyAchievements.mr', message: 'Key Achievements (Marathi) may have at most 30 items' },
        { field: 'body.keyAchievements.en.3', message: 'Key Achievements (English): each item must be at most 400 characters' },
        { field: 'body.education.mr.1', message: 'Education (Marathi): each item must be text' },
        { field: 'body.experience.mr', message: 'Experience (Marathi) must be at most 1000 characters' },
      ]),
    );
    expect(details(res)).toHaveLength(4);

    /* The limits count real items: 30 items padded with blank lines and bullets are fine, and 400 characters is. */
    const atLimit = Array.from({ length: 30 }, (_, i) => `• Item ${i + 1}\n`).concat(['', '  ']);
    const ok = await createJson(member(42, { keyAchievements: list([], atLimit), majorContributions: list(['y'.repeat(400)], []) }));
    expect(ok.status).toBe(201);
    expect(ok.body.data.keyAchievements.en).toHaveLength(30);
  });

  it('refuses a list sent as text, a list missing a language, and an unknown key inside a list', async () => {
    const res = await createJson(
      member(43, {
        keyAchievements: 'one\ntwo',
        administrativeRoles: { mr: ['x'] },
        education: { mr: [], en: [], extra: [] },
      }),
    );
    expect(res.status).toBe(422);
    expect(details(res)).toEqual(
      expect.arrayContaining([
        { field: 'body.keyAchievements', message: 'Key Achievements must have Marathi and English lists' },
        { field: 'body.administrativeRoles.en', message: 'Administrative Roles (English) is required' },
        { field: 'body.education', message: expect.stringContaining('extra') },
      ]),
    );
  });

  it('strips Marathi-numeral numbering too, but keeps a Marathi number that starts the text', async () => {
    const res = await createJson(
      member(44, {
        keyAchievements: list(['१. पहिली कामगिरी', '२) दुसरी कामगिरी', '१०. दहावी', '१.५ लाख प्रशिक्षणार्थी', '१२३४. चार अंकी'], []),
      }),
    );
    expect(res.status).toBe(201);
    /* Up to three digits followed by a space is numbering; "१.५" (no space) and four digits are text. */
    expect(res.body.data.keyAchievements.mr).toEqual([
      'पहिली कामगिरी',
      'दुसरी कामगिरी',
      'दहावी',
      '१.५ लाख प्रशिक्षणार्थी',
      '१२३४. चार अंकी',
    ]);
  });
});

describe('Request size (a full profile is large)', () => {
  /*
   * The largest profile the validator accepts, in Devanagari in BOTH languages (3 bytes a character in
   * UTF-8): five lists of 30 items of 400 characters, and 1000 characters of experience — about 366 KB.
   * Far above the general 100 KB JSON limit and the 64 KiB multipart field Board Members uses.
   */
  const fullList = () =>
    list(
      Array.from({ length: 30 }, () => 'क'.repeat(400)),
      Array.from({ length: 30 }, () => 'ख'.repeat(400)),
    );
  const fullProfile = (n: number) =>
    member(n, {
      experience: pair('अ'.repeat(1000), 'आ'.repeat(1000)),
      administrativeRoles: fullList(),
      keyAchievements: fullList(),
      majorContributions: fullList(),
      researchLeadership: fullList(),
      education: fullList(),
    });
  const TOO_LONG = 'The profile is too long to save in one request; shorten the lists';

  it('saves a maximal profile as JSON and as multipart with a photo', async () => {
    expect(Buffer.byteLength(JSON.stringify(fullProfile(50)))).toBeGreaterThan(350_000);

    const json = await createJson(fullProfile(50));
    expect(json.status).toBe(201);
    expect(json.body.data.education.en).toHaveLength(30);
    expect(json.body.data.education.en[29]).toHaveLength(400);
    expect(json.body.data.experience.mr).toHaveLength(1000);

    const multipart = await createWithPhoto(fullProfile(51), PNG, 'full.png');
    expect(multipart.status).toBe(201);
    track(multipart.body.data);
    expect(multipart.body.data.keyAchievements.mr).toHaveLength(30);
    expect(multipart.body.data.photoUrl).not.toBeNull();

    /* An edit sending the whole profile goes through the same limits. */
    const { name: _n, designation: _d, ...profile } = fullProfile(50);
    await patchJson(json.body.data.id, { ...profile, expectedUpdatedAt: json.body.data.updatedAt }).expect(200);
  });

  it('an over-limit multipart body gets a clear 422; an over-limit JSON body is a 413', async () => {
    /* 180 000 Devanagari characters are 540 000 bytes: past the 512 KiB the section allows. */
    const huge = member(52, { experience: pair('अ'.repeat(180_000), '') });
    const multipart = await createWithPhoto(huge, PNG, 'huge.png');
    expect(multipart.status).toBe(422);
    expect(details(multipart)).toEqual([{ field: 'body.data', message: TOO_LONG }]);

    expect((await createJson(huge)).status).toBe(413);
    expect((await listAll()).some((x) => x.name.en === 'Advisory Test Trainer 52')).toBe(false);
  });
});

describe('Photos', () => {
  let m: AdminMember;

  it('stores an uploaded photo and serves it to the admin and the website', async () => {
    const res = await createWithPhoto(member(10), PNG, 'photo.png');
    expect(res.status).toBe(201);
    m = track(res.body.data);
    expect(m.photoUrl).toMatch(/^\/cms\/advisory-committee\/photos\/[0-9a-f-]{36}\.png$/);
    expect(onDisk(m.photoUrl!)).toBe(true);

    const adminImg = await request(app).get(`${API}${m.photoUrl}`).set(auth(admin.token));
    expect(adminImg.status).toBe(200);
    expect(adminImg.headers['content-type']).toBe('image/png');
    expect(Buffer.compare(adminImg.body as Buffer, PNG)).toBe(0);

    const card = (await publicFeed()).members.find((c: { id: string }) => c.id === m.id);
    expect(card.photoUrl).toBe(`/public/advisory-committee/photos/${fileOf(m.photoUrl!)}`);
    const pubImg = await request(app).get(`${API}${card.photoUrl}`);
    expect(pubImg.status).toBe(200);
    expect(pubImg.headers['cache-control']).toBe('public, max-age=86400');
    expect(pubImg.headers['cross-origin-resource-policy']).toBe('cross-origin');
  });

  it('refuses a file whose name does not match its content', async () => {
    const res = await createWithPhoto(member(11), PNG, 'photo.jpg');
    expect(res.status).toBe(422);
    expect(details(res)).toEqual([
      { field: 'photo', message: 'The file name does not match its content: this is a PNG image, so name it .png' },
    ]);
  });

  it('replaces the photo under a new URL and removes the old file', async () => {
    const old = m.photoUrl!;
    const res = await patchWithPhoto(m.id, {}, WEBP, 'second.webp');
    expect(res.status).toBe(200);
    const next = track(res.body.data);
    expect(next.photoUrl).toMatch(/\.webp$/);
    expect(onDisk(next.photoUrl!)).toBe(true);
    expect(onDisk(old)).toBe(false);
    expect((await request(app).get(`${API}${old}`).set(auth(admin.token))).status).toBe(404);
    m = next;
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
  });

  it('removes a deleted member’s photo from storage', async () => {
    const d = track((await createWithPhoto(member(12), PNG, 'delete-me.png').expect(201)).body.data);
    await request(app).delete(`${ADMIN_URL}/${d.id}`).set(auth(admin.token)).expect(200);
    expect(onDisk(d.photoUrl!)).toBe(false);
  });
});

describe('Visibility and order', () => {
  it('a hidden member leaves the website; its photo is admin-only until shown again', async () => {
    const m = track((await createWithPhoto(member(20), PNG, 'hidden.png').expect(201)).body.data);
    const pubPhoto = `${API}/public/advisory-committee/photos/${fileOf(m.photoUrl!)}`;

    const hidden = await request(app).patch(`${ADMIN_URL}/${m.id}/status`).set(auth(admin.token)).send({ isActive: false });
    expect(hidden.status).toBe(200);
    expect(hidden.body.data.isActive).toBe(false);
    expect((await publicFeed()).members.map((c: { id: string }) => c.id)).not.toContain(m.id);
    expect((await request(app).get(pubPhoto)).status).toBe(404);
    expect((await request(app).get(`${API}${m.photoUrl}`).set(auth(admin.token))).status).toBe(200);
    expect((await listAll()).find((x) => x.id === m.id)!.isActive).toBe(false);

    await request(app).patch(`${ADMIN_URL}/${m.id}/status`).set(auth(admin.token)).send({ isActive: true }).expect(200);
    expect((await publicFeed()).members.map((c: { id: string }) => c.id)).toContain(m.id);
    expect((await request(app).get(pubPhoto)).status).toBe(200);
  });

  it('reorders by id, and refuses a stale or duplicated list', async () => {
    const ids = (await listAll()).map((m) => m.id);
    const reversed = [...ids].reverse();
    const res = await request(app).put(`${ADMIN_URL}/order`).set(auth(admin.token)).send({ ids: reversed });
    expect(res.status).toBe(200);
    expect((res.body.data as AdminMember[]).map((m) => [m.id, m.displayOrder])).toEqual(reversed.map((id, i) => [id, i + 1]));
    expect((await publicFeed()).members.map((c: { id: string }) => c.id)).toEqual(reversed);

    expect(
      (
        await request(app)
          .put(`${ADMIN_URL}/order`)
          .set(auth(admin.token))
          .send({ ids: reversed.slice(1) })
      ).status,
    ).toBe(409);
    expect(
      (
        await request(app)
          .put(`${ADMIN_URL}/order`)
          .set(auth(admin.token))
          .send({ ids: [ids[0], ids[0]] })
      ).status,
    ).toBe(422);
  });
});

describe('Groups', () => {
  const GROUPS_URL = `${ADMIN_URL}/groups`;
  const AMRUT = pair(
    'महाराष्ट्र संशोधन, उन्नती व प्रशिक्षण प्रबोधिनी (अमृत)',
    'Academy of Maharashtra Research, Upliftment and Training (AMRUT)',
  );
  const COEP = pair('सीओईपी तंत्रज्ञान विद्यापीठ', 'COEP Technological University');
  const postGroup = (payload: unknown, token = admin.token) =>
    request(app)
      .post(GROUPS_URL)
      .set(auth(token))
      .send(payload as object);
  const patchGroup = (id: string, payload: unknown) =>
    request(app)
      .patch(`${GROUPS_URL}/${id}`)
      .set(auth(admin.token))
      .send(payload as object);
  const listGroups = async (): Promise<AdminGroup[]> => (await request(app).get(GROUPS_URL).set(auth(admin.token)).expect(200)).body.data;
  const groupOf = async (id: string): Promise<AdminGroup> => (await listGroups()).find((g) => g.id === id)!;
  const ids = (cards: { id: string }[]) => cards.map((c) => c.id);

  let amrut: AdminGroup;
  let coep: AdminGroup;
  let empty: AdminGroup;
  /* a, b (hidden) in AMRUT; c (with a photo) in COEP; d in no group. */
  let a: AdminMember;
  let b: AdminMember;
  let c: AdminMember;
  let d: AdminMember;

  it('creates groups at the end of the list and refuses a second group of the same name', async () => {
    const res = await postGroup({ name: AMRUT });
    expect(res.status).toBe(201);
    expect(res.body.message).toBe('Advisory committee group created successfully');
    amrut = res.body.data;
    expect(amrut).toMatchObject({ name: AMRUT, displayOrder: 1, isActive: true, memberCount: 0 });
    expect(Object.keys(amrut).sort()).toEqual(['createdAt', 'displayOrder', 'id', 'isActive', 'memberCount', 'name', 'updatedAt']);

    coep = (await postGroup({ name: COEP }).expect(201)).body.data;
    empty = (await postGroup({ name: pair('रिकामा गट', 'Empty group'), isActive: true }).expect(201)).body.data;
    expect([coep.displayOrder, empty.displayOrder]).toEqual([2, 3]);

    const dup = await postGroup({ name: pair('दुसरे नाव', '  academy of maharashtra research, upliftment and training (amrut) ') });
    expect(dup.status).toBe(409);
    expect(dup.body.message).toBe('A group named "academy of maharashtra research, upliftment and training (amrut)" already exists.');

    expect(await listGroups()).toEqual([amrut, coep, empty]);
    expect((await request(app).get(`${GROUPS_URL}/${coep.id}`).set(auth(admin.token)).expect(200)).body.data).toEqual(coep);
    expect(await auditCount('cms.advisory-group.create')).toBe(3);
  });

  it('validates the group name and the request', async () => {
    const half = await postGroup({ name: pair('फक्त मराठी', '  ') });
    expect(half.status).toBe(422);
    expect(details(half)).toEqual([{ field: 'body.name.en', message: 'Group name (English) is required' }]);

    const long = await postGroup({ name: pair('ग'.repeat(201), 'G'.repeat(200)), displayOrder: 1 });
    expect(long.status).toBe(422);
    expect(
      details(long)
        .map((x) => x.field)
        .sort(),
    ).toEqual(['body', 'body.name.mr']);
    expect((await postGroup({})).status).toBe(422);

    expect((await request(app).get(`${GROUPS_URL}/not-a-uuid`).set(auth(admin.token))).status).toBe(422);
    expect((await request(app).get(`${GROUPS_URL}/00000000-0000-4000-8000-000000000000`).set(auth(admin.token))).status).toBe(404);
    expect((await listGroups()).length).toBe(3);
  });

  it('files members under a group, and refuses a group that does not exist', async () => {
    a = (await createJson(member(60, { groupId: amrut.id })).expect(201)).body.data;
    expect(a).toMatchObject({ groupId: amrut.id, group: { id: amrut.id, name: AMRUT } });
    b = (await createJson(member(61, { groupId: amrut.id, isActive: false })).expect(201)).body.data;
    c = track((await createWithPhoto(member(62, { groupId: coep.id }), PNG, 'grouped.png').expect(201)).body.data);
    d = (await createJson(member(63, { groupId: null })).expect(201)).body.data;
    expect(d).toMatchObject({ groupId: null, group: null });
    expect((await request(app).get(`${ADMIN_URL}/${c.id}`).set(auth(admin.token))).body.data.group).toEqual({ id: coep.id, name: COEP });

    const missing = await createJson(member(64, { groupId: '00000000-0000-4000-8000-000000000000' }));
    expect(missing.status).toBe(422);
    expect(details(missing)).toEqual([{ field: 'body.groupId', message: 'Choose an existing group' }]);
    expect(details(await createJson(member(64, { groupId: 'amrut' })))).toEqual([
      { field: 'body.groupId', message: 'Choose an existing group' },
    ]);
    expect((await listAll()).some((x) => x.name.en === 'Advisory Test Trainer 64')).toBe(false);

    /* Moving between groups, and out of any, is an ordinary partial update. */
    const moved = await patchJson(d.id, { groupId: empty.id });
    expect(moved.body.data).toMatchObject({ groupId: empty.id, group: { id: empty.id, name: empty.name }, name: d.name });
    const out = await patchJson(d.id, { groupId: null });
    expect(out.body.data).toMatchObject({ groupId: null, group: null });
    d = out.body.data;
    expect((await patchJson(d.id, { groupId: '00000000-0000-4000-8000-000000000000' })).status).toBe(422);

    /* Hidden members count: they are still in the group. */
    expect((await groupOf(amrut.id)).memberCount).toBe(2);
    expect((await groupOf(coep.id)).memberCount).toBe(1);
    expect((await groupOf(empty.id)).memberCount).toBe(0);
    expect((await listAll()).find((x) => x.id === b.id)).toMatchObject({ groupId: amrut.id, isActive: false });
  });

  it('the website lists ungrouped members first, then each visible group with its visible members', async () => {
    const feed = await publicFeed();
    expect(Object.keys(feed).sort()).toEqual(['groups', 'heading', 'members', 'subtitle']);
    expect(ids(feed.members)).toContain(d.id);
    for (const grouped of [a, b, c]) expect(ids(feed.members)).not.toContain(grouped.id);
    /* The empty group is left out; the hidden member b is in no list. */
    expect(feed.groups.map((g: { id: string; name: Pair; members: { id: string }[] }) => [g.id, g.name, ids(g.members)])).toEqual([
      [amrut.id, AMRUT, [a.id]],
      [coep.id, COEP, [c.id]],
    ]);
    expect(Object.keys(feed.groups[0]).sort()).toEqual(['id', 'members', 'name']);
    /* A grouped card is the same card as an ungrouped one. */
    expect(feed.groups[0].members[0]).toEqual({
      id: a.id,
      name: a.name,
      designation: a.designation,
      photoUrl: null,
      experience: null,
      administrativeRoles: null,
      keyAchievements: null,
      majorContributions: null,
      researchLeadership: null,
      education: null,
    });
    expect(feed.groups[1].members[0].photoUrl).toBe(`/public/advisory-committee/photos/${fileOf(c.photoUrl!)}`);
  });

  it('a hidden group hides its heading and its members (and their photos) until shown again', async () => {
    const pubPhoto = `${API}/public/advisory-committee/photos/${fileOf(c.photoUrl!)}`;
    const hidden = await request(app).patch(`${GROUPS_URL}/${coep.id}/status`).set(auth(admin.token)).send({ isActive: false });
    expect(hidden.status).toBe(200);
    expect(hidden.body.data).toMatchObject({ isActive: false, memberCount: 1 });

    const feed = await publicFeed();
    expect(feed.groups.map((g: { id: string }) => g.id)).toEqual([amrut.id]);
    expect(ids(feed.members)).not.toContain(c.id);
    expect((await request(app).get(pubPhoto)).status).toBe(404);
    expect((await request(app).get(`${API}${c.photoUrl}`).set(auth(admin.token))).status).toBe(200);
    expect((await groupOf(coep.id)).isActive).toBe(false);

    await request(app).patch(`${GROUPS_URL}/${coep.id}/status`).set(auth(admin.token)).send({ isActive: true }).expect(200);
    expect((await publicFeed()).groups.map((g: { id: string }) => g.id)).toEqual([amrut.id, coep.id]);
    expect((await request(app).get(pubPhoto)).status).toBe(200);
    expect(await auditCount('cms.advisory-group.status')).toBe(2);
  });

  it('edits a group (partially, refusing a stale save or a taken name) and reorders the groups', async () => {
    const current = await groupOf(coep.id);
    const renamed = pair('सीओईपी तंत्रज्ञान विद्यापीठ, पुणे', 'COEP Technological University, Pune');
    const res = await patchGroup(coep.id, { name: renamed, expectedUpdatedAt: current.updatedAt });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ name: renamed, isActive: true, memberCount: 1, displayOrder: 2 });
    expect((await request(app).get(`${ADMIN_URL}/${c.id}`).set(auth(admin.token))).body.data.group.name).toEqual(renamed);

    const stale = await patchGroup(coep.id, { isActive: false, expectedUpdatedAt: current.updatedAt });
    expect(stale.status).toBe(409);
    expect(stale.body.message).toBe(
      'This group was changed after you opened it. Reload to see the latest version, then make your changes again.',
    );
    expect((await patchGroup(coep.id, { name: pair('अ', 'EMPTY GROUP') })).status).toBe(409);
    expect((await patchGroup(coep.id, { displayOrder: 1 })).status).toBe(422);
    /* Its own name, in other capitals, is not a clash. */
    await patchGroup(coep.id, { name: pair(renamed.mr, renamed.en.toUpperCase()) }).expect(200);

    const reordered = await request(app)
      .put(`${GROUPS_URL}/order`)
      .set(auth(admin.token))
      .send({ ids: [empty.id, coep.id, amrut.id] });
    expect(reordered.status).toBe(200);
    expect((reordered.body.data as AdminGroup[]).map((g) => [g.id, g.displayOrder])).toEqual([
      [empty.id, 1],
      [coep.id, 2],
      [amrut.id, 3],
    ]);
    expect((await publicFeed()).groups.map((g: { id: string }) => g.id)).toEqual([coep.id, amrut.id]);

    const put = (body: unknown) =>
      request(app)
        .put(`${GROUPS_URL}/order`)
        .set(auth(admin.token))
        .send(body as object);
    expect((await put({ ids: [empty.id, coep.id] })).status).toBe(409);
    expect((await put({ ids: [empty.id, empty.id, coep.id] })).status).toBe(422);
    expect(await auditCount('cms.advisory-groups.reorder')).toBe(1);
  });

  it('deleting a group keeps its members, now ungrouped, and frees its name', async () => {
    const res = await request(app).delete(`${GROUPS_URL}/${amrut.id}`).set(auth(admin.token));
    expect(res.status).toBe(200);
    /* Both members — the hidden one too. */
    expect(res.body.data).toEqual({ membersUngrouped: 2 });

    const all = await listAll();
    expect(all.find((x) => x.id === a.id)).toMatchObject({ groupId: null, group: null, isActive: true });
    expect(all.find((x) => x.id === b.id)).toMatchObject({ groupId: null, group: null, isActive: false });
    const feed = await publicFeed();
    expect(ids(feed.members)).toContain(a.id);
    expect(ids(feed.members)).not.toContain(b.id);
    expect(feed.groups.map((g: { id: string }) => g.id)).toEqual([coep.id]);

    expect((await listGroups()).map((g) => g.id)).toEqual([empty.id, coep.id]);
    expect((await request(app).get(`${GROUPS_URL}/${amrut.id}`).set(auth(admin.token))).status).toBe(404);
    expect((await request(app).delete(`${GROUPS_URL}/${amrut.id}`).set(auth(admin.token))).status).toBe(404);
    const [row] = await AppDataSource.query(`SELECT "isDelete", "isActive" FROM "advisory_groups" WHERE "id" = $1`, [amrut.id]);
    expect(row).toEqual({ isDelete: true, isActive: false });

    /* A deleted group cannot be chosen, and its name may be used again. */
    const refile = await patchJson(a.id, { groupId: amrut.id });
    expect(details(refile)).toEqual([{ field: 'body.groupId', message: 'Choose an existing group' }]);
    await postGroup({ name: AMRUT }).expect(201);
    expect(await auditCount('cms.advisory-group.delete')).toBe(1);

    /* A deleted member no longer counts towards its group. */
    await request(app).delete(`${ADMIN_URL}/${c.id}`).set(auth(admin.token)).expect(200);
    expect((await groupOf(coep.id)).memberCount).toBe(0);
    expect((await publicFeed()).groups).toEqual([]);
  });

  it('a view-only administrator can read the groups but not change them', async () => {
    const viewer = await actorWith(['cms-advisory.view']);
    expect((await request(app).get(GROUPS_URL).set(auth(viewer.token))).status).toBe(200);
    expect((await request(app).get(`${GROUPS_URL}/${coep.id}`).set(auth(viewer.token))).status).toBe(200);
    expect((await postGroup({ name: pair('नवा', 'New') }, viewer.token)).status).toBe(403);
    expect(
      (
        await request(app)
          .patch(`${GROUPS_URL}/${coep.id}`)
          .set(auth(viewer.token))
          .send({ name: pair('अ', 'A') })
      ).status,
    ).toBe(403);
    expect((await request(app).patch(`${GROUPS_URL}/${coep.id}/status`).set(auth(viewer.token)).send({ isActive: false })).status).toBe(
      403,
    );
    expect(
      (
        await request(app)
          .put(`${GROUPS_URL}/order`)
          .set(auth(viewer.token))
          .send({ ids: [coep.id] })
      ).status,
    ).toBe(403);
    expect((await request(app).delete(`${GROUPS_URL}/${coep.id}`).set(auth(viewer.token))).status).toBe(403);
    expect((await request(app).get(GROUPS_URL)).status).toBe(401);
  });
});

describe('Section settings', () => {
  const put = (payload: unknown) =>
    request(app)
      .put(`${ADMIN_URL}/settings`)
      .set(auth(admin.token))
      .send(payload as object);

  it('updates the heading and subtitle, and the website follows', async () => {
    const current = (await request(app).get(`${ADMIN_URL}/settings`).set(auth(admin.token)).expect(200)).body.data;
    expect(Object.keys(current).sort()).toEqual(['createdAt', 'heading', 'id', 'subtitle', 'updatedAt']);

    const res = await put({ heading: pair('नवीन शीर्षक', 'New heading'), subtitle: BLANK, expectedUpdatedAt: current.updatedAt });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ heading: pair('नवीन शीर्षक', 'New heading'), subtitle: BLANK });
    expect(await publicFeed()).toMatchObject({ heading: pair('नवीन शीर्षक', 'New heading'), subtitle: null });
    expect(await auditCount('cms.advisory-section.update')).toBe(1);
  });

  it('requires the heading in both languages, and refuses a stale save', async () => {
    const res = await put({ heading: pair('शीर्षक', ''), subtitle: BLANK });
    expect(res.status).toBe(422);
    expect(details(res)).toEqual([{ field: 'body.heading.en', message: 'Heading (English) is required' }]);

    const stale = await put({ heading: pair('अ', 'A'), subtitle: BLANK, expectedUpdatedAt: '2020-01-01T00:00:00.000Z' });
    expect(stale.status).toBe(409);
    expect((await publicFeed()).heading).toEqual(pair('नवीन शीर्षक', 'New heading'));
  });
});

describe('Access control', () => {
  it('refuses every admin route without a session', async () => {
    expect((await request(app).get(ADMIN_URL)).status).toBe(401);
    expect((await request(app).post(ADMIN_URL).send(member(30))).status).toBe(401);
  });

  it('a view-only administrator can read but not create, upload, edit, reorder or delete', async () => {
    const viewer = await actorWith(['cms-advisory.view']);
    const [first] = await listAll();
    expect((await request(app).get(ADMIN_URL).set(auth(viewer.token))).status).toBe(200);
    expect((await request(app).get(`${ADMIN_URL}/settings`).set(auth(viewer.token))).status).toBe(200);
    expect((await createJson(member(31), viewer.token)).status).toBe(403);
    expect((await createWithPhoto(member(31), PNG, 'a.png', viewer.token)).status).toBe(403);
    expect((await patchJson(first!.id, { name: pair('क', 'X') }, viewer.token)).status).toBe(403);
    expect(
      (
        await request(app)
          .put(`${ADMIN_URL}/settings`)
          .set(auth(viewer.token))
          .send({ heading: pair('अ', 'A'), subtitle: BLANK })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .put(`${ADMIN_URL}/order`)
          .set(auth(viewer.token))
          .send({ ids: [first!.id] })
      ).status,
    ).toBe(403);
    expect((await request(app).delete(`${ADMIN_URL}/${first!.id}`).set(auth(viewer.token))).status).toBe(403);
    expect((await listAll()).some((m) => m.name.en === 'Advisory Test Trainer 31')).toBe(false);
  });

  it('the Board Members permission does not open this section', async () => {
    const other = await actorWith(['cms-board.view', 'cms-board.update']);
    expect((await request(app).get(ADMIN_URL).set(auth(other.token))).status).toBe(403);
  });
});

/* Runs one statement under a savepoint and reports the PostgreSQL error code, or null when it succeeded. */
const attempt = async (qr: QueryRunner, sql: string, params: unknown[] = []): Promise<string | null> => {
  await qr.query('SAVEPOINT attempt');
  try {
    await qr.query(sql, params);
    return null;
  } catch (e) {
    const err = e as { code?: string; driverError?: { code?: string } };
    return err.driverError?.code ?? err.code ?? 'unknown';
  } finally {
    await qr.query('ROLLBACK TO SAVEPOINT attempt');
  }
};

describe('migration 1796400000000 (profiles)', () => {
  const columns = async (qr: QueryRunner): Promise<string[]> =>
    (await qr.query(`SELECT column_name AS c FROM information_schema.columns WHERE table_name = 'advisory_members' ORDER BY c`)).map(
      (r: { c: string }) => r.c,
    );
  const indexes = async (qr: QueryRunner): Promise<string[]> =>
    (await qr.query(`SELECT indexname AS i FROM pg_indexes WHERE tablename = 'advisory_members'`)).map((r: { i: string }) => r.i);

  /*
   * down() over the rows the tests above left (and a few awkward ones), then up() over rows in the old
   * shape — all inside a transaction that is always rolled back, so the shared test schema is left
   * exactly as the migrations built it whatever happens here.
   */
  it('down() keeps working rows; up() folds organisation into the position and expertise into the experience', async () => {
    const migration = new AdvisoryProfiles1796400000000();
    const qr = AppDataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();
    try {
      /* The same person in three positions (one blank), one of them 300 characters long. */
      const insertNew = (order: number, desMr: string, desEn: string, expMr: string, expEn: string) =>
        qr.query(
          `INSERT INTO "advisory_members" ("nameMr", "nameEn", "designationMr", "designationEn", "experienceMr", "experienceEn",
             "keyAchievementsEn", "displayOrder")
           VALUES ('स्थलांतर', 'Migration Person', $1, $2, $3, $4, 'One\nTwo', $5) RETURNING "id"`,
          [desMr, desEn, expMr, expEn, order],
        );
      const [blank] = await insertNew(900, '', '', '', '');
      const [short] = await insertNew(901, 'पद अ', 'Position A', 'अनुभव', 'Experience');
      const [long] = await insertNew(902, 'क'.repeat(300), 'L'.repeat(300), '', 'English only');
      /* Differs from `long` only after the 200th character, so "position cut to 200" alone would clash. */
      const [long2] = await insertNew(903, `${'क'.repeat(299)}ख`, `${'L'.repeat(250)}${'M'.repeat(50)}`, '', '');

      await migration.down(qr);
      expect(await columns(qr)).toEqual(expect.arrayContaining(['organisationMr', 'organisationEn', 'expertiseMr', 'expertiseEn']));
      expect(await columns(qr)).not.toContain('keyAchievementsEn');
      expect(await indexes(qr)).toContain('UQ_advisory_members_name_organisation');
      const back = async (id: string) =>
        (
          await qr.query(
            `SELECT "designationMr", "designationEn", "organisationMr", "organisationEn", "expertiseMr", "expertiseEn"
             FROM "advisory_members" WHERE "id" = $1`,
            [id],
          )
        )[0];
      /*
       * The blank-position row keeps the blank organisation; the others take their position, numbered by
       * rank, so the old index holds even for positions that are the same in their first 200 characters.
       */
      expect(await back(blank.id)).toEqual({
        designationMr: '',
        designationEn: '',
        organisationMr: '',
        organisationEn: '',
        expertiseMr: '',
        expertiseEn: '',
      });
      expect(await back(short.id)).toEqual({
        designationMr: 'पद अ',
        designationEn: 'Position A',
        organisationMr: 'पद अ (2)',
        organisationEn: 'Position A (2)',
        expertiseMr: 'अनुभव',
        expertiseEn: 'Experience',
      });
      /* Cut to the old lengths; an experience in one language only cannot become an expertise pair. */
      expect(await back(long.id)).toEqual({
        designationMr: 'क'.repeat(150),
        designationEn: 'L'.repeat(150),
        organisationMr: `${'क'.repeat(196)} (3)`,
        organisationEn: `${'L'.repeat(196)} (3)`,
        expertiseMr: '',
        expertiseEn: '',
      });
      expect(await back(long2.id)).toMatchObject({ organisationMr: `${'क'.repeat(196)} (4)`, organisationEn: `${'L'.repeat(196)} (4)` });

      /* Rows as the previous version stored them. */
      await qr.query(`DELETE FROM "advisory_members"`);
      const insertOld = async (
        nameEn: string,
        des: [string, string],
        org: [string, string],
        exp: [string, string],
        order: number,
        isDelete = false,
      ): Promise<string> =>
        (
          await qr.query(
            `INSERT INTO "advisory_members" ("nameMr", "nameEn", "designationMr", "designationEn", "organisationMr", "organisationEn",
               "expertiseMr", "expertiseEn", "displayOrder", "isDelete")
             VALUES ('नाव', $1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING "id"`,
            [nameEn, ...des, ...org, ...exp, order, isDelete],
          )
        )[0].id;
      const ids = {
        both: await insertOld('Both', ['मास्टर प्रशिक्षक', 'Master Trainer'], ['सीओईपी', 'COEP Pune'], ['शिवणकाम', 'Tailoring'], 1),
        orgOnly: await insertOld('Org Only', ['', ''], ['संस्था', 'Institute'], ['', ''], 2),
        desOnly: await insertOld('Des Only', ['पद', 'Post'], ['', ''], ['', ''], 3),
        tooLong: await insertOld(
          'Too Long',
          ['ड'.repeat(150), 'D'.repeat(150)],
          ['स'.repeat(200), 'S'.repeat(200)],
          ['कौशल्य', 'Skill'],
          4,
        ),
        tooLongNoExp: await insertOld('Too Long 2', ['ड'.repeat(150), 'E'.repeat(150)], ['त'.repeat(200), 'T'.repeat(200)], ['', ''], 5),
        clashFirst: await insertOld('Clash', ['प्रशिक्षक', 'Trainer'], ['', ''], ['', ''], 6),
        clashSecond: await insertOld('Clash', ['', ''], ['प्रशिक्षक', 'trainer'], ['', ''], 7),
        clashDeleted: await insertOld('Clash', ['', ''], ['प्रशिक्षक', 'TRAINER'], ['', ''], 8, true),
        /* Already reads "Trainer (2)" after the fold, so the numbering must skip to (3). */
        clashTaken: await insertOld('Clash', ['', ''], ['प्रशिक्षक (2)', 'TRAINER (2)'], ['', ''], 9),
        /* Both fold to the same 300-character position; the numbered one is cut to stay within 300. */
        longClashFirst: await insertOld(
          'Long Clash',
          [`${'अ'.repeat(100)}, ${'ब'.repeat(48)}`, `${'A'.repeat(100)}, ${'B'.repeat(48)}`],
          ['क'.repeat(148), 'C'.repeat(148)],
          ['', ''],
          10,
        ),
        longClashSecond: await insertOld(
          'Long Clash',
          ['अ'.repeat(100), 'A'.repeat(100)],
          [`${'ब'.repeat(48)}, ${'क'.repeat(148)}`, `${'B'.repeat(48)}, ${'C'.repeat(148)}`],
          ['', ''],
          11,
        ),
      };

      await migration.up(qr);
      const cols = await columns(qr);
      expect(cols.filter((c) => /^(organisation|expertise)/.test(c))).toEqual([]);
      expect(cols).toEqual(
        expect.arrayContaining([
          'experienceMr',
          'experienceEn',
          'administrativeRolesMr',
          'keyAchievementsEn',
          'majorContributionsMr',
          'researchLeadershipEn',
          'educationMr',
        ]),
      );
      expect(await indexes(qr)).toContain('UQ_advisory_members_name_designation');
      expect(await indexes(qr)).not.toContain('UQ_advisory_members_name_organisation');

      const row = async (id: string) =>
        (
          await qr.query(
            `SELECT "designationMr", "designationEn", "experienceMr", "experienceEn", "keyAchievementsMr", "educationEn"
             FROM "advisory_members" WHERE "id" = $1`,
            [id],
          )
        )[0];
      const lists = { keyAchievementsMr: '', educationEn: '' };
      expect(await row(ids.both)).toEqual({
        designationMr: 'मास्टर प्रशिक्षक, सीओईपी',
        designationEn: 'Master Trainer, COEP Pune',
        experienceMr: 'शिवणकाम',
        experienceEn: 'Tailoring',
        ...lists,
      });
      expect(await row(ids.orgOnly)).toEqual({
        designationMr: 'संस्था',
        designationEn: 'Institute',
        experienceMr: '',
        experienceEn: '',
        ...lists,
      });
      expect(await row(ids.desOnly)).toEqual({ designationMr: 'पद', designationEn: 'Post', experienceMr: '', experienceEn: '', ...lists });
      /* "<designation>, <organisation>" would pass 300 characters: the organisation joins the experience instead. */
      expect(await row(ids.tooLong)).toEqual({
        designationMr: 'ड'.repeat(150),
        designationEn: 'D'.repeat(150),
        experienceMr: `कौशल्य; ${'स'.repeat(200)}`,
        experienceEn: `Skill; ${'S'.repeat(200)}`,
        ...lists,
      });
      expect(await row(ids.tooLongNoExp)).toMatchObject({ experienceMr: 'त'.repeat(200), experienceEn: 'T'.repeat(200) });
      /*
       * Folding made two live rows the same person in the same position: the later one takes the first free
       * number — (2) is another live row's already — and a deleted one is left.
       */
      expect(await row(ids.clashFirst)).toMatchObject({ designationMr: 'प्रशिक्षक', designationEn: 'Trainer' });
      expect(await row(ids.clashSecond)).toMatchObject({ designationMr: 'प्रशिक्षक (3)', designationEn: 'trainer (3)' });
      expect(await row(ids.clashTaken)).toMatchObject({ designationMr: 'प्रशिक्षक (2)', designationEn: 'TRAINER (2)' });
      expect(await row(ids.clashDeleted)).toMatchObject({ designationMr: 'प्रशिक्षक', designationEn: 'TRAINER' });
      const longPosition = (a: string, b: string, c: string, cs: number) => `${a.repeat(100)}, ${b.repeat(48)}, ${c.repeat(cs)}`;
      expect(await row(ids.longClashFirst)).toMatchObject({
        designationMr: longPosition('अ', 'ब', 'क', 148),
        designationEn: longPosition('A', 'B', 'C', 148),
      });
      expect(await row(ids.longClashSecond)).toMatchObject({
        designationMr: `${longPosition('अ', 'ब', 'क', 144)} (2)`,
        designationEn: `${longPosition('A', 'B', 'C', 144)} (2)`,
      });
      expect((await row(ids.longClashSecond)).designationEn).toHaveLength(300);

      /* The new rules: unique (name, position) among live rows; the position pair; profile text in one language is fine. */
      const insert = (nameEn: string, desMr: string, desEn: string, extra = '') =>
        attempt(
          qr,
          `INSERT INTO "advisory_members" ("nameMr", "nameEn", "designationMr", "designationEn"${extra ? ', "experienceEn"' : ''})
           VALUES ('नाव', $1, $2, $3${extra ? `, '${extra}'` : ''})`,
          [nameEn, desMr, desEn],
        );
      expect(await insert('BOTH', 'दुसरे', 'master trainer, coep pune')).toBe('23505');
      expect(await insert('Both', 'पद', '')).toBe('23514');
      expect(await insert('Both', 'प'.repeat(300), 'P'.repeat(300), 'English only')).toBeNull();
      expect(await insert('Both', 'प'.repeat(301), 'P')).toBe('22001');
    } finally {
      await qr.rollbackTransaction();
      await qr.release();
    }
    /* Rolled back: the live schema is the migrated one, with the rows the tests above wrote. */
    expect((await listAll()).some((x) => x.name.en === 'Advisory Test Trainer 40')).toBe(true);
  });
});

describe('migration 1796700000000 (groups)', () => {
  /* Rolled back like the one above, so the shared schema is left as the migrations built it. */
  it('down() drops the groups and the member column; up() brings them back with every member ungrouped', async () => {
    const migration = new AdvisoryGroups1796700000000();
    const qr = AppDataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();
    try {
      const hasColumn = async () =>
        (await qr.query(`SELECT 1 FROM information_schema.columns WHERE table_name = 'advisory_members' AND column_name = 'groupId'`))
          .length > 0;
      const hasTable = async () => (await qr.query(`SELECT 1 FROM pg_tables WHERE tablename = 'advisory_groups'`)).length > 0;
      const membersBefore = (await qr.query(`SELECT count(*)::int AS n FROM "advisory_members"`))[0].n as number;

      await migration.down(qr);
      expect([await hasTable(), await hasColumn()]).toEqual([false, false]);

      await migration.up(qr);
      expect([await hasTable(), await hasColumn()]).toEqual([true, true]);
      const [{ n, grouped }] = await qr.query(`SELECT count(*)::int AS n, count("groupId")::int AS grouped FROM "advisory_members"`);
      expect({ n, grouped }).toEqual({ n: membersBefore, grouped: 0 });

      /* One live group per English name (any capitals); both names required; a hard delete ungroups. */
      const [g] = await qr.query(`INSERT INTO "advisory_groups" ("nameMr", "nameEn") VALUES ('गट', 'Group') RETURNING "id"`);
      expect(await attempt(qr, `INSERT INTO "advisory_groups" ("nameMr", "nameEn") VALUES ('गट', 'GROUP')`)).toBe('23505');
      expect(await attempt(qr, `INSERT INTO "advisory_groups" ("nameMr", "nameEn", "isDelete") VALUES ('गट', 'GROUP', true)`)).toBeNull();
      expect(await attempt(qr, `INSERT INTO "advisory_groups" ("nameMr", "nameEn") VALUES (' ', 'Other')`)).toBe('23514');
      expect(await attempt(qr, `UPDATE "advisory_members" SET "groupId" = gen_random_uuid()`)).toBe('23503');
      const [m] = await qr.query(
        `INSERT INTO "advisory_members" ("nameMr", "nameEn", "groupId") VALUES ('नाव', 'Grouped', $1) RETURNING "id"`,
        [g.id],
      );
      await qr.query(`DELETE FROM "advisory_groups" WHERE "id" = $1`, [g.id]);
      expect((await qr.query(`SELECT "groupId" FROM "advisory_members" WHERE "id" = $1`, [m.id]))[0].groupId).toBeNull();
    } finally {
      await qr.rollbackTransaction();
      await qr.release();
    }
    expect((await request(app).get(`${ADMIN_URL}/groups`).set(auth(admin.token))).status).toBe(200);
  });
});
