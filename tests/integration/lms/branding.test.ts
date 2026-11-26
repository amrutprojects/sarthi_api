import type { Express } from 'express';
import { AppDataSource } from '../../../src/config/database.config';
import { env } from '../../../src/config/env.config';
import { discardStoredFile } from '../../../src/masters/document/document.storage';
import { API, actorWith, auth, request, setupTestApp, superAdmin, teardownTestApp, type TestActor } from '../../helpers/test-app';

/*
 * Branding and Settings (AMRUT_KALASH_03 L-04 / F-LMS-04) — /api/v1/lms/branding/:entityId.
 * Fixtures: LMS entities created through the Entity Master API. Logos go to the Document Master's private
 * storage (DOCUMENT_STORAGE_DIR) and are removed again in afterAll.
 */
const BASE = `${API}/lms/branding`;
const MISSING_ID = '00000000-0000-4000-8000-000000000000';

/* A real 1 × 1 PNG. */
const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

/* The same PNG with other IHDR dimensions (the server reads them; it does not check the chunk CRC). */
function pngOf(width: number, height: number): Buffer {
  const b = Buffer.from(PNG_1X1);
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  return b;
}

let app: Express;
let admin: TestActor;
let viewer: TestActor;
let updater: TestActor;
let nobody: TestActor;

interface SettingView {
  key: string;
  group: string;
  hasValue: boolean;
  value: unknown;
  effectiveValue: unknown;
  updatedAt: string | null;
}

async function makeEntity(name: string, code: string, defaultLanguage = 'en'): Promise<string> {
  const res = await request(app).post(`${API}/lms/entities`).set(auth(admin.token)).send({ name, code, defaultLanguage });
  if (res.status !== 201) throw new Error(`makeEntity failed (${res.status}): ${JSON.stringify(res.body)}`);
  return res.body.data.id as string;
}

const get = (entityId: string, token = admin.token, q = '') => request(app).get(`${BASE}/${entityId}${q}`).set(auth(token));
const patch = (entityId: string, body: unknown, token = admin.token) => request(app).patch(`${BASE}/${entityId}`).set(auth(token)).send(body as object);
const uploadLogo = (entityId: string, file: Buffer, filename = 'logo.png', token = admin.token) =>
  request(app).put(`${BASE}/${entityId}/logo`).set(auth(token)).attach('file', file, { filename, contentType: 'image/png' });

const setting = (res: { body: { data: { settings: SettingView[] } } }, key: string) => res.body.data.settings.find((s) => s.key === key)!;

const auditRows = (entityId: string, action: string): Promise<{ details: Record<string, unknown> }[]> =>
  AppDataSource.query(`SELECT "details" FROM "audit_logs" WHERE "resource" = 'lms-branding' AND "resourceId" = $1 AND "action" = $2 ORDER BY "createdAt", "id"`, [
    entityId,
    action,
  ]);

beforeAll(async () => {
  app = await setupTestApp();
  admin = await superAdmin();
  viewer = await actorWith(['lms-branding.view']);
  updater = await actorWith(['lms-branding.update']);
  nobody = await actorWith(['lms-entities.view']);
});

afterAll(async () => {
  /* Every logo written by this file, current or replaced (the audit keeps the storage keys). */
  const rows: { key: string | null }[] = await AppDataSource.query(
    `SELECT "details"->'after'->>'storageKey' AS "key" FROM "audit_logs" WHERE "action" = 'lms.branding.logo'`,
  );
  for (const r of rows) if (r.key) await discardStoredFile(r.key);
  await teardownTestApp();
});

describe('Branding and Settings — read', () => {
  it('lists the F-LMS-04 catalogue for a new entity with its defaults and the missing required support email', async () => {
    const id = await makeEntity('Sarthi', 'AMK', 'mr');
    const res = await get(id);
    expect(res.status).toBe(200);
    expect(res.body.data.entity).toMatchObject({ id, name: 'Sarthi', code: 'AMK', defaultLanguage: 'mr', isActive: true });
    expect(res.body.data.settings.map((s: SettingView) => s.key)).toEqual([
      'display_name',
      'logo_storage_key',
      'colours',
      'support_email',
      'support_phone',
      'support_hours',
      'languages',
    ]);
    expect(setting(res, 'display_name')).toMatchObject({
      fieldId: 'F-LMS-04-01',
      group: 'branding',
      type: 'text',
      required: true,
      sensitive: false,
      hasValue: false,
      value: null,
      effectiveValue: 'Sarthi',
      updatedAt: null,
    });
    expect(setting(res, 'languages')).toMatchObject({ group: 'settings', hasValue: false, value: null, effectiveValue: ['mr'] });
    /* Platform default: the spec defines no colour or logo, so none is invented. */
    expect(setting(res, 'colours')).toMatchObject({ fallback: 'platform', effectiveValue: null });
    expect(setting(res, 'logo_storage_key')).toMatchObject({ fallback: 'platform', effectiveValue: null });
    expect(res.body.data.missingRequired).toEqual(['support_email']);
    for (const s of res.body.data.settings) expect(typeof s.description).toBe('string');
  });

  it('searches setting keys and labels and filters by tab', async () => {
    const id = await makeEntity('Search Entity', 'SRCH');
    const support = await get(id, admin.token, '?search=SUPPORT');
    expect(support.body.data.settings.map((s: SettingView) => s.key)).toEqual(['support_email', 'support_phone', 'support_hours']);
    const colour = await get(id, admin.token, '?search=accent');
    expect(colour.body.data.settings.map((s: SettingView) => s.key)).toEqual(['colours']);
    const branding = await get(id, admin.token, '?group=branding');
    expect(branding.body.data.settings.map((s: SettingView) => s.key)).toEqual(['display_name', 'logo_storage_key', 'colours']);
    /* missingRequired covers every key, whatever the filter. */
    expect(branding.body.data.missingRequired).toEqual(['support_email']);
    expect((await get(id, admin.token, '?group=theme')).status).toBe(422);
  });

  it('answers 404 for an unknown entity and 422 for a malformed id', async () => {
    expect((await get(MISSING_ID)).status).toBe(404);
    expect((await get('not-a-uuid')).status).toBe(422);
    expect((await patch(MISSING_ID, { display_name: 'Nobody Here' })).status).toBe(404);
  });
});

describe('Branding and Settings — update', () => {
  it('stores normalised typed values and audits branding and each setting with before / after', async () => {
    const id = await makeEntity('Update Entity', 'UPD');
    const res = await patch(id, {
      display_name: '  Sarthi   LMS ',
      colours: { primary: '#0a3d62' },
      support_email: ' Help@Example.ORG ',
      support_phone: '+91 20 1234-5678',
      support_hours: { mr: 'सोम–शुक्र 10–6', en: ' Mon–Fri 10:00–18:00 ' },
      languages: ['mr', 'en'],
    });
    expect(res.status).toBe(200);
    expect(setting(res, 'display_name')).toMatchObject({ hasValue: true, value: 'Sarthi LMS', effectiveValue: 'Sarthi LMS' });
    expect(setting(res, 'colours').value).toEqual({ primary: '#0A3D62', accent: null });
    expect(setting(res, 'support_email').value).toBe('help@example.org');
    expect(setting(res, 'support_phone').value).toBe('+912012345678');
    expect(setting(res, 'support_hours').value).toEqual({ en: 'Mon–Fri 10:00–18:00', mr: 'सोम–शुक्र 10–6' });
    expect(setting(res, 'languages').value).toEqual(['en', 'mr']);
    expect(setting(res, 'languages').updatedAt).not.toBeNull();
    expect(res.body.data.missingRequired).toEqual([]);

    const branding = await auditRows(id, 'lms.branding.update');
    expect(branding).toHaveLength(1);
    expect(branding[0].details).toMatchObject({
      event: 'entity.branding.updated',
      fields: ['display_name', 'colours'],
      before: { display_name: null, colours: null },
      after: { display_name: 'Sarthi LMS', colours: { primary: '#0A3D62', accent: null } },
    });
    const settings = await auditRows(id, 'lms.setting.update');
    /* One record per key (same transaction, so same timestamp: compared as a set). */
    expect(settings.map((a) => a.details.key).sort()).toEqual(['languages', 'support_email', 'support_hours', 'support_phone']);
    expect(settings.find((a) => a.details.key === 'support_email')?.details).toMatchObject({
      event: 'entity.setting.updated',
      before: null,
      after: 'help@example.org',
    });

    /* The values are typed JSON in lms_entity_settings. */
    const rows: { key: string; value: unknown }[] = await AppDataSource.query(
      `SELECT "key", "value" FROM "lms_entity_settings" WHERE "entityId" = $1 AND "isDelete" = false ORDER BY "key"`,
      [id],
    );
    expect(rows.find((r) => r.key === 'languages')?.value).toEqual(['en', 'mr']);
  });

  it('merges one colour into the pair, writes no audit when nothing changes and resets keys with null', async () => {
    const id = await makeEntity('Merge Entity', 'MRG');
    await patch(id, { colours: { primary: '#112233' }, support_email: 'desk@example.org' });

    const accent = await patch(id, { colours: { accent: '#ffaa00' } });
    expect(setting(accent, 'colours').value).toEqual({ primary: '#112233', accent: '#FFAA00' });
    const cleared = await patch(id, { colours: { primary: null } });
    expect(setting(cleared, 'colours').value).toEqual({ primary: null, accent: '#FFAA00' });

    const before = (await auditRows(id, 'lms.branding.update')).length + (await auditRows(id, 'lms.setting.update')).length;
    const same = await patch(id, { colours: { accent: '#FFAA00' }, support_email: 'DESK@example.org' });
    expect(same.status).toBe(200);
    const after = (await auditRows(id, 'lms.branding.update')).length + (await auditRows(id, 'lms.setting.update')).length;
    expect(after).toBe(before);

    await patch(id, { display_name: 'Merge Display' });
    const reset = await request(app).put(`${BASE}/${id}`).set(auth(admin.token)).send({ colours: null, display_name: null, languages: null });
    expect(reset.status).toBe(200);
    expect(setting(reset, 'colours')).toMatchObject({ hasValue: false, value: null, effectiveValue: null });
    expect(setting(reset, 'display_name')).toMatchObject({ hasValue: false, effectiveValue: 'Merge Entity' });
    expect(setting(reset, 'languages')).toMatchObject({ hasValue: false, effectiveValue: ['en'] });
    /* An empty string is a reset too. */
    const phone = await patch(id, { support_phone: '+442071234567' });
    expect(setting(phone, 'support_phone').value).toBe('+442071234567');
    expect(setting(await patch(id, { support_phone: '' }), 'support_phone').hasValue).toBe(false);
  });

  it('refuses values that do not match their declared type with 422 and the key', async () => {
    const id = await makeEntity('Invalid Entity', 'INV');
    const cases: [Record<string, unknown>, string][] = [
      [{ display_name: 'ab' }, 'body.display_name'],
      [{ display_name: 'x'.repeat(61) }, 'body.display_name'],
      [{ display_name: 42 }, 'body.display_name'],
      [{ display_name: `Logo${String.fromCharCode(0x202e)}gnp.exe` }, 'body.display_name'],
      [{ colours: { primary: 'red' } }, 'body.colours.primary'],
      [{ colours: { accent: '#12345' } }, 'body.colours.accent'],
      [{ colours: { primary: '#123456', secondary: '#654321' } }, 'body.colours'],
      [{ colours: '#123456' }, 'body.colours'],
      [{ support_email: 'not-an-email' }, 'body.support_email'],
      [{ support_email: null }, 'body.support_email'],
      [{ support_phone: '9876543210' }, 'body.support_phone'],
      [{ support_phone: '+0123456789' }, 'body.support_phone'],
      [{ support_hours: { en: 'x'.repeat(121) } }, 'body.support_hours.en'],
      [{ support_hours: { fr: 'Lun–Ven' } }, 'body.support_hours.fr'],
      [{ support_hours: 'Mon–Fri' }, 'body.support_hours'],
      [{ languages: [] }, 'body.languages'],
      [{ languages: ['en', 'fr'] }, 'body.languages.1'],
      [{ languages: ['en', 'en'] }, 'body.languages'],
      [{ logo_storage_key: 'x.png' }, 'body'],
      [{ theme: 'dark' }, 'body'],
      [{}, 'body'],
    ];
    for (const [body, field] of cases) {
      const res = await patch(id, body);
      expect([JSON.stringify(body), res.status]).toEqual([JSON.stringify(body), 422]);
      expect(res.body.error.details.map((d: { field: string }) => d.field)).toContain(field);
    }
    const res = await patch(id, { colours: { primary: 'red' } });
    expect(res.body.error.details[0].message).toBe('Enter a valid colour.');
    expect((await get(id)).body.data.settings.every((s: SettingView) => !s.hasValue)).toBe(true);
  });

  it("never lets the enabled languages drop the entity's default language (F-LMS-04-07)", async () => {
    const id = await makeEntity('Language Entity', 'LANG', 'mr');
    const res = await patch(id, { languages: ['en'] });
    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual([{ field: 'languages', message: "Marathi is the entity's default language and cannot be removed." }]);
    expect(setting(await patch(id, { languages: ['mr'] }), 'languages').value).toEqual(['mr']);
  });

  it('enables a default language changed through the Entity Master in the stored languages, audited (F-LMS-04-07)', async () => {
    const id = await makeEntity('Default Switch Entity', 'DSW');
    expect(setting(await patch(id, { languages: ['en'] }), 'languages').value).toEqual(['en']);

    const changed = await request(app).patch(`${API}/lms/entities/${id}`).set(auth(admin.token)).send({ defaultLanguage: 'mr' });
    expect(changed.status).toBe(200);
    const res = await get(id);
    expect(res.body.data.entity.defaultLanguage).toBe('mr');
    expect(setting(res, 'languages')).toMatchObject({ hasValue: true, value: ['en', 'mr'], effectiveValue: ['en', 'mr'] });
    expect((await auditRows(id, 'lms.setting.update')).map((a) => a.details)).toEqual([
      expect.objectContaining({ key: 'languages', before: null, after: ['en'] }),
      expect.objectContaining({ event: 'entity.setting.updated', key: 'languages', before: ['en'], after: ['en', 'mr'] }),
    ]);
    /* The new default is now protected like any default. */
    expect((await patch(id, { languages: ['en'] })).status).toBe(400);
  });

  it('always reports the default language as enabled, even when a stored list lacks it', async () => {
    const id = await makeEntity('Legacy Language Entity', 'LGL', 'mr');
    await patch(id, { languages: ['mr'] });
    /* A row written before the rule held: the stored list leaves out the default. */
    await AppDataSource.query(`UPDATE "lms_entity_settings" SET "value" = '["en"]'::jsonb WHERE "entityId" = $1 AND "key" = 'languages'`, [id]);
    expect(setting(await get(id), 'languages')).toMatchObject({ hasValue: true, value: ['en'], effectiveValue: ['en', 'mr'] });
  });

  it('lets an inactive entity be configured, and keeps its settings through archive and restore', async () => {
    const id = await makeEntity('Archive Entity', 'ARC');
    await request(app).patch(`${API}/lms/entities/${id}/status`).set(auth(admin.token)).send({ isActive: false });
    expect((await patch(id, { support_email: 'archive@example.org' })).status).toBe(200);

    /* Settings are the entity's own configuration: they do not block the archive. */
    expect((await request(app).delete(`${API}/lms/entities/${id}`).set(auth(admin.token))).status).toBe(200);
    expect((await get(id)).status).toBe(404);
    expect((await patch(id, { support_email: 'other@example.org' })).status).toBe(404);
    expect((await uploadLogo(id, PNG_1X1)).status).toBe(404);

    expect((await request(app).post(`${API}/lms/entities/${id}/restore`).set(auth(admin.token))).status).toBe(200);
    expect(setting(await get(id), 'support_email').value).toBe('archive@example.org');
  });
});

describe('Branding and Settings — logo', () => {
  it('stores a PNG privately, returns its metadata without the storage key and streams it to viewers', async () => {
    const id = await makeEntity('Logo Entity', 'LOGO');
    const res = await uploadLogo(id, pngOf(120, 40), 'Amrut Logo.png');
    expect(res.status).toBe(200);
    const logo = setting(res, 'logo_storage_key');
    expect(logo).toMatchObject({ hasValue: true, type: 'image' });
    expect(logo.value).toEqual({
      fileName: 'Amrut Logo.png',
      mimeType: 'image/png',
      fileSize: PNG_1X1.length,
      sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      width: 120,
      height: 40,
      url: `${API}/lms/branding/${id}/logo`,
    });
    expect(JSON.stringify(res.body)).not.toMatch(/storageKey/);

    const file = await request(app).get(`${BASE}/${id}/logo`).set(auth(viewer.token)).buffer(true);
    expect(file.status).toBe(200);
    expect(file.headers['content-type']).toBe('image/png');
    expect(file.headers['x-content-type-options']).toBe('nosniff');
    expect(file.headers['cache-control']).toBe('private, no-cache');
    expect(Buffer.compare(file.body as Buffer, pngOf(120, 40))).toBe(0);
    const cached = await request(app).get(`${BASE}/${id}/logo`).set(auth(viewer.token)).set('If-None-Match', file.headers.etag);
    expect(cached.status).toBe(304);

    const audit = await auditRows(id, 'lms.branding.logo');
    expect(audit).toHaveLength(1);
    expect(audit[0].details).toMatchObject({ event: 'entity.branding.updated', key: 'logo_storage_key', before: null, after: { width: 120, height: 40 } });
  });

  it('replaces and removes the logo, auditing both, and answers 404 once none is set', async () => {
    const id = await makeEntity('Replace Entity', 'REPL');
    await uploadLogo(id, PNG_1X1);
    const replaced = await uploadLogo(id, pngOf(64, 64), 'second.png');
    expect(setting(replaced, 'logo_storage_key').value).toMatchObject({ fileName: 'second.png', width: 64 });

    const removed = await request(app).delete(`${BASE}/${id}/logo`).set(auth(updater.token));
    expect(removed.status).toBe(200);
    expect(setting(removed, 'logo_storage_key')).toMatchObject({ hasValue: false, value: null });
    expect((await request(app).get(`${BASE}/${id}/logo`).set(auth(admin.token))).status).toBe(404);
    expect((await request(app).delete(`${BASE}/${id}/logo`).set(auth(admin.token))).status).toBe(404);

    const audit = await auditRows(id, 'lms.branding.logo');
    expect(audit).toHaveLength(3);
    expect(audit[1].details).toMatchObject({ before: { width: 1 }, after: { width: 64 } });
    expect(audit[2].details).toMatchObject({ before: { width: 64 }, after: null });
  });

  it('refuses files that are not PNG by content, and a request without a file, with 400 on "file"', async () => {
    const id = await makeEntity('Reject Entity', 'REJ');
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0, 0, 0, 0]);
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    for (const [file, name] of [
      [jpeg, 'photo.png'],
      [Buffer.from('%PDF-1.7 fake'), 'doc.png'],
      [svg, 'logo.svg'],
      [PNG_1X1.subarray(0, 20), 'cut.png'],
    ] as [Buffer, string][]) {
      const res = await uploadLogo(id, file, name);
      expect([name, res.status]).toEqual([name, 400]);
      expect(res.body.error.details[0].field).toBe('file');
    }
    const none = await request(app).put(`${BASE}/${id}/logo`).set(auth(admin.token));
    expect(none.status).toBe(400);
    const extraField = await request(app).put(`${BASE}/${id}/logo`).set(auth(admin.token)).field('note', 'x').attach('file', PNG_1X1, 'logo.png');
    expect(extraField.status).toBe(400);
    expect(setting(await get(id), 'logo_storage_key').hasValue).toBe(false);
  });

  /* LMS_LOGO_MAX_WIDTH_PX / LMS_LOGO_MAX_HEIGHT_PX, read at each use: set on the parsed env for each case. */
  describe('configured dimension limits', () => {
    const configured = { w: env.LMS_LOGO_MAX_WIDTH_PX, h: env.LMS_LOGO_MAX_HEIGHT_PX };
    const limit = (w: number | undefined, h: number | undefined) => Object.assign(env, { LMS_LOGO_MAX_WIDTH_PX: w, LMS_LOGO_MAX_HEIGHT_PX: h });
    afterEach(() => limit(configured.w, configured.h));

    it('refuses a logo larger than the limit with 400 on "file", naming the limit, and stores nothing', async () => {
      limit(200, 100);
      const id = await makeEntity('Large Logo Entity', 'LARGE');
      expect((await get(id)).body.data.logoRules).toEqual({ maxWidthPx: 200, maxHeightPx: 100, maxFileMb: env.DOCUMENT_MAX_FILE_MB, types: ['image/png'] });

      for (const [w, h] of [[201, 50], [150, 101], [4000, 4000]]) {
        const res = await uploadLogo(id, pngOf(w, h));
        expect(res.status).toBe(400);
        const message = `Upload a PNG image of at most 200 × 100 pixels; this one is ${w} × ${h} pixels.`;
        expect(res.body.error.details).toEqual([{ field: 'file', message }]);
      }
      /* One side configured: only that side is limited. */
      limit(200, undefined);
      const wide = await uploadLogo(id, pngOf(201, 1));
      expect(wide.status).toBe(400);
      expect(wide.body.error.details[0]).toEqual({ field: 'file', message: 'Upload a PNG image of at most 200 pixels wide; this one is 201 × 1 pixels.' });
      limit(undefined, 100);
      expect((await uploadLogo(id, pngOf(1, 101))).body.error.details[0].message).toBe('Upload a PNG image of at most 100 pixels high; this one is 1 × 101 pixels.');

      expect(setting(await get(id), 'logo_storage_key').hasValue).toBe(false);
      expect(await auditRows(id, 'lms.branding.logo')).toHaveLength(0);
    });

    it('accepts a logo exactly at the limit', async () => {
      limit(200, 100);
      const id = await makeEntity('Exact Logo Entity', 'EXACT');
      const res = await uploadLogo(id, pngOf(200, 100));
      expect(res.status).toBe(200);
      expect(setting(res, 'logo_storage_key').value).toMatchObject({ width: 200, height: 100 });
      /* The other side is free when only one is configured. */
      limit(200, undefined);
      expect((await uploadLogo(id, pngOf(200, 5000))).status).toBe(200);
    });

    it('applies no dimension limit while the variables are unset, and shows none', async () => {
      limit(undefined, undefined);
      const id = await makeEntity('Free Logo Entity', 'FREE');
      expect((await get(id)).body.data.logoRules).toEqual({ maxWidthPx: null, maxHeightPx: null, maxFileMb: env.DOCUMENT_MAX_FILE_MB, types: ['image/png'] });
      const res = await uploadLogo(id, pngOf(20_000, 15_000));
      expect(res.status).toBe(200);
      expect(setting(res, 'logo_storage_key').value).toMatchObject({ width: 20_000, height: 15_000 });
    });
  });
});

describe('Branding and Settings — permissions', () => {
  it('lets lms-branding.view read only, lms-branding.update write, and refuses everyone else', async () => {
    const id = await makeEntity('Permission Entity', 'PERM');
    await uploadLogo(id, PNG_1X1);

    expect((await get(id, viewer.token)).status).toBe(200);
    expect((await patch(id, { display_name: 'Viewer Edit' }, viewer.token)).status).toBe(403);
    expect((await uploadLogo(id, PNG_1X1, 'logo.png', viewer.token)).status).toBe(403);
    expect((await request(app).delete(`${BASE}/${id}/logo`).set(auth(viewer.token))).status).toBe(403);

    expect((await patch(id, { display_name: 'Updater Edit' }, updater.token)).status).toBe(200);
    expect((await uploadLogo(id, PNG_1X1, 'logo.png', updater.token)).status).toBe(200);

    expect((await get(id, nobody.token)).status).toBe(403);
    expect((await request(app).get(`${BASE}/${id}/logo`).set(auth(nobody.token))).status).toBe(403);
    expect((await request(app).get(`${BASE}/${id}`)).status).toBe(401);

    /* The entity picker and the language list are open to branding viewers. */
    expect((await request(app).get(`${API}/lms/entities/options`).set(auth(viewer.token))).status).toBe(200);
    expect((await request(app).get(`${API}/lms/entities/form-options`).set(auth(viewer.token))).status).toBe(200);
  });

  it('splits the update right as L-04 does: branding keys need .update, contact and settings keys .update-settings', async () => {
    const id = await makeEntity('Split Entity', 'SPLIT');
    const settingsUpdater = await actorWith(['lms-branding.view', 'lms-branding.update-settings']);

    /* lms-branding.update (entity.branding.update): display name, logo and colours only. */
    expect((await patch(id, { display_name: 'Split Display', colours: { primary: '#123456' } }, updater.token)).status).toBe(200);
    const refused = await patch(id, { support_email: 'desk@example.org' }, updater.token);
    expect(refused.status).toBe(403);
    expect(refused.body.message).toMatch(/lms-branding\.update-settings/);
    expect((await patch(id, { languages: ['en'] }, updater.token)).status).toBe(403);

    /* lms-branding.update-settings (entity.update): support contacts and languages, not branding or the logo. */
    const contacts = { support_email: 'desk@example.org', support_phone: '+912012345678', support_hours: { en: 'Mon–Fri' }, languages: ['en', 'mr'] };
    expect((await patch(id, contacts, settingsUpdater.token)).status).toBe(200);
    expect((await patch(id, { display_name: 'Settings Edit' }, settingsUpdater.token)).status).toBe(403);
    expect((await uploadLogo(id, PNG_1X1, 'logo.png', settingsUpdater.token)).status).toBe(403);
    expect((await request(app).delete(`${BASE}/${id}/logo`).set(auth(settingsUpdater.token))).status).toBe(403);
    expect((await request(app).get(`${API}/lms/entities/form-options`).set(auth(settingsUpdater.token))).status).toBe(200);

    /* A request mixing both is refused whole: nothing of it is written. */
    expect((await patch(id, { display_name: 'Mixed Edit', support_phone: '+442071234567' }, settingsUpdater.token)).status).toBe(403);
    const after = await get(id);
    expect(setting(after, 'display_name').value).toBe('Split Display');
    expect(setting(after, 'support_phone').value).toBe('+912012345678');
    expect(setting(after, 'support_email').value).toBe('desk@example.org');

    /* Both codes change everything; every refusal above is in the audit log. */
    const both = await actorWith(['lms-branding.update', 'lms-branding.update-settings']);
    expect((await patch(id, { display_name: 'Both Edit', support_phone: '+442071234567' }, both.token)).status).toBe(200);
    const denied: { details: { keys: string[] } }[] = await AppDataSource.query(
      `SELECT "details" FROM "audit_logs" WHERE "resource" = 'lms-branding' AND "resourceId" = $1 AND "outcome" = 'DENIED' ORDER BY "createdAt", "id"`,
      [id],
    );
    expect(denied.map((d) => d.details.keys)).toEqual([['support_email'], ['languages'], ['display_name'], ['display_name']]);
  });
});
