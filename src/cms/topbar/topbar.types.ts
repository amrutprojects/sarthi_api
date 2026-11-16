/* A Marathi/English pair, matching the website's Bilingual type. */
export interface Bilingual {
  mr: string;
  en: string;
}

/* One Top Bar link as the admin panel edits it. */
export interface AdminTopBarLink {
  id: string;
  label: Bilingual;
  link: string;
  displayOrder: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/* `governmentName` is blank in both languages (never null) when the bold text is not shown, so the form round-trips as it is. */
export interface AdminTopBarSettings {
  id: string;
  governmentName: Bilingual;
  showLanguageToggle: boolean;
  /* Read-only here: the "Show on website" switch (/cms/section-visibility) is its one writer. */
  showSection: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/* One link as the website receives it: the label and a destination that is already normalised. */
export interface PublicTopBarLink {
  label: Bilingual;
  link: string;
}

export interface PublicTopBar {
  /* false: the website leaves the whole strip out, language switch included; `links` is then empty. */
  showSection: boolean;
  /* null when the name is blank: the website then leaves the bold text out. */
  governmentName: Bilingual | null;
  showLanguageToggle: boolean;
  /* Active links only, in display order. */
  links: PublicTopBarLink[];
}

export interface CreateTopBarLinkInput {
  label: Bilingual;
  link: string;
  displayOrder?: number;
  isActive?: boolean;
}

/* A partial update: an absent key is left exactly as it is. */
export interface UpdateTopBarLinkInput extends Partial<CreateTopBarLinkInput> {
  expectedUpdatedAt?: string;
}

export interface UpdateTopBarSettingsInput {
  /* Blank in both languages: no government name. */
  governmentName: Bilingual;
  showLanguageToggle: boolean;
  expectedUpdatedAt?: string;
}
