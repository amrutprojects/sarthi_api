/* A Marathi/English pair, matching the website's Bilingual type. */
export interface Bilingual {
  mr: string;
  en: string;
}

export interface AdminAboutSection {
  id: string;
  heading: Bilingual;
  /* { mr: '', en: '' } when there is no subtitle. */
  subtitle: Bilingual;
  description: Bilingual;
  showSection: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface AdminAboutFact {
  id: string;
  label: Bilingual;
  value: Bilingual;
  displayOrder: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface AdminAboutCard {
  id: string;
  heading: Bilingual;
  description: Bilingual;
  displayOrder: number;
  isActive: boolean;
  /* One of the original Mission / Vision / Values cards: editable, never deleted or hidden. */
  isRequired: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/* Everything the admin dashboard edits, in one read. Hidden rows and cards included, in display order. */
export interface AdminAbout {
  section: AdminAboutSection;
  facts: AdminAboutFact[];
  cards: AdminAboutCard[];
}

/*
 * What the website receives: visible rows and cards only, in display order, projected to what the
 * section prints. A hidden section comes back with `showSection: false` and no rows or cards.
 */
export interface PublicAbout {
  heading: Bilingual;
  subtitle: Bilingual | null;
  description: Bilingual;
  showSection: boolean;
  facts: { id: string; label: Bilingual; value: Bilingual }[];
  cards: { id: string; heading: Bilingual; description: Bilingual }[];
}

/* A partial update of the singleton: only the keys sent change. */
export interface UpdateAboutSectionInput {
  heading?: Bilingual;
  subtitle?: Bilingual;
  description?: Bilingual;
  showSection?: boolean;
  expectedUpdatedAt?: string;
}

/*
 * A row or a card, in the shape the shared list service handles: `first` is the row's label or the
 * card's heading, `second` its value or description.
 */
export interface AboutItemInput {
  first?: Bilingual;
  second?: Bilingual;
  displayOrder?: number;
  isActive?: boolean;
  expectedUpdatedAt?: string;
}
