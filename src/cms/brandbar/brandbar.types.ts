/* A Marathi/English pair, matching the website's Bilingual type. */
export interface Bilingual {
  mr: string;
  en: string;
}

/* The Brand Bar as the admin panel edits it. Blank texts come back as '' (never null), so the form round-trips as it is. */
export interface AdminBrandBar {
  id: string;
  title: string;
  /* Two lines, each blank when it is not shown. */
  fullName: Bilingual;
  partnerLabel: Bilingual;
  partnerName: string;
  /* Whether the website prints the partner box. Off: the label and name are kept, but not shown. */
  showPartner: boolean;
  /* Read-only here: the "Show on website" switch (/cms/section-visibility) is its one writer. */
  showSection: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface PublicBrandBarPartner {
  /* null when the label is blank: the website then prints the name alone. */
  label: Bilingual | null;
  name: string;
}

export interface PublicBrandBar {
  /* false: the website leaves the whole bar out. */
  showSection: boolean;
  title: string;
  /* Each half is '' when that line is not shown. */
  fullName: Bilingual;
  /* null when the partner name is blank or the partner box is switched off: the website then leaves the partner block out. */
  partner: PublicBrandBarPartner | null;
}

export interface UpdateBrandBarInput {
  title: string;
  fullName: Bilingual;
  /* Blank in both languages: no label. */
  partnerLabel: Bilingual;
  /* Blank: no partner block. */
  partnerName: string;
  /* Absent: left as it is, so a client that does not know the switch can never reset it. */
  showPartner?: boolean;
  expectedUpdatedAt?: string;
}
