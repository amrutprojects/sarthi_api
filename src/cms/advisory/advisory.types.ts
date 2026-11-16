/* A Marathi/English pair, matching the website's Bilingual type. */
export interface Bilingual {
  mr: string;
  en: string;
}

/* A profile list in each language: its items in order, already normalised ([] when empty). */
export interface BilingualList {
  mr: string[];
  en: string[];
}

/* The five profile lists, in the order the website's profile dialog prints them. */
export const PROFILE_LISTS = ['administrativeRoles', 'keyAchievements', 'majorContributions', 'researchLeadership', 'education'] as const;
export type ProfileList = (typeof PROFILE_LISTS)[number];

/*
 * One member as the admin panel edits it. Blank text comes back as '' and an empty list as [], in
 * each language, so the form always has both halves to bind to.
 *
 * `photoUrl` is relative to the API base URL (e.g. '/cms/advisory-committee/photos/<uuid>.jpg') and
 * needs the admin session: it serves the photos of hidden members too.
 */
export interface AdminAdvisoryMember {
  id: string;
  name: Bilingual;
  designation: Bilingual;
  experience: Bilingual;
  administrativeRoles: BilingualList;
  keyAchievements: BilingualList;
  majorContributions: BilingualList;
  researchLeadership: BilingualList;
  education: BilingualList;
  photoUrl: string | null;
  displayOrder: number;
  isActive: boolean;
  /* The member's group and its name (for the list and the view page); both null when ungrouped. */
  groupId: string | null;
  group: { id: string; name: Bilingual } | null;
  createdAt: Date;
  updatedAt: Date;
}

/*
 * A group as the admin panel edits it, hidden ones included. `memberCount` counts the members filed
 * under it, hidden members included (they are still in the group), so the delete prompt can say how
 * many trainers will be ungrouped.
 */
export interface AdminAdvisoryGroup {
  id: string;
  name: Bilingual;
  displayOrder: number;
  isActive: boolean;
  memberCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface AdminAdvisorySection {
  id: string;
  heading: Bilingual;
  subtitle: Bilingual;
  createdAt: Date;
  updatedAt: Date;
}

/* Profile text as the website receives it: a blank half is null, and the whole is null when both are. */
export interface PublicProfileText {
  mr: string | null;
  en: string | null;
}

/*
 * One member as the website receives it: visible members only, already in display order. A blank
 * position is null rather than an empty pair, so the site can simply leave the line out.
 *
 * The profile is sent exactly as stored, without any language fallback: a profile field or list is
 * null when it is blank in both languages, otherwise each language as written (null / [] for a blank
 * half). Choosing the visitor's language and falling back to the other is the website's job.
 * `photoUrl` is relative to the API base URL and unauthenticated ('/public/advisory-committee/photos/…').
 */
export interface PublicAdvisoryMember {
  id: string;
  name: Bilingual;
  designation: Bilingual | null;
  photoUrl: string | null;
  experience: PublicProfileText | null;
  administrativeRoles: BilingualList | null;
  keyAchievements: BilingualList | null;
  majorContributions: BilingualList | null;
  researchLeadership: BilingualList | null;
  education: BilingualList | null;
}

/* A visible group with its visible members, in member display order. */
export interface PublicAdvisoryGroup {
  id: string;
  name: Bilingual;
  members: PublicAdvisoryMember[];
}

/*
 * `members` are the visible members with no group, shown first under no heading; `groups` follow in
 * group display order. A group with no visible member is left out, and the members of a hidden group
 * appear nowhere. A website built before groups reads `members` only and simply shows fewer people.
 */
export interface PublicAdvisorySection {
  heading: Bilingual;
  subtitle: Bilingual | null;
  members: PublicAdvisoryMember[];
  groups: PublicAdvisoryGroup[];
}

export interface CreateAdvisoryMemberInput {
  name: Bilingual;
  /* An existing, non-deleted group; null (or absent on create) for none. */
  groupId?: string | null;
  designation?: Bilingual;
  experience?: Bilingual;
  administrativeRoles?: BilingualList;
  keyAchievements?: BilingualList;
  majorContributions?: BilingualList;
  researchLeadership?: BilingualList;
  education?: BilingualList;
  displayOrder?: number;
  isActive?: boolean;
}

/* A partial update: an absent key is left exactly as it is. */
export interface UpdateAdvisoryMemberInput extends Partial<CreateAdvisoryMemberInput> {
  /* Clear the current photo; the card falls back to the person icon. */
  removePhoto?: boolean;
  /* The updatedAt the admin screen loaded; a save against an older version is refused. */
  expectedUpdatedAt?: string;
}

export interface CreateAdvisoryGroupInput {
  name: Bilingual;
  isActive?: boolean;
}

/* A partial update; `expectedUpdatedAt` as for members. */
export interface UpdateAdvisoryGroupInput extends Partial<CreateAdvisoryGroupInput> {
  expectedUpdatedAt?: string;
}

export interface UpdateAdvisorySectionInput {
  heading: Bilingual;
  subtitle: Bilingual;
  expectedUpdatedAt?: string;
}

/* A photo that has passed the content check and is ready to store (the same shape board.photo.ts produces). */
export interface PhotoUpload {
  buffer: Buffer;
  ext: 'jpg' | 'png' | 'webp';
}
