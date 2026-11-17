import type { Express } from 'express';
import {
  AppDataSource,
  API,
  actorWith,
  auth,
  createUser,
  login,
  request,
  setupTestApp,
  superAdmin,
  teardownTestApp,
  type TestActor,
} from '../../helpers/test-app';
import { auditService } from '../../../src/modules/audit/audit.service';
import { ROLE_CODES } from '../../../src/modules/roles-permissions';

const ADMIN_URL = `${API}/cms/page-banners`;
const PUBLIC_URL = `${API}/public/page-banners`;

let app: Express;
let admin: TestActor;

interface Text {
  mr: string;
  en: string;
}
interface Item {
  key: string;
  title: Text | null;
  subtitle: Text | null;
  updatedAt: string | null;
}
interface Detail {
  field: string;
  message: string;
}

/* The five pages whose banner the CMS edits, in screen order. */
const KEYS = ['about', 'faq', 'programme', 'track', 'verify'];
const ALL_DEFAULT = KEYS.map((key) => ({ key, title: null, subtitle: null }));

const TITLE = { mr: 'नेहमीचे प्रश्न', en: 'Common questions' };
const SUBTITLE = { mr: 'अमृत कलश कार्यक्रमाविषयी उत्तरे', en: 'Answers about the AMRUT Kalash programme' };

const details = (res: { body: { error: { details: Detail[] } } }) => res.body.error.details;
const list = async (token = admin.token): Promise<Item[]> => (await request(app).get(ADMIN_URL).set(auth(token)).expect(200)).body.data;
const item = async (key: string) => (await list()).find((i) => i.key === key)!;
const set = (key: string, payload: unknown, token = admin.token) =>
  request(app)
    .put(`${ADMIN_URL}/${key}`)
    .set(auth(token))
    .send(payload as object);
const publicItems = async () =>
  (await request(app).get(PUBLIC_URL).expect(200)).body.data.items as { key: string; title: Text | null; subtitle: Text | null }[];
const liveRows = async (key: string) =>
  (await AppDataSource.query(
    `SELECT "titleMr", "titleEn", "subtitleMr", "subtitleEn" FROM "page_banners" WHERE "key" = $1 AND "isDelete" = false`,
    [key],
  )) as { titleMr: string; titleEn: string; subtitleMr: string; subtitleEn: string }[];
const BLANK = { titleMr: '', titleEn: '', subtitleMr: '', subtitleEn: '' };
const auditCount = async () =>
  (await AppDataSource.query(`SELECT count(*)::int AS n FROM "audit_logs" WHERE "action" = 'cms.page-banner.update'`))[0].n as number;

beforeAll(async () => {
  app = await setupTestApp();
  admin = await superAdmin();
});
/* page_banners survives resetData() (its rows come from the migration), so every page is left with a live, blank row. */
afterAll(async () => {
  await AppDataSource.query(
    `INSERT INTO "page_banners" ("key") SELECT unnest($1::varchar[])
     ON CONFLICT ("key") WHERE "isDelete" = false
     DO UPDATE SET "titleMr" = '', "titleEn" = '', "subtitleMr" = '', "subtitleEn" = ''
     WHERE "page_banners"."titleMr" <> '' OR "page_banners"."titleEn" <> ''
        OR "page_banners"."subtitleMr" <> '' OR "page_banners"."subtitleEn" <> ''`,
    [KEYS],
  );
  await teardownTestApp();
});
afterEach(() => jest.restoreAllMocks());

describe('Listing the banners', () => {
  it('the migration creates every page, blank, so the list is all five in order with their versions', async () => {
    const items = await list();
    expect(items.map((i) => i.key)).toEqual(KEYS);
    for (const i of items) {
      expect(Object.keys(i).sort()).toEqual(['key', 'subtitle', 'title', 'updatedAt']);
      expect(i.title).toBeNull();
      expect(i.subtitle).toBeNull();
      expect(new Date(i.updatedAt!).toISOString()).toBe(i.updatedAt);
      expect(await liveRows(i.key)).toEqual([BLANK]);
    }
  });

  it('the public feed needs no session and lists every page, with no custom words, in order', async () => {
    const res = await request(app).get(PUBLIC_URL);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ items: ALL_DEFAULT });
  });
});

describe('Editing a banner', () => {
  it('sets a title and subtitle in both languages, trimmed; the list and the public feed carry them', async () => {
    const before = await item('faq');
    const res = await set('faq', {
      title: { mr: `  ${TITLE.mr} `, en: ` ${TITLE.en}  ` },
      subtitle: { mr: SUBTITLE.mr, en: `${SUBTITLE.en} ` },
    });
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Page banner saved');
    expect(res.body.data).toMatchObject({ key: 'faq', title: TITLE, subtitle: SUBTITLE });
    expect(new Date(res.body.data.updatedAt).getTime()).toBeGreaterThan(new Date(before.updatedAt!).getTime());
    expect(await liveRows('faq')).toEqual([{ titleMr: TITLE.mr, titleEn: TITLE.en, subtitleMr: SUBTITLE.mr, subtitleEn: SUBTITLE.en }]);
    expect(await item('faq')).toEqual(res.body.data);
    expect(await publicItems()).toEqual(
      KEYS.map((key) => (key === 'faq' ? { key, title: TITLE, subtitle: SUBTITLE } : { key, title: null, subtitle: null })),
    );

    const reset = await set('faq', { title: null, subtitle: null });
    expect(reset.status).toBe(200);
    expect(reset.body.message).toBe('Page banner reset to the default');
    expect(reset.body.data).toMatchObject({ key: 'faq', title: null, subtitle: null });
    expect(await liveRows('faq')).toEqual([BLANK]);
    expect(await publicItems()).toEqual(ALL_DEFAULT);
  });

  it('a title-only change keeps the subtitle, and a subtitle-only change keeps the title', async () => {
    await set('track', { title: TITLE }).expect(200);
    const sub = (await set('track', { subtitle: SUBTITLE }).expect(200)).body.data as Item;
    expect(sub).toMatchObject({ title: TITLE, subtitle: SUBTITLE });

    const titleReset = (await set('track', { title: null }).expect(200)).body.data as Item;
    expect(titleReset).toMatchObject({ title: null, subtitle: SUBTITLE });
    expect((await publicItems()).find((i) => i.key === 'track')).toEqual({ key: 'track', title: null, subtitle: SUBTITLE });

    await set('track', { subtitle: null }).expect(200);
    expect(await publicItems()).toEqual(ALL_DEFAULT);
  });

  it('resets to the default with both halves blank', async () => {
    await set('verify', { title: TITLE, subtitle: SUBTITLE }).expect(200);
    const blank = await set('verify', { title: { mr: '   ', en: '' }, subtitle: { mr: '', en: ' ' } });
    expect(blank.status).toBe(200);
    expect(blank.body.data).toMatchObject({ title: null, subtitle: null });
    expect(await liveRows('verify')).toEqual([BLANK]);
  });

  it('keeps a title on one line, keeps line breaks in a subtitle, and takes exactly 150 / 300 characters', async () => {
    const res = await set('about', {
      title: { mr: 'अमृत\nविषयी', en: 'About\r\n\tAMRUT' },
      subtitle: { mr: 'ओळ एक\nओळ दोन', en: 'Line one\r\nLine two' },
    });
    expect(res.status).toBe(200);
    expect(res.body.data.title).toEqual({ mr: 'अमृत विषयी', en: 'About AMRUT' });
    expect(res.body.data.subtitle).toEqual({ mr: 'ओळ एक\nओळ दोन', en: 'Line one\nLine two' });

    const longest = { title: { mr: 'अ'.repeat(150), en: 'x'.repeat(150) }, subtitle: { mr: 'आ'.repeat(300), en: 'y'.repeat(300) } };
    expect((await set('about', longest).expect(200)).body.data).toMatchObject(longest);
    await set('about', { title: null, subtitle: null }).expect(200);
  });

  it('is idempotent: saving the same words succeeds, leaves the row and its version alone, and is audited', async () => {
    const audits = await auditCount();
    const first = (await set('programme', { title: TITLE }).expect(200)).body.data as Item;
    const again = (await set('programme', { title: TITLE }).expect(200)).body.data as Item;
    expect(again).toEqual(first);
    expect(await auditCount()).toBe(audits + 2);
    await set('programme', { title: null }).expect(200);
  });

  it('a page whose row is missing reads as the default, and a change creates its row', async () => {
    await AppDataSource.query(`DELETE FROM "page_banners" WHERE "key" = 'verify'`);
    expect(await item('verify')).toEqual({ key: 'verify', title: null, subtitle: null, updatedAt: null });
    expect(await publicItems()).toEqual(ALL_DEFAULT);

    const res = await set('verify', { subtitle: SUBTITLE });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ key: 'verify', title: null, subtitle: SUBTITLE });
    expect(res.body.data.updatedAt).not.toBeNull();
    expect(await liveRows('verify')).toEqual([{ ...BLANK, subtitleMr: SUBTITLE.mr, subtitleEn: SUBTITLE.en }]);
    await set('verify', { subtitle: null }).expect(200);
  });

  it('a soft-deleted row no longer counts: the page reads as the default, and a change creates a new live row', async () => {
    await set('about', { title: TITLE }).expect(200);
    await AppDataSource.query(`UPDATE "page_banners" SET "isDelete" = true WHERE "key" = 'about'`);
    expect(await item('about')).toEqual({ key: 'about', title: null, subtitle: null, updatedAt: null });
    expect(await publicItems()).toEqual(ALL_DEFAULT);

    await set('about', { title: TITLE }).expect(200);
    expect(await liveRows('about')).toEqual([{ ...BLANK, titleMr: TITLE.mr, titleEn: TITLE.en }]);
    await set('about', { title: null }).expect(200);
  });

  it('records who changed which page and what was sent, in the same transaction as the change', async () => {
    await set('programme', { title: TITLE }).expect(200);
    await set('programme', { title: null, subtitle: SUBTITLE }).expect(200);
    const entries = (await AppDataSource.query(
      `SELECT "resource", "resourceId", "details", "actorUserId" FROM "audit_logs"
        WHERE "action" = 'cms.page-banner.update' AND "resourceId" = 'programme' ORDER BY "createdAt" DESC LIMIT 2`,
    )) as { resource: string; resourceId: string; details: unknown; actorUserId: string }[];
    expect(entries).toEqual([
      {
        resource: 'page-banner',
        resourceId: 'programme',
        actorUserId: admin.user.id,
        details: { key: 'programme', title: null, subtitle: SUBTITLE },
      },
      { resource: 'page-banner', resourceId: 'programme', actorUserId: admin.user.id, details: { key: 'programme', title: TITLE } },
    ]);

    /* No audit, no change: a failed audit write rolls the words back. */
    jest.spyOn(auditService, 'recordInTx').mockRejectedValueOnce(new Error('simulated database failure'));
    expect((await set('programme', { subtitle: null })).status).toBe(500);
    expect((await item('programme')).subtitle).toEqual(SUBTITLE);

    await set('programme', { subtitle: null }).expect(200);
    expect(await publicItems()).toEqual(ALL_DEFAULT);
  });
});

describe('Refusals', () => {
  it('refuses words in one language only, too long, with control characters or of the wrong shape, and changes nothing', async () => {
    const enMissing = await set('faq', { title: { mr: 'प्रश्न', en: '  ' } });
    expect(enMissing.status).toBe(422);
    expect(details(enMissing)).toEqual([
      { field: 'body.title.en', message: 'Title (English) is required when the Marathi text is filled in' },
    ]);

    const mrMissing = await set('faq', { subtitle: { mr: '', en: 'Answers' } });
    expect(mrMissing.status).toBe(422);
    expect(details(mrMissing)).toEqual([
      { field: 'body.subtitle.mr', message: 'Subtitle (Marathi) is required when the English text is filled in' },
    ]);

    const tooLong = await set('faq', { title: { mr: 'अ'.repeat(151), en: 'x'.repeat(151) }, subtitle: { mr: 'आ'.repeat(301), en: 'y' } });
    expect(tooLong.status).toBe(422);
    expect(details(tooLong)).toEqual([
      { field: 'body.title.mr', message: 'Title (Marathi) must be at most 150 characters' },
      { field: 'body.title.en', message: 'Title (English) must be at most 150 characters' },
      { field: 'body.subtitle.mr', message: 'Subtitle (Marathi) must be at most 300 characters' },
    ]);

    const control = await set('faq', { title: { mr: 'प्रश्न\u0007', en: 'Questions' } });
    expect(control.status).toBe(422);
    expect(details(control)).toEqual([{ field: 'body.title.mr', message: 'Title (Marathi) contains characters that are not allowed' }]);

    const notPair = await set('faq', { title: 'Questions' });
    expect(notPair.status).toBe(422);
    expect(details(notPair)).toEqual([{ field: 'body.title', message: 'Title must have Marathi and English text' }]);

    const extra = await set('faq', { subtitle: { mr: 'उत्तरे', en: 'Answers', hi: 'x' } });
    expect(extra.status).toBe(422);
    expect(details(extra).map((d) => d.field)).toEqual(['body.subtitle']);

    expect(await liveRows('faq')).toEqual([BLANK]);
    expect(await publicItems()).toEqual(ALL_DEFAULT);
  });

  it('refuses an unknown page or a bad body with 422 naming the field, and changes nothing', async () => {
    const unknown = await set('contact', { title: TITLE });
    expect(unknown.status).toBe(422);
    expect(details(unknown)).toEqual([{ field: 'params.key', message: 'Page must be one of: about, faq, programme, track, verify' }]);

    const extra = await set('faq', { title: TITLE, show: false });
    expect(extra.status).toBe(422);
    expect(details(extra).map((d) => d.field)).toEqual(['body']);

    const empty = await set('faq', {});
    expect(empty.status).toBe(422);
    expect(details(empty)).toEqual([{ field: 'body', message: 'Send title, subtitle or both' }]);

    expect(await publicItems()).toEqual(ALL_DEFAULT);
  });

  it('the database refuses an unknown key or a second live row for a key, even past the API', async () => {
    await expect(AppDataSource.query(`INSERT INTO "page_banners" ("key") VALUES ('contact')`)).rejects.toThrow(/CHK_page_banners_key/);
    await expect(AppDataSource.query(`INSERT INTO "page_banners" ("key") VALUES ('faq')`)).rejects.toThrow(/UQ_page_banners_key_active/);
  });

  it('the database refuses a title or subtitle filled in one language only, even past the API', async () => {
    await expect(AppDataSource.query(`UPDATE "page_banners" SET "titleMr" = 'प्रश्न' WHERE "key" = 'faq'`)).rejects.toThrow(
      /CHK_page_banners_title_pair/,
    );
    await expect(
      AppDataSource.query(`UPDATE "page_banners" SET "subtitleMr" = '  ', "subtitleEn" = 'Answers' WHERE "key" = 'faq'`),
    ).rejects.toThrow(/CHK_page_banners_subtitle_pair/);
    expect(await liveRows('faq')).toEqual([BLANK]);
  });
});

describe('Access control', () => {
  it('refuses the admin routes without a session', async () => {
    expect((await request(app).get(ADMIN_URL)).status).toBe(401);
    expect((await request(app).put(`${ADMIN_URL}/faq`).send({ title: TITLE })).status).toBe(401);
  });

  it('a view-only administrator can read but not change a banner', async () => {
    const viewer = await actorWith(['cms-pagebanners.view']);
    expect((await list(viewer.token)).map((i) => i.key)).toEqual(KEYS);
    expect((await set('faq', { title: TITLE }, viewer.token)).status).toBe(403);
    expect(await liveRows('faq')).toEqual([BLANK]);
  });

  it('another CMS permission does not open the banners', async () => {
    const navMenu = await actorWith(['cms-navmenu.view', 'cms-navmenu.update']);
    expect((await request(app).get(ADMIN_URL).set(auth(navMenu.token))).status).toBe(403);
    expect((await set('faq', { title: TITLE }, navMenu.token)).status).toBe(403);
  });

  it('a Website Admin reads and changes them', async () => {
    const user = await createUser({ roleCodes: [ROLE_CODES.WEBSITE_ADMIN] });
    const token = await login(user.email);
    expect((await list(token)).map((i) => i.key)).toEqual(KEYS);
    await set('track', { title: TITLE }, token).expect(200);
    await set('track', { title: null }, token).expect(200);
    expect(await publicItems()).toEqual(ALL_DEFAULT);
  });
});
