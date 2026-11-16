/* A Marathi/English pair, matching the website's Bilingual type. */
export interface Bilingual {
  mr: string;
  en: string;
}

/* One announcement as the admin panel edits it. `detail` is null when it has none. */
export interface AdminAnnouncement {
  id: string;
  title: Bilingual;
  detail: Bilingual | null;
  link: string | null;
  displayOrder: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface AdminAnnouncementSettings {
  id: string;
  label: Bilingual;
  showSection: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/*
 * One announcement as the website receives it. `detail` and `link` are left out entirely when the
 * announcement has none, so the ticker prints just the bold title as plain text.
 */
export interface PublicAnnouncement {
  title: Bilingual;
  detail?: Bilingual;
  link?: string;
}

export interface PublicAnnouncements {
  /* false: the website leaves the whole ticker out; `items` is then empty. */
  showSection: boolean;
  label: Bilingual;
  /* Active announcements only, in display order; empty when the ticker is switched off. */
  items: PublicAnnouncement[];
}

export interface CreateAnnouncementInput {
  title: Bilingual;
  /* null, or blank in both languages: no detail. */
  detail?: Bilingual | null;
  link?: string | null;
  displayOrder?: number;
  isActive?: boolean;
}

/* A partial update: an absent key is left exactly as it is. */
export interface UpdateAnnouncementInput extends Partial<CreateAnnouncementInput> {
  expectedUpdatedAt?: string;
}

export interface UpdateAnnouncementSettingsInput {
  label: Bilingual;
  showSection: boolean;
  expectedUpdatedAt?: string;
}
