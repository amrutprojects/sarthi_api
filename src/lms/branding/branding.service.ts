import type { Request } from 'express';
import type { FileHandle } from 'fs/promises';
import { AppDataSource } from '../../config/database.config';
import { env } from '../../config/env.config';
import { auditService } from '../../modules/audit';
import { P } from '../../modules/roles-permissions';
import { AUDIT_ACTIONS } from '../../shared/constants/app.constants';
import { AppError } from '../../shared/errors/app-error';
import { lockForUpdate } from '../../masters/shared/master-refs';
import { discardStoredFile, openStoredFile, storeUpload } from '../../masters/document/document.storage';
import type { UploadedFile } from '../../masters/document/document.types';
import { LMS_LANGUAGE_CODES, LMS_PLATFORM_LANGUAGES } from '../entity/entity.constants';
import { LmsEntity } from '../entity/entity.model';
import { lmsEntityRepository } from '../entity/entity.repository';
import {
  BRANDING_SETTINGS, LOGO_MIME_TYPE, brandingDef, logoDimensionError, logoRules, type BrandingKey, type BrandingSettingDef,
} from './branding.constants';
import type { LmsEntitySetting } from './branding.model';
import { lmsEntitySettingRepository } from './branding.repository';
import type {
  BrandingColours, BrandingSettingView, BrandingViewQuery, LmsBrandingView, PublicLogo, StoredLogo, UpdateBrandingInput,
} from './branding.types';

const LOGO_KEY: BrandingKey = 'logo_storage_key';

const logoUrl = (entityId: string) => `/api/v1/lms/branding/${entityId}/logo`;

/* F-LMS-04-02 error message, with the configured size limit. */
const logoRule = () => `Upload a PNG image within the size limit (at most ${env.DOCUMENT_MAX_FILE_MB} MB).`;
const logoError = (message = logoRule()) => AppError.badRequest(message, [{ field: 'file', message }]);

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/* Width / height from the IHDR chunk, which a valid PNG always carries first; null when it is not a PNG. */
function pngDimensions(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE) || buffer.toString('ascii', 12, 16) !== 'IHDR') return null;
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  return width > 0 && height > 0 ? { width, height } : null;
}

/* JSON with object keys sorted: jsonb reorders keys, so stored and new values are compared in this form. */
const canonical = (v: unknown): string =>
  JSON.stringify(v, (_k, val: unknown) =>
    val && typeof val === 'object' && !Array.isArray(val)
      ? Object.fromEntries(Object.entries(val as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
      : val,
  );

/* A sensitive key's value never reaches a response or the audit log; only whether one is set. */
const forAudit = (def: BrandingSettingDef, v: unknown) => (def.sensitive ? { hasValue: v !== null && v !== undefined } : v);

const logoAudit = (logo: StoredLogo | null) =>
  logo ? { fileName: logo.fileName, fileSize: logo.fileSize, sha256: logo.sha256, width: logo.width, height: logo.height, storageKey: logo.storageKey } : null;

const publicLogo = (entityId: string, logo: StoredLogo): PublicLogo => ({
  fileName: logo.fileName,
  mimeType: logo.mimeType,
  fileSize: logo.fileSize,
  sha256: logo.sha256,
  width: logo.width,
  height: logo.height,
  url: logoUrl(entityId),
});

/*
 * L-04 role permissions: "Update branding: entity.branding.update. Update settings: entity.update". The branding
 * keys (F-LMS-04-01 to -03, audited entity.branding.updated) need lms-branding.update; the contact and settings
 * keys (F-LMS-04-04 to -07, audited entity.setting.updated) need lms-branding.update-settings.
 */
const updateCodeOf = (def: BrandingSettingDef) => (def.group === 'branding' ? P.LMS_BRANDING_UPDATE : P.LMS_BRANDING_UPDATE_SETTINGS);

/*
 * The route admits either update code; a request that sends a key its caller's codes do not cover is refused
 * whole (403), and the denial is audited like a route denial. Skipped for an internal call (no request).
 */
async function assertMayUpdate(entityId: string, input: UpdateBrandingInput, req?: Request): Promise<void> {
  const held = req?.auth?.permissions;
  if (!held) return;
  const sent = Object.entries(input).filter(([, v]) => v !== undefined).map(([k]) => k);
  const refused = BRANDING_SETTINGS.filter((def) => sent.includes(def.key) && !held.has(updateCodeOf(def)));
  if (!refused.length) return;
  const required = [...new Set(refused.map(updateCodeOf))];
  await auditService.record(req, {
    action: AUDIT_ACTIONS.AUTHZ_DENIED,
    resource: 'lms-branding',
    resourceId: entityId,
    outcome: 'DENIED',
    details: { required, keys: refused.map((d) => d.key) },
  });
  throw AppError.forbidden(`You need ${required.join(' and ')} to change: ${refused.map((d) => d.label).join(', ')}`);
}

/*
 * Branding and Settings — AMRUT_KALASH_03 L-04 / FR-304, form F-LMS-04 (Table 29), DB-302 entity_setting.
 *
 * - Per entity: every value belongs to one LMS entity (DB-302; API-202 /entities/{id}/branding|settings).
 *   A deleted entity answers 404; an INACTIVE one can still be configured before it is activated.
 * - Typed key-value settings: the keys are the fixed catalogue of branding.constants.ts (no create /
 *   delete), each value validated against its declared type (branding.validator.ts); null resets a key
 *   to its default.
 * - F-LMS-04-07: the enabled languages are a subset of the platform languages and always keep the
 *   entity's default language (F-LMS-03-06).
 * - Logo (F-LMS-04-02): a PNG checked by content, size and the configured dimension limits (logoRules,
 *   shown in the GET) through the Document Master's private storage,
 *   streamed only through the authenticated GET. A replaced or removed logo stays on disk: the audit
 *   record of the change still points at it ("settings are versioned by audit").
 * - Audit: one entity.branding.updated record (lms.branding.update) for the branding keys of a request,
 *   one entity.setting.updated record (lms.setting.update: key, before, after) per other key changed,
 *   and lms.branding.logo for a logo upload or removal — each in the transaction of the write.
 * - Every write locks the entity row FOR UPDATE: writes to one entity's settings are serialised, and none
 *   lands on an entity being archived.
 */
export class LmsBrandingService {
  async get(entityId: string, q: BrandingViewQuery = {}): Promise<LmsBrandingView> {
    const entity = await lmsEntityRepository.findById(entityId);
    if (!entity) throw AppError.notFound('Entity not found');
    const rows = await lmsEntitySettingRepository.forEntity(entityId);
    const all = BRANDING_SETTINGS.map((def) => this.view(def, entity, rows.get(def.key)));

    const term = q.search?.toLowerCase();
    const settings = all.filter(
      (s) => (!q.group || s.group === q.group) && (!term || s.key.includes(term) || s.label.toLowerCase().includes(term)),
    );
    return {
      entity: { id: entity.id, name: entity.name, code: entity.code, defaultLanguage: entity.defaultLanguage, isActive: entity.isActive },
      settings,
      missingRequired: all.filter((s) => s.required && s.effectiveValue === null).map((s) => s.key),
      logoRules: logoRules(),
    };
  }

  private view(def: BrandingSettingDef, entity: LmsEntity, row: LmsEntitySetting | undefined): BrandingSettingView {
    const stored = row?.value ?? null;
    const hasValue = stored !== null;
    let value: unknown = def.sensitive ? null : stored;
    if (def.key === LOGO_KEY && stored) value = publicLogo(entity.id, stored as StoredLogo);

    let effectiveValue: unknown = value;
    if (!hasValue && def.fallback === 'entity_name') effectiveValue = entity.name;
    if (!hasValue && def.fallback === 'default_language') effectiveValue = [entity.defaultLanguage];
    /* F-LMS-04-07: the default language is always enabled, even on a stored list that leaves it out. */
    if (hasValue && def.fallback === 'default_language' && Array.isArray(stored) && !stored.includes(entity.defaultLanguage)) {
      effectiveValue = LMS_LANGUAGE_CODES.filter((c) => c === entity.defaultLanguage || (stored as string[]).includes(c));
    }
    if (def.sensitive) effectiveValue = null;

    return {
      key: def.key,
      fieldId: def.fieldId,
      group: def.group,
      type: def.type,
      label: def.label,
      description: def.description,
      required: def.required,
      fallback: def.fallback,
      sensitive: def.sensitive,
      hasValue,
      value,
      effectiveValue,
      updatedAt: row?.updatedAt ?? null,
    };
  }

  async update(entityId: string, input: UpdateBrandingInput, req?: Request): Promise<LmsBrandingView> {
    await assertMayUpdate(entityId, input, req);
    await AppDataSource.transaction(async (m) => {
      const entity = await lockForUpdate(m, LmsEntity, entityId);
      if (!entity) throw AppError.notFound('Entity not found');
      const rows = await lmsEntitySettingRepository.forEntity(entityId, m);

      const next = new Map<BrandingKey, unknown>();
      if (input.display_name !== undefined) next.set('display_name', input.display_name);
      if (input.colours !== undefined) next.set('colours', this.mergeColours(rows.get('colours')?.value, input.colours));
      if (input.support_email !== undefined) next.set('support_email', input.support_email);
      if (input.support_phone !== undefined) next.set('support_phone', input.support_phone);
      if (input.support_hours !== undefined) next.set('support_hours', input.support_hours);
      if (input.languages !== undefined) {
        /* F-LMS-04-07: "default language cannot be removed". null resets to [default language]. */
        if (input.languages && !input.languages.includes(entity.defaultLanguage)) {
          const label = LMS_PLATFORM_LANGUAGES.find((l) => l.code === entity.defaultLanguage)?.label ?? entity.defaultLanguage;
          throw AppError.badRequest('Keep at least the default language.', [
            { field: 'languages', message: `${label} is the entity's default language and cannot be removed.` },
          ]);
        }
        next.set('languages', input.languages);
      }

      const changes: { def: BrandingSettingDef; before: unknown; after: unknown }[] = [];
      for (const [key, after] of next) {
        const row = rows.get(key);
        const before = row?.value ?? null;
        if (canonical(before) === canonical(after)) continue;
        await lmsEntitySettingRepository.write(entityId, key, after, row, m);
        changes.push({ def: brandingDef(key), before, after });
      }

      const branding = changes.filter((c) => c.def.group === 'branding');
      if (branding.length) {
        await auditService.recordInTx(m, req, {
          action: AUDIT_ACTIONS.LMS_BRANDING_UPDATE,
          resource: 'lms-branding',
          resourceId: entityId,
          details: {
            event: 'entity.branding.updated',
            fields: branding.map((c) => c.def.key),
            before: Object.fromEntries(branding.map((c) => [c.def.key, forAudit(c.def, c.before)])),
            after: Object.fromEntries(branding.map((c) => [c.def.key, forAudit(c.def, c.after)])),
          },
        });
      }
      for (const c of changes.filter((x) => x.def.group !== 'branding')) {
        await auditService.recordInTx(m, req, {
          action: AUDIT_ACTIONS.LMS_SETTING_UPDATE,
          resource: 'lms-branding',
          resourceId: entityId,
          details: { event: 'entity.setting.updated', key: c.def.key, before: forAudit(c.def, c.before), after: forAudit(c.def, c.after) },
        });
      }
    });
    return this.get(entityId);
  }

  /* F-LMS-04-03: a colour not sent keeps its stored value; both empty = the platform default (null). */
  private mergeColours(stored: unknown, input: NonNullable<UpdateBrandingInput['colours']> | null): BrandingColours | null {
    if (input === null) return null;
    const current = (stored ?? {}) as Partial<BrandingColours>;
    const merged: BrandingColours = {
      primary: input.primary !== undefined ? input.primary : (current.primary ?? null),
      accent: input.accent !== undefined ? input.accent : (current.accent ?? null),
    };
    return merged.primary || merged.accent ? merged : null;
  }

  /*
   * F-LMS-04-02: checks the upload (PNG by content, configured dimension limits), writes it to private
   * storage (content and size checked again there), then records it in one transaction with its audit.
   */
  async uploadLogo(entityId: string, file: UploadedFile | undefined, req?: Request): Promise<LmsBrandingView> {
    if (!file) throw logoError('Attach the logo in the "file" field.');
    const size = pngDimensions(file.buffer);
    if (!size) throw logoError();
    /* LMS_LOGO_MAX_WIDTH_PX / LMS_LOGO_MAX_HEIGHT_PX: a logo larger on either side is refused; unset = no limit. */
    const tooLarge = logoDimensionError(size, logoRules());
    if (tooLarge) throw logoError(tooLarge);

    /* The storage's own 400 names its PDF / JPG / PNG rule; a logo answers with the F-LMS-04-02 message. */
    const stored = await storeUpload(file).catch((err: unknown) => {
      throw err instanceof AppError ? logoError() : err;
    });
    try {
      if (stored.mimeType !== LOGO_MIME_TYPE) throw logoError();
      const logo: StoredLogo = { ...stored, ...size };
      await AppDataSource.transaction(async (m) => {
        const entity = await lockForUpdate(m, LmsEntity, entityId);
        if (!entity) throw AppError.notFound('Entity not found');
        const row = (await lmsEntitySettingRepository.forEntity(entityId, m)).get(LOGO_KEY);
        await lmsEntitySettingRepository.write(entityId, LOGO_KEY, logo, row, m);
        await auditService.recordInTx(m, req, {
          action: AUDIT_ACTIONS.LMS_BRANDING_LOGO,
          resource: 'lms-branding',
          resourceId: entityId,
          details: { event: 'entity.branding.updated', key: LOGO_KEY, before: logoAudit((row?.value ?? null) as StoredLogo | null), after: logoAudit(logo) },
        });
      });
    } catch (err) {
      await discardStoredFile(stored.storageKey);
      throw err;
    }
    return this.get(entityId);
  }

  /* Back to the platform default. The file stays on disk for the audit record. */
  async removeLogo(entityId: string, req?: Request): Promise<LmsBrandingView> {
    await AppDataSource.transaction(async (m) => {
      const entity = await lockForUpdate(m, LmsEntity, entityId);
      if (!entity) throw AppError.notFound('Entity not found');
      const row = (await lmsEntitySettingRepository.forEntity(entityId, m)).get(LOGO_KEY);
      if (!row?.value) throw AppError.notFound('No logo has been uploaded for this entity');
      await lmsEntitySettingRepository.write(entityId, LOGO_KEY, null, row, m);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.LMS_BRANDING_LOGO,
        resource: 'lms-branding',
        resourceId: entityId,
        details: { event: 'entity.branding.updated', key: LOGO_KEY, before: logoAudit(row.value as StoredLogo), after: null },
      });
    });
    return this.get(entityId);
  }

  /* The current logo file, for the authenticated GET. */
  async openLogo(entityId: string): Promise<{ handle: FileHandle; size: number; mimeType: string; sha256: string }> {
    const entity = await lmsEntityRepository.findById(entityId);
    if (!entity) throw AppError.notFound('Entity not found');
    const logo = (await lmsEntitySettingRepository.forEntity(entityId)).get(LOGO_KEY)?.value as StoredLogo | null | undefined;
    if (!logo) throw AppError.notFound('No logo has been uploaded for this entity');
    if (logo.mimeType !== LOGO_MIME_TYPE) throw AppError.notFound('The logo file is missing');
    const { handle, size } = await openStoredFile(logo.storageKey);
    return { handle, size, mimeType: logo.mimeType, sha256: logo.sha256 };
  }
}

export const lmsBrandingService = new LmsBrandingService();
