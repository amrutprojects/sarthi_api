import type { HighlightRowKey, HighlightRowLabel, HighlightRowLabels } from './highlight.model';

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
  /* The fact table rows the website leaves out, as keys in display order. Empty: every row is shown. */
  hiddenRows: HighlightRowKey[];
  /* The custom row names, by row key (known keys with both languages filled in only). Absent: the default name. */
  rowLabels: HighlightRowLabels;
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
  /* The fact table rows to leave out, in display order (sent also when the band is hidden). Empty: every row is shown. */
  hiddenRows: HighlightRowKey[];
  /* The custom row names, by row key (sent also when the band is hidden). Absent: the website's default name. */
  rowLabels: HighlightRowLabels;
}

/* A change to one fact table row: its switch, its custom name (null: back to the default name), or both. */
export interface HighlightRowChange {
  show?: boolean;
  label?: HighlightRowLabel | null;
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
