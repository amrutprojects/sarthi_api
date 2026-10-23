/* A Marathi/English pair, matching the website's Bilingual type. */
export interface Bilingual {
  mr: string;
  en: string;
}

/* One card as the admin panel edits it. `linkLabel` is { mr: '', en: '' } when the card uses the default. */
export interface AdminEcosystemProgramme {
  id: string;
  name: Bilingual;
  description: Bilingual;
  icon: string;
  link: string | null;
  linkLabel: Bilingual;
  displayOrder: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface AdminEcosystemSection {
  id: string;
  heading: Bilingual;
  subtitle: Bilingual;
  linkLabel: Bilingual;
  showSection: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/*
 * One card as the website receives it: visible cards only, in display order, with the link label
 * already resolved (its own, or the section's default) so the site has nothing to merge.
 */
export interface PublicEcosystemProgramme {
  id: string;
  name: Bilingual;
  description: Bilingual;
  icon: string;
  link: string | null;
  linkLabel: Bilingual;
}

export interface PublicEcosystemSection {
  heading: Bilingual;
  subtitle: Bilingual | null;
  /* false: the website leaves the whole section out; `programmes` is then empty. */
  showSection: boolean;
  programmes: PublicEcosystemProgramme[];
}

export interface CreateProgrammeInput {
  name: Bilingual;
  description: Bilingual;
  icon: string;
  link?: string | null;
  linkLabel?: Bilingual;
  displayOrder?: number;
  isActive?: boolean;
}

/* A partial update: an absent key is left exactly as it is. */
export interface UpdateProgrammeInput extends Partial<CreateProgrammeInput> {
  expectedUpdatedAt?: string;
}

export interface UpdateEcosystemSectionInput {
  heading: Bilingual;
  subtitle: Bilingual;
  linkLabel: Bilingual;
  showSection: boolean;
  expectedUpdatedAt?: string;
}
