import type { ListQuery } from '../../shared/utils/pagination';
import type { ApplyItemKind } from './apply.model';

/* A Marathi/English pair, matching the website's Bilingual type (public-site/content/types.ts). */
export interface Bilingual {
  mr: string;
  en: string;
}

/* Columns a client may sort by (?sortBy=). Anything else is rejected by the validator. */
export type ApplySortField = 'kind' | 'displayOrder' | 'labelEn' | 'createdAt' | 'updatedAt';

export interface ApplyListQuery extends ListQuery<ApplySortField> {
  /* Optional filter: only the application steps, or only the "At a glance" rows. */
  kind?: ApplyItemKind;
}

/* The text around the two lists — what the settings row holds. */
export interface ApplyPageText {
  pageTitle: Bilingual;
  pageSubtitle: Bilingual;
  noteTitle: Bilingual;
  noteBody: Bilingual;
  glanceHeading: Bilingual;
  documentsHeading: Bilingual;
  ctaText: Bilingual;
  ctaLabel: Bilingual;
  /* The official portal the "Apply Now" button opens; one https link for both languages. */
  ctaUrl: string;
  ctaHint: Bilingual;
}

/* ---------------- admin shapes ---------------- */

/* API shape of the page text in the admin panel. The entity itself is never serialised to a response. */
export interface AdminApplySettings extends ApplyPageText {
  id: string;
  createdAt: Date;
  updatedAt: Date;
}

/* API shape of one step or "At a glance" row in the admin panel. */
export interface AdminApplyItem {
  id: string;
  kind: ApplyItemKind;
  label: Bilingual;
  value: Bilingual;
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
export interface PublicApplyStep {
  title: Bilingual;
  description: Bilingual;
}

export interface PublicApplyFact {
  label: Bilingual;
  value: Bilingual;
}

export interface PublicApplyPage extends ApplyPageText {
  steps: PublicApplyStep[];
  facts: PublicApplyFact[];
  /* The Eligibility page's active required documents, in their display order. */
  documents: Bilingual[];
}

/* ---------------- write shapes ---------------- */

export type UpdateApplySettingsInput = ApplyPageText;

export interface CreateApplyItemInput {
  kind: ApplyItemKind;
  label: Bilingual;
  value: Bilingual;
  displayOrder?: number;
  isActive?: boolean;
}

/* The kind is not editable: see ApplyPageItem. */
export interface UpdateApplyItemInput {
  label?: Bilingual;
  value?: Bilingual;
  displayOrder?: number;
}
