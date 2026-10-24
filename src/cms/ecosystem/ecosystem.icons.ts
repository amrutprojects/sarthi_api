/*
 * The icons a programme card may use: identifiers from the website's own icon set
 * (public-site/shared/components/Icon.tsx, ported from the original ui.js and also present in the
 * admin panel's icon set). A card stores one of these names and nothing else — never markup, a URL or
 * a component name — so the CMS can only ever pick between glyphs the site already ships.
 *
 * The first eight are the ones the section used before it was managed. UI-chrome glyphs (arrows,
 * close, menu, search, …) are left out on purpose: they would read as controls on a card.
 * The admin panel's icon picker carries the same list (features/cms/ecosystem/icons.ts).
 */
export const ECOSYSTEM_ICONS = [
  'teacher',
  'building',
  'map',
  'users',
  'globe',
  'layers',
  'play',
  'award',
  'monitor',
  'clipboard',
  'chart',
  'shield',
  'home',
  'pin',
  'calendar',
  'megaphone',
  'phone',
  'mail',
  'rupee',
  'doc',
  'check',
  'folder',
  'plug',
  'qr',
  'settings',
] as const;

export type EcosystemIcon = (typeof ECOSYSTEM_ICONS)[number];

export const isEcosystemIcon = (v: unknown): v is EcosystemIcon => typeof v === 'string' && (ECOSYSTEM_ICONS as readonly string[]).includes(v);
