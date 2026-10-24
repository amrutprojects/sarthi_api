/* A Marathi/English pair, matching the website's Bilingual type. */
export interface Bilingual {
  mr: string;
  en: string;
}

/* One statistic card as the admin panel edits it. `value` is the figure exactly as printed ('1,000+'). */
export interface AdminImpactStat {
  id: string;
  value: string;
  label: Bilingual;
  displayOrder: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface AdminImpactSection {
  id: string;
  heading: Bilingual;
  showSection: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/* One card as the website receives it: active cards only, in display order. */
export interface PublicImpactStat {
  id: string;
  value: string;
  label: Bilingual;
}

export interface PublicImpactSection {
  heading: Bilingual;
  /* false: the website leaves the whole section out; `stats` is then empty. */
  showSection: boolean;
  stats: PublicImpactStat[];
}

export interface CreateImpactStatInput {
  value: string;
  label: Bilingual;
  displayOrder?: number;
  isActive?: boolean;
}

/* A partial update: an absent key is left exactly as it is. */
export interface UpdateImpactStatInput extends Partial<CreateImpactStatInput> {
  expectedUpdatedAt?: string;
}

export interface UpdateImpactSectionInput {
  heading: Bilingual;
  showSection: boolean;
  expectedUpdatedAt?: string;
}
