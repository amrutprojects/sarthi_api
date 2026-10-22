import type { ListQuery } from '../../shared/utils/pagination';

/* A Marathi/English pair, matching the website's Bilingual type (public-site/content/types.ts). */
export interface Bilingual {
  mr: string;
  en: string;
}

/* Columns a client may sort by (?sortBy=). Anything else is rejected by the validator. */
export type FaqSortField = 'displayOrder' | 'questionEn' | 'createdAt' | 'updatedAt';

export type FaqListQuery = ListQuery<FaqSortField>;

/* API shape of a question in the admin panel. The entity itself is never serialised to a response. */
export interface AdminFaq {
  id: string;
  question: Bilingual;
  answer: Bilingual;
  displayOrder: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/*
 * What the website receives. Narrower than the admin shape on purpose: no ids, no timestamps, no
 * status or soft-delete state — only the words the page prints, already in display order.
 */
export interface PublicFaq {
  question: Bilingual;
  answer: Bilingual;
}

export interface CreateFaqInput {
  question: Bilingual;
  answer: Bilingual;
  displayOrder?: number;
  isActive?: boolean;
}

export interface UpdateFaqInput {
  question?: Bilingual;
  answer?: Bilingual;
  displayOrder?: number;
}
