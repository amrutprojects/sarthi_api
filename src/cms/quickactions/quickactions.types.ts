/* A Marathi/English pair, matching the website's Bilingual type. */
export interface Bilingual {
  mr: string;
  en: string;
}

/*
 * One Quick Actions tile as the admin panel edits it. `subtitle` is blank in both languages (never
 * null) when the tile has none, so the form round-trips as it is.
 */
export interface AdminQuickAction {
  id: string;
  title: Bilingual;
  subtitle: Bilingual;
  icon: string;
  link: string;
  displayOrder: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/* One tile as the website receives it: the texts, the icon name and a destination that is already normalised. */
export interface PublicQuickAction {
  title: Bilingual;
  /* null when the subtitle is blank: the website then leaves the small line out. */
  subtitle: Bilingual | null;
  icon: string;
  link: string;
}

export interface PublicQuickActions {
  /* false: the website leaves the whole strip out; `actions` is then empty. */
  showSection: boolean;
  /* Active tiles only, in display order. */
  actions: PublicQuickAction[];
}

export interface CreateQuickActionInput {
  title: Bilingual;
  /* null, or blank in both languages: no subtitle. */
  subtitle?: Bilingual | null;
  icon: string;
  link: string;
  displayOrder?: number;
  isActive?: boolean;
}

/* A partial update: an absent key is left exactly as it is. */
export interface UpdateQuickActionInput extends Partial<CreateQuickActionInput> {
  expectedUpdatedAt?: string;
}
