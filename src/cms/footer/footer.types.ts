import type { FooterLinkKind } from './footer.model';

/* A Marathi/English pair, matching the website's Bilingual type (public-site/content/types.ts). */
export interface Bilingual {
  mr: string;
  en: string;
}

/* ---------------- admin shapes ---------------- */

export interface AdminFooterLink {
  id: string;
  kind: FooterLinkKind;
  label: Bilingual;
  href: string | null;
  displayOrder: number;
  isActive: boolean;
}

export interface AdminFooterColumn {
  id: string;
  heading: Bilingual;
  displayOrder: number;
  isActive: boolean;
  links: AdminFooterLink[];
}

export interface AdminFooter {
  id: string;
  about: {
    heading: Bilingual;
    body: Bilingual;
    partnerLabel: Bilingual;
    partnerName: string;
  };
  linkColumns: AdminFooterColumn[];
  contact: {
    heading: Bilingual;
    address: Bilingual;
    email: string;
    phone: string;
    links: AdminFooterLink[];
  };
  bottom: {
    copyright: Bilingual;
    disclaimer: Bilingual;
  };
  isPublished: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/* ---------------- public shapes ---------------- */

/*
 * What the website receives. Narrower than the admin shape on purpose: no ids, no timestamps, no
 * publication flag, no soft-delete state. The link `kind` is lower-cased here to match the union
 * the website already uses (`internal | external | text | unavailable` in data/footer.ts), so the
 * site needs no translation layer of its own.
 */
export type PublicFooterLinkKind = 'internal' | 'external' | 'text' | 'unavailable';

export interface PublicFooterItem {
  kind: PublicFooterLinkKind;
  label: Bilingual;
  href?: string;
}

export interface PublicFooterColumn {
  heading: Bilingual;
  items: PublicFooterItem[];
}

export interface PublicFooter {
  about: {
    heading: Bilingual;
    body: Bilingual;
    partnerLabel: Bilingual;
    partnerName: string;
  };
  linkColumns: PublicFooterColumn[];
  contact: {
    heading: Bilingual;
    address: Bilingual;
    email: string;
    phone: string;
    items: PublicFooterItem[];
  };
  bottom: {
    copyright: Bilingual;
    disclaimer: Bilingual;
  };
}

/* ---------------- write shapes ---------------- */

export interface UpdateFooterLinkInput {
  kind: FooterLinkKind;
  label: Bilingual;
  href?: string | null;
  displayOrder?: number;
  isActive?: boolean;
}

export interface UpdateFooterColumnInput {
  heading: Bilingual;
  displayOrder?: number;
  isActive?: boolean;
  links: UpdateFooterLinkInput[];
}

export interface UpdateFooterInput {
  about: {
    heading: Bilingual;
    body: Bilingual;
    partnerLabel: Bilingual;
    partnerName: string;
  };
  linkColumns: UpdateFooterColumnInput[];
  contact: {
    heading: Bilingual;
    address: Bilingual;
    email: string;
    phone: string;
    links?: UpdateFooterLinkInput[];
  };
  bottom: {
    copyright: Bilingual;
    disclaimer: Bilingual;
  };
  isPublished?: boolean;
}
