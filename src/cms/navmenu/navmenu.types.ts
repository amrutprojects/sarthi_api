/*
 * The items of the website's menu bar (the saffron bar under the Brand Bar), in menu order, and its
 * Login / Register button. Fixed: the website owns the links and the default names, so the CMS stores
 * a key, its show/hide flag and an optional custom name. The same list is the CHECK on
 * nav_menu_items."key" (CmsNavMenu migration).
 */
export const NAV_MENU_KEYS = [
  'home',
  'about',
  'programme',
  'advisory',
  'modules',
  'eligibility',
  'apply',
  'faq',
  'contact',
  'login',
] as const;

export type NavMenuKey = (typeof NAV_MENU_KEYS)[number];

/* An item's custom name, in both languages. */
export interface NavMenuLabel {
  mr: string;
  en: string;
}

/* One item as the admin panel reads it. */
export interface AdminNavMenuItem {
  key: NavMenuKey;
  /* false: the website leaves the item out of the menu bar and the mobile menu. True while the item has no row. */
  show: boolean;
  /* The custom name; null when none is set (the website uses its default name). */
  label: NavMenuLabel | null;
  /* The row's version; null when the item has no row (nothing has hidden it). */
  updatedAt: Date | null;
}

/* What the website reads: every item, in menu order. */
export interface PublicNavMenu {
  items: { key: NavMenuKey; show: boolean; label: NavMenuLabel | null }[];
}
