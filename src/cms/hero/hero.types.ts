/* A Marathi/English pair, matching the website's Bilingual type. */
export interface Bilingual {
  mr: string;
  en: string;
}

export interface AdminHeroSlide {
  id: string;
  tag: Bilingual;
  title: Bilingual;
  description: Bilingual;
  ctaLabel: Bilingual;
  ctaLink: string;
  displayOrder: number;
  isActive: boolean;
}

/**
 * The "Programme at a glance" card beside the slides.
 *
 * Four figures. Three are DERIVED from the modules — total hours is the sum of each active
 * module's own total, and the module and domain counts are the lists themselves — so they cannot
 * contradict the Modules page and are read-only here. Only the district count is stored, because
 * nothing in the programme content supplies it: the geography master holds the districts a FORM
 * may choose from, which is a different thing.
 */
export interface HeroGlance {
  /** Summed from the active modules. Read-only. */
  totalHours: number;
  /** Active modules. Read-only. */
  modules: number;
  /** Distinct employment domains across the active modules. Read-only. */
  domains: number;
  /** The one figure an administrator enters. */
  districtCount: number;
  /**
   * How the modules line reads on the page: "4 × 120 hours" when every module runs the same
   * length, and just the count when they differ.
   */
  modulesLabel: string;
  /** Modules switched off, and so absent from both the website and the figures above. */
  hiddenModules: number;
}

export interface AdminHomeHero {
  id: string;
  readMoreLabel: Bilingual;
  checkStatusLabel: Bilingual;
  slides: AdminHeroSlide[];
  /* null while the Modules page content has not been configured: there is nothing to sum. */
  glance: HeroGlance | null;
  /* false: the whole banner, the glance card included, is hidden from the website. */
  isPublished: boolean;
  /* The glance card on its own. Read-only here: the "Show on website" switch (/cms/section-visibility) is its one writer. */
  showGlance: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface PublicHeroSlide {
  tag: Bilingual;
  title: Bilingual;
  description: Bilingual;
  ctaLabel: Bilingual;
  ctaLink: string;
}

/*
 * What the website receives — the words and links, and the two visibility switches. No ids,
 * timestamps, order numbers or soft-delete state, and only the slides that are visible, already in order.
 */
export interface PublicHomeHero {
  /* `isPublished`. false: the website leaves the whole banner out, glance card included; `slides` is then empty. */
  showSection: boolean;
  /* false: the website leaves out only the "Programme at a glance" card (its figures come from /public/modules). */
  showGlance: boolean;
  readMoreLabel: Bilingual;
  checkStatusLabel: Bilingual;
  slides: PublicHeroSlide[];
}

export interface UpdateHeroSlideInput {
  tag: Bilingual;
  title: Bilingual;
  description: Bilingual;
  ctaLabel: Bilingual;
  ctaLink: string;
  displayOrder?: number;
  isActive?: boolean;
}

export interface UpdateHomeHeroInput {
  readMoreLabel: Bilingual;
  checkStatusLabel: Bilingual;
  slides: UpdateHeroSlideInput[];
  isPublished?: boolean;
  /* The district figure on the "at a glance" card. Left untouched when omitted. */
  districtCount?: number;
  /* The updatedAt the admin screen loaded; a save against an older version is refused. */
  expectedUpdatedAt?: string;
}
