import type { BrandingFallback, BrandingGroup, BrandingKey, BrandingSettingType, LogoRules } from './branding.constants';

/* F-LMS-04-03: each colour #RRGGBB (upper case), or null for the platform default. */
export interface BrandingColours {
  primary: string | null;
  accent: string | null;
}

/* F-LMS-04-06: text per platform language code. */
export type SupportHours = Partial<Record<string, string>>;

/* What logo_storage_key holds: the stored file's metadata. The storage key never leaves the server. */
export interface StoredLogo {
  storageKey: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  sha256: string;
  width: number;
  height: number;
}

/* The logo as the API shows it: url is the authenticated GET that streams it. */
export interface PublicLogo {
  fileName: string;
  mimeType: string;
  fileSize: number;
  sha256: string;
  width: number;
  height: number;
  url: string;
}

/* One catalogue key with its value for the entity. */
export interface BrandingSettingView {
  key: BrandingKey;
  fieldId: string;
  group: BrandingGroup;
  type: BrandingSettingType;
  label: string;
  description: string;
  required: boolean;
  fallback: BrandingFallback;
  sensitive: boolean;
  /* A value is stored for the key (also true for a sensitive key, whose value is never returned). */
  hasValue: boolean;
  /* The stored value; null when not set, and always null for a sensitive key. */
  value: unknown;
  /* What the clients use: the value, else the fallback (entity name / [default language]); null = platform default or nothing. */
  effectiveValue: unknown;
  updatedAt: Date | null;
}

/* GET /lms/branding/:entityId. */
export interface LmsBrandingView {
  entity: { id: string; name: string; code: string; defaultLanguage: string; isActive: boolean };
  settings: BrandingSettingView[];
  /* Required keys with no value and no fallback (support_email until it is set), whatever the search. */
  missingRequired: BrandingKey[];
  /* F-LMS-04-02: the active logo limits (type, file size, configured dimensions), for the upload hint. */
  logoRules: LogoRules;
}

export interface BrandingViewQuery {
  /* L-04 "Search setting key": matches the key or its label. */
  search?: string;
  group?: BrandingGroup;
}

/* undefined = not sent (left alone); null = reset to the default. colours merges primary / accent. */
export interface UpdateBrandingInput {
  display_name?: string | null;
  colours?: { primary?: string | null; accent?: string | null } | null;
  support_email?: string;
  support_phone?: string | null;
  support_hours?: SupportHours | null;
  languages?: string[] | null;
}
