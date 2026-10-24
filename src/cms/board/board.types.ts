/* A Marathi/English pair, matching the website's Bilingual type. */
export interface Bilingual {
  mr: string;
  en: string;
}

/*
 * One member as the admin panel edits it. Optional pairs (description, subtitle) come back as
 * { mr: '', en: '' } when blank, so the form always has both halves to bind to.
 *
 * `photoUrl` is relative to the API base URL (e.g. '/cms/board-members/photos/<uuid>.jpg') and needs
 * the admin session: it serves the photos of hidden members too.
 */
export interface AdminBoardMember {
  id: string;
  name: string | null;
  category: Bilingual;
  designation: Bilingual;
  description: Bilingual;
  subtitle: Bilingual;
  photoUrl: string | null;
  displayOrder: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface AdminBoardSection {
  id: string;
  heading: Bilingual;
  subtitle: Bilingual;
  noticeTitle: Bilingual;
  noticeBody: Bilingual;
  showNotice: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/*
 * One card as the website receives it: visible members only, already in display order. Blank
 * optional text is null rather than an empty pair, so the site can simply leave the line out.
 * `photoUrl` is relative to the API base URL and unauthenticated ('/public/board-members/photos/…').
 */
export interface PublicBoardMember {
  id: string;
  name: string | null;
  category: Bilingual;
  designation: Bilingual;
  description: Bilingual | null;
  subtitle: Bilingual | null;
  photoUrl: string | null;
}

export interface PublicBoardSection {
  heading: Bilingual;
  subtitle: Bilingual | null;
  /* null when the notice is switched off. */
  notice: { title: Bilingual | null; body: Bilingual } | null;
  members: PublicBoardMember[];
}

export interface CreateBoardMemberInput {
  name: string | null;
  category: Bilingual;
  designation: Bilingual;
  description?: Bilingual;
  subtitle?: Bilingual;
  displayOrder?: number;
  isActive?: boolean;
}

/* A partial update: an absent key is left exactly as it is. */
export interface UpdateBoardMemberInput extends Partial<CreateBoardMemberInput> {
  /* Clear the current photo; the card falls back to the person icon. */
  removePhoto?: boolean;
  /* The updatedAt the admin screen loaded; a save against an older version is refused. */
  expectedUpdatedAt?: string;
}

export interface UpdateBoardSectionInput {
  heading: Bilingual;
  subtitle: Bilingual;
  noticeTitle: Bilingual;
  noticeBody: Bilingual;
  showNotice: boolean;
  expectedUpdatedAt?: string;
}

/* A photo that has passed the content check and is ready to store. */
export interface PhotoUpload {
  buffer: Buffer;
  ext: 'jpg' | 'png' | 'webp';
}
