/*
 * The icons a Quick Actions tile may use: identifiers from the website's own icon set
 * (public-site/shared/components/Icon.tsx, also present in the admin panel's icon set). A tile stores
 * one of these names and nothing else — never markup, a URL or a component name — so the CMS can only
 * ever pick between glyphs the site already ships.
 *
 * The first four are the ones the strip used before it was managed (Apply Now, Check Application
 * Status, Verify Certificate, Training centres). The same list is written out in the CHECK on
 * quick_actions.icon (migration 1797300000000-CmsQuickActions), and the admin panel's icon picker
 * carries it too: a name added here must be added to all three.
 */
export const QUICK_ACTION_ICONS = [
  'plus',
  'search',
  'qr',
  'building',
  'doc',
  'check',
  'clipboard',
  'award',
  'users',
  'teacher',
  'phone',
  'mail',
  'help',
  'download',
  'calendar',
  'pin',
  'map',
  'home',
  'globe',
  'megaphone',
  'bell',
  'eye',
  'rupee',
  'layers',
  'monitor',
  'chart',
  'shield',
  'folder',
  'settings',
  'play',
  'clock',
] as const;

export type QuickActionIcon = (typeof QUICK_ACTION_ICONS)[number];

export const isQuickActionIcon = (v: unknown): v is QuickActionIcon =>
  typeof v === 'string' && (QUICK_ACTION_ICONS as readonly string[]).includes(v);
