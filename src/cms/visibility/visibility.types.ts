/*
 * The Home Page Management tabs that carry a "Show on website" switch, in the admin panel's tab
 * order (HOME_PAGE_TABS). A key is exactly the tab's key, so the admin needs no mapping.
 */
export const SECTION_KEYS = [
  'top-bar',
  'brand-bar',
  'announcements',
  'hero',
  'glance',
  'quick-actions',
  'live-dashboard',
  'diploma',
  'board',
  'impact',
  'ecosystem',
  'schemes',
  'about',
] as const;

export type SectionKey = (typeof SECTION_KEYS)[number];

/* One tab's switch as the admin panel reads it. */
export interface SectionVisibility {
  key: SectionKey;
  /* The menu whose permissions guard the switch: `<menu>.view` to see it, `<menu>.update` to flip it. */
  menu: string;
  /* The flag's value; true while the section is not configured (nothing hides it). */
  visible: boolean;
  /* false when the section's settings row does not exist yet: there is nothing to switch. */
  configured: boolean;
  /* The settings row's version; null when not configured. */
  updatedAt: Date | null;
}
