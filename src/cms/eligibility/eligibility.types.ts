import type { ListQuery } from '../../shared/utils/pagination';
import type { EligibilityItemKind } from './eligibility.model';

/* A Marathi/English pair, matching the website's Bilingual type (public-site/content/types.ts). */
export interface Bilingual {
  mr: string;
  en: string;
}

/* Columns a client may sort by (?sortBy=). Anything else is rejected by the validator. */
export type EligibilitySortField = 'kind' | 'displayOrder' | 'labelEn' | 'createdAt' | 'updatedAt';

export interface EligibilityListQuery extends ListQuery<EligibilitySortField> {
  /* Optional filter: only the criteria, or only the required documents. */
  kind?: EligibilityItemKind;
}

/* The text around the two lists — what the settings row holds. */
export interface EligibilityPageText {
  pageTitle: Bilingual;
  pageSubtitle: Bilingual;
  criteriaHeading: Bilingual;
  documentsHeading: Bilingual;
  noteTitle: Bilingual;
  noteBody: Bilingual;
  /* False: the website leaves the note box out. */
  showNote: boolean;
}

/* ---------------- admin shapes ---------------- */

/* API shape of the page text in the admin panel. The entity itself is never serialised to a response. */
export interface AdminEligibilitySettings extends EligibilityPageText {
  id: string;
  createdAt: Date;
  updatedAt: Date;
}

/* API shape of one criterion or document in the admin panel. `value` is null for a DOCUMENT. */
export interface AdminEligibilityItem {
  id: string;
  kind: EligibilityItemKind;
  label: Bilingual;
  value: Bilingual | null;
  displayOrder: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/* ---------------- public shapes ---------------- */

/*
 * What the website receives. Narrower than the admin shapes on purpose: no ids, no timestamps, no
 * status or soft-delete state — only the words the page prints, each list already in display order.
 */
export interface PublicEligibilityCriterion {
  label: Bilingual;
  value: Bilingual;
}

export interface PublicEligibilityPage extends EligibilityPageText {
  criteria: PublicEligibilityCriterion[];
  documents: Bilingual[];
}

/* ---------------- write shapes ---------------- */

export type UpdateEligibilitySettingsInput = EligibilityPageText;

export interface CreateEligibilityItemInput {
  kind: EligibilityItemKind;
  label: Bilingual;
  value?: Bilingual | null;
  displayOrder?: number;
  isActive?: boolean;
}

/* The kind is not editable: see EligibilityItem. */
export interface UpdateEligibilityItemInput {
  label?: Bilingual;
  value?: Bilingual | null;
  displayOrder?: number;
}
