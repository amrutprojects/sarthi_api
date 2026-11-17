/*
 * The website pages whose top banner (title and subtitle) is edited from the CMS, in the order the admin
 * screen lists them. Fixed: the website owns the pages and their default words, so the CMS stores a key
 * and an optional custom title and subtitle. The same list is the CHECK on page_banners."key"
 * (CmsPageBanners migration).
 */
export const PAGE_BANNER_KEYS = ['about', 'faq', 'programme', 'track', 'verify'] as const;

export type PageBannerKey = (typeof PAGE_BANNER_KEYS)[number];

/* A custom title or subtitle, in both languages. */
export interface PageBannerText {
  mr: string;
  en: string;
}

/* One page as the admin panel reads it. */
export interface AdminPageBanner {
  key: PageBannerKey;
  /* The custom title; null when none is set (the website uses its default title). */
  title: PageBannerText | null;
  /* The custom subtitle; null when none is set (the website uses its default subtitle). */
  subtitle: PageBannerText | null;
  /* The row's version; null when the page has no row. */
  updatedAt: Date | null;
}

/* What the website reads: every page, in order. */
export interface PublicPageBanners {
  items: { key: PageBannerKey; title: PageBannerText | null; subtitle: PageBannerText | null }[];
}
