/* A Marathi/English pair, matching the website's Bilingual type. */
export interface Bilingual {
  mr: string;
  en: string;
}

export interface AdminObjective {
  id: string;
  text: Bilingual;
  displayOrder: number;
  isActive: boolean;
}

export interface AdminProgrammeHighlight {
  id: string;
  heading: Bilingual;
  subheading: Bilingual;
  tagline: Bilingual;
  certification: Bilingual;
  objectives: AdminObjective[];
  isPublished: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/*
 * What the website receives — the words, and whether to show them. No ids, timestamps or
 * soft-delete state, and only the objectives that are active.
 */
export interface PublicProgrammeHighlight {
  /* `isPublished`. false: the website leaves the whole band out; `objectives` is then empty. */
  showSection: boolean;
  heading: Bilingual;
  subheading: Bilingual;
  tagline: Bilingual;
  certification: Bilingual;
  objectives: Bilingual[];
}

export interface UpdateObjectiveInput {
  text: Bilingual;
  displayOrder?: number;
  isActive?: boolean;
}

export interface UpdateProgrammeHighlightInput {
  heading: Bilingual;
  subheading: Bilingual;
  tagline: Bilingual;
  certification: Bilingual;
  objectives: UpdateObjectiveInput[];
  isPublished?: boolean;
}
