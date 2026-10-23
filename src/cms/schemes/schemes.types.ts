/* A Marathi/English pair, matching the website's Bilingual type. */
export interface Bilingual {
  mr: string;
  en: string;
}

/*
 * One scheme as the admin panel edits it. `badge` and `buttonLabel` are { mr: '', en: '' } when
 * blank; `deadline` is 'YYYY-MM-DD' or null.
 */
export interface AdminScheme {
  id: string;
  title: Bilingual;
  description: Bilingual;
  badge: Bilingual;
  deadline: string | null;
  link: string | null;
  buttonLabel: Bilingual;
  featured: boolean;
  displayOrder: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface AdminSchemesSection {
  id: string;
  heading: Bilingual;
  subtitle: Bilingual;
  buttonLabel: Bilingual;
  showSection: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/*
 * One card as the website receives it: active schemes only, in display order, with the button label
 * already resolved (its own, or the section's default) so the site has nothing to merge.
 */
export interface PublicScheme {
  id: string;
  title: Bilingual;
  description: Bilingual;
  /* null: no tag above the title. */
  badge: Bilingual | null;
  /* 'YYYY-MM-DD', or null when the scheme has no last date. */
  deadline: string | null;
  link: string | null;
  buttonLabel: Bilingual;
  featured: boolean;
}

export interface PublicSchemesSection {
  heading: Bilingual;
  subtitle: Bilingual | null;
  /* false: the website leaves the whole section out; `schemes` is then empty. */
  showSection: boolean;
  schemes: PublicScheme[];
}

export interface CreateSchemeInput {
  title: Bilingual;
  description: Bilingual;
  badge?: Bilingual;
  deadline?: string | null;
  link?: string | null;
  buttonLabel?: Bilingual;
  featured?: boolean;
  displayOrder?: number;
  isActive?: boolean;
}

/* A partial update: an absent key is left exactly as it is. */
export interface UpdateSchemeInput extends Partial<CreateSchemeInput> {
  expectedUpdatedAt?: string;
}

export interface UpdateSchemesSectionInput {
  heading: Bilingual;
  subtitle: Bilingual;
  buttonLabel: Bilingual;
  showSection: boolean;
  expectedUpdatedAt?: string;
}
