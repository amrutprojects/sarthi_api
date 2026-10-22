/*
 * The settings catalogue of Branding and Settings (AMRUT_KALASH_03 L-04 / FR-304, form F-LMS-04 Table 29),
 * each fixed value in ONE place.
 *
 * L-04: "Settings are typed, validated, have a description and are audited". The keys are the spec's own
 * entity_setting(<key>) names (F-LMS-04 "Source of truth" column); a client changes values only — keys are
 * never created or removed through the API, so the catalogue below is the complete list.
 *
 * Tabs of UI-312: branding (display name, logo, colours), contact (support email, phone, hours) and
 * settings (enabled languages). Branding keys are audited as entity.branding.updated, the others as
 * entity.setting.updated (key, before, after) — L-04 "Audit events".
 */
import { env } from '../../config/env.config';

export const BRANDING_GROUPS = ['branding', 'contact', 'settings'] as const;
export type BrandingGroup = (typeof BRANDING_GROUPS)[number];

export type BrandingSettingType = 'text' | 'image' | 'colour_pair' | 'email' | 'phone' | 'text_per_language' | 'language_list';

export const BRANDING_KEYS = [
  'display_name',
  'logo_storage_key',
  'colours',
  'support_email',
  'support_phone',
  'support_hours',
  'languages',
] as const;
export type BrandingKey = (typeof BRANDING_KEYS)[number];

/*
 * What a learner client uses while a key has no value:
 * - entity_name / default_language: the entity's name / [its default language] (F-LMS-04-01 / -07 defaults);
 * - platform: the clients' built-in "Platform default" (F-LMS-04-02 / -03). The spec gives no value for it,
 *   so none is invented here: the effective value stays null;
 * - none: no default (the value is simply not shown).
 */
export type BrandingFallback = 'entity_name' | 'default_language' | 'platform' | 'none';

export interface BrandingSettingDef {
  key: BrandingKey;
  fieldId: string;
  group: BrandingGroup;
  type: BrandingSettingType;
  label: string;
  description: string;
  /* F-LMS-04 "Required": a required key with a fallback is never empty; one without (support email) is reported in missingRequired until set. */
  required: boolean;
  fallback: BrandingFallback;
  /*
   * Write-only: the value is never returned (hasValue only) and never written to the audit log. No F-LMS-04
   * field is one — all are classed Internal — and SEC-009 keeps credentials, keys and tokens in the secrets
   * manager, never in this table. The flag exists so a later key cannot leak by default.
   */
  sensitive: boolean;
}

export const BRANDING_SETTINGS: readonly BrandingSettingDef[] = [
  {
    key: 'display_name',
    fieldId: 'F-LMS-04-01',
    group: 'branding',
    type: 'text',
    label: 'Display name',
    description: 'Name shown in the app and on notifications. 3–60 characters; the entity name while not set.',
    required: true,
    fallback: 'entity_name',
    sensitive: false,
  },
  {
    key: 'logo_storage_key',
    fieldId: 'F-LMS-04-02',
    group: 'branding',
    type: 'image',
    label: 'Logo',
    description: 'Logo for LMS Admin, app and certificate header. PNG image within the size limit; the platform default while not set.',
    required: false,
    fallback: 'platform',
    sensitive: false,
  },
  {
    key: 'colours',
    fieldId: 'F-LMS-04-03',
    group: 'branding',
    type: 'colour_pair',
    label: 'Primary and accent colour',
    description: 'Theme colours as #RRGGBB; the platform default while not set.',
    required: false,
    fallback: 'platform',
    sensitive: false,
  },
  {
    key: 'support_email',
    fieldId: 'F-LMS-04-04',
    group: 'contact',
    type: 'email',
    label: 'Support email',
    description: 'Contact shown to learners. An organisational mailbox, not a personal address.',
    required: true,
    fallback: 'none',
    sensitive: false,
  },
  {
    key: 'support_phone',
    fieldId: 'F-LMS-04-05',
    group: 'contact',
    type: 'phone',
    label: 'Support phone',
    description: 'Helpdesk number shown to learners, in E.164 format (+919876543210). A helpdesk line only: no personal staff mobile without consent.',
    required: false,
    fallback: 'none',
    sensitive: false,
  },
  {
    key: 'support_hours',
    fieldId: 'F-LMS-04-06',
    group: 'contact',
    type: 'text_per_language',
    label: 'Support hours text',
    description: 'When the helpdesk answers, per language; at most 120 characters each.',
    required: false,
    fallback: 'none',
    sensitive: false,
  },
  {
    key: 'languages',
    fieldId: 'F-LMS-04-07',
    group: 'settings',
    type: 'language_list',
    label: 'Enabled languages',
    description: "Languages offered to learners: a subset of the platform languages (OQ-023) that always keeps the entity's default language.",
    required: true,
    fallback: 'default_language',
    sensitive: false,
  },
];

export const brandingDef = (key: BrandingKey): BrandingSettingDef => BRANDING_SETTINGS.find((d) => d.key === key)!;

/* F-LMS-04-01: 3–60 characters. */
export const DISPLAY_NAME_MIN = 3;
export const DISPLAY_NAME_MAX = 60;

/* F-LMS-04-06: ≤ 120 characters per language. */
export const SUPPORT_HOURS_MAX = 120;

/*
 * F-LMS-04-02 logo: "PNG or SVG (sanitised); size and dimension limits from configuration; scanned".
 * - Type: PNG, checked by content. SVG is not accepted yet: the Document Master's private storage that
 *   logos reuse keeps PDF / PNG / JPG only, and no SVG sanitiser is part of this code base.
 * - Size: the upload limit of that storage (DOCUMENT_MAX_FILE_MB).
 * - Dimensions: the spec defers the limits to configuration and gives no value, so they are the optional
 *   env variables LMS_LOGO_MAX_WIDTH_PX / LMS_LOGO_MAX_HEIGHT_PX; an unset one is no limit (null). The
 *   width and height of each logo are recorded.
 */
export const LOGO_MIME_TYPE = 'image/png';

export interface LogoRules {
  /* null = no limit on that side. */
  maxWidthPx: number | null;
  maxHeightPx: number | null;
  maxFileMb: number;
  types: string[];
}

/* The active logo limits, read from the configuration at each use (GET shows them, the upload applies them). */
export const logoRules = (): LogoRules => ({
  maxWidthPx: env.LMS_LOGO_MAX_WIDTH_PX ?? null,
  maxHeightPx: env.LMS_LOGO_MAX_HEIGHT_PX ?? null,
  maxFileMb: env.DOCUMENT_MAX_FILE_MB,
  types: [LOGO_MIME_TYPE],
});

/* "512 × 256 pixels" / "512 pixels wide" / "256 pixels high"; null when no dimension limit is configured. */
export function logoDimensionRule(r: Pick<LogoRules, 'maxWidthPx' | 'maxHeightPx'>): string | null {
  if (r.maxWidthPx !== null && r.maxHeightPx !== null) return `${r.maxWidthPx} × ${r.maxHeightPx} pixels`;
  if (r.maxWidthPx !== null) return `${r.maxWidthPx} pixels wide`;
  if (r.maxHeightPx !== null) return `${r.maxHeightPx} pixels high`;
  return null;
}

/* The F-LMS-04-02 answer to a logo over the configured dimensions, with the limit (the admin panel shows the same text). */
export function logoDimensionError(size: { width: number; height: number }, r: Pick<LogoRules, 'maxWidthPx' | 'maxHeightPx'>): string | null {
  const tooWide = r.maxWidthPx !== null && size.width > r.maxWidthPx;
  const tooHigh = r.maxHeightPx !== null && size.height > r.maxHeightPx;
  if (!tooWide && !tooHigh) return null;
  return `Upload a PNG image of at most ${logoDimensionRule(r)}; this one is ${size.width} × ${size.height} pixels.`;
}
