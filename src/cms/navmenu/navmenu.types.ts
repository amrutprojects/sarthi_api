/*
 * The items of the website's menu bar (the saffron bar under the Brand Bar), in menu order, and its
 * Login / Register button. Fixed: the website owns the labels and links, so a key is all the CMS
 * stores. The same list is the CHECK on nav_menu_items."key" (CmsNavMenu migration).
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

/* One item as the admin panel reads it. */
export interface AdminNavMenuItem {
  key: NavMenuKey;
  /* false: the website leaves the item out of the menu bar and the mobile menu. True while the item has no row. */
  show: boolean;
  /* The row's version; null when the item has no row (nothing has hidden it). */
  updatedAt: Date | null;
}

/* What the website reads: every item, in menu order. */
export interface PublicNavMenu {
  items: { key: NavMenuKey; show: boolean }[];
}
