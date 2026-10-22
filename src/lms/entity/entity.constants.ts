/*
 * Fixed values of the Entity Master, each in ONE place.
 */

/*
 * Platform languages (F-LMS-03-06 "one of the platform languages"; F-LMS-04-07 enabled languages are a
 * subset of them). TO BE CONFIRMED: OQ-023 is Open — the recommended answer is English and Marathi, and the
 * codes en / mr are only "Proposed". This list is the configured value until the programme office decides;
 * the Branding master reads the same constant. The column stores the code; its CHECK only fixes the shape,
 * so confirming the list changes this constant only.
 */
export const LMS_PLATFORM_LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'mr', label: 'Marathi' },
] as const;

export type LmsLanguageCode = (typeof LMS_PLATFORM_LANGUAGES)[number]['code'];

export const LMS_LANGUAGE_CODES = LMS_PLATFORM_LANGUAGES.map((l) => l.code) as [LmsLanguageCode, ...LmsLanguageCode[]];

/* The language list is still an open question (OQ-023); the form says so next to the dropdown. */
export const LMS_LANGUAGES_CONFIRMED = false;

/* F-LMS-03-07 time zone default. */
export const DEFAULT_TIME_ZONE = 'Asia/Kolkata';

/*
 * An IANA zone name ("Area/Location", e.g. Asia/Kolkata, or UTC) that the runtime's time zone database knows.
 * Offsets such as "+05:30" and abbreviations such as "IST" are refused: F-LMS-03-07 asks for an IANA zone.
 * Aliases are accepted (ICU lists Asia/Calcutta, the spec default is Asia/Kolkata), so the check asks
 * Intl rather than comparing with Intl.supportedValuesOf().
 */
const IANA_SHAPE = /^(?:[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)+|UTC)$/;

export function isIanaTimeZone(tz: string): boolean {
  if (tz.length > 64 || !IANA_SHAPE.test(tz)) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const canonical = (tz: string) => new Intl.DateTimeFormat('en', { timeZone: tz }).resolvedOptions().timeZone;

/*
 * Time zones offered by the picker. The spec defines no subset ("IANA zone"), so it is the runtime's full
 * list, with the default under its spec name (Asia/Kolkata) instead of the ICU alias (Asia/Calcutta).
 */
let zones: string[] | null = null;
export function timeZoneOptions(): string[] {
  if (!zones) {
    const def = canonical(DEFAULT_TIME_ZONE);
    const all = Intl.supportedValuesOf('timeZone').filter((tz) => tz === DEFAULT_TIME_ZONE || canonical(tz) !== def);
    zones = [...new Set([DEFAULT_TIME_ZONE, ...all])].sort((a, b) => a.localeCompare(b));
  }
  return zones;
}
