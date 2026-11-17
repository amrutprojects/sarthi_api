/*
 * The colour accent of a KPI card. The website maps them to its own classes (default → '', blue → 'b',
 * green → 'g', violet → 'v'). The migration's CHECK repeats this list: a name added here needs a
 * migration that widens it.
 */
export const LIVE_DASHBOARD_TONES = ['default', 'blue', 'green', 'violet'] as const;
export type LiveDashboardTone = (typeof LIVE_DASHBOARD_TONES)[number];

/* A district's programme status, as the map colours its tile. The same list as the migration's CHECK. */
export const DISTRICT_PROGRESS_STATUSES = [
  'NOT_STARTED',
  'PLANNING',
  'CENTRE_SELECTION',
  'MOBILIZATION',
  'TRAINING_ACTIVE',
  'COMPLETED',
  'ON_HOLD',
  'CRITICAL',
] as const;
export type DistrictProgressStatus = (typeof DISTRICT_PROGRESS_STATUSES)[number];

/* A Marathi/English pair, matching the website's Bilingual type. */
export interface Bilingual {
  mr: string;
  en: string;
}

/*
 * The section settings as the admin panel edits them. The optional texts come back as blank pairs
 * (never null), so the form round-trips as it is.
 */
export interface AdminLiveDashboardSettings {
  id: string;
  heading: Bilingual;
  subtitle: Bilingual;
  /* Read-only here: the "Show on website" switch (src/cms/visibility) is its one writer. */
  showSection: boolean;
  disclaimer: Bilingual;
  showDisclaimer: boolean;
  mapTitle: Bilingual;
  showMap: boolean;
  modesTitle: Bilingual;
  showModes: boolean;
  offlineLabel: Bilingual;
  onlineLabel: Bilingual;
  offlineCount: number;
  onlineCount: number;
  donutCenterLabel: Bilingual;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpdateLiveDashboardSettingsInput {
  heading: Bilingual;
  /* null, or blank in both languages: none. */
  subtitle?: Bilingual | null;
  disclaimer?: Bilingual | null;
  showDisclaimer: boolean;
  mapTitle: Bilingual;
  showMap: boolean;
  modesTitle: Bilingual;
  showModes: boolean;
  offlineLabel: Bilingual;
  onlineLabel: Bilingual;
  offlineCount: number;
  onlineCount: number;
  donutCenterLabel: Bilingual;
  expectedUpdatedAt?: string;
}

export interface AdminLiveDashboardCard {
  id: string;
  label: Bilingual;
  value: string;
  /* Blank in both languages when the card has no detail line. */
  detail: Bilingual;
  /* '' when the card is not a link. */
  link: string;
  tone: LiveDashboardTone;
  displayOrder: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateLiveDashboardCardInput {
  label: Bilingual;
  value: string;
  detail?: Bilingual | null;
  link?: string;
  tone?: LiveDashboardTone;
  displayOrder?: number;
  isActive?: boolean;
}

/* A partial update: an absent key is left exactly as it is. */
export interface UpdateLiveDashboardCardInput extends Partial<CreateLiveDashboardCardInput> {
  expectedUpdatedAt?: string;
}

export interface AdminLiveDashboardStat {
  id: string;
  label: Bilingual;
  value: string;
  displayOrder: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateLiveDashboardStatInput {
  label: Bilingual;
  value: string;
  displayOrder?: number;
  isActive?: boolean;
}

export interface UpdateLiveDashboardStatInput extends Partial<CreateLiveDashboardStatInput> {
  expectedUpdatedAt?: string;
}

/* The figures a district tile shows; the same keys in the admin panel, the PATCH body and the public feed. */
export interface DistrictFigures {
  status: DistrictProgressStatus;
  target: number;
  enrolled: number;
  trainingActive: number;
  completed: number;
  certified: number;
  attendancePct: number;
}

export interface AdminLiveDashboardDistrict extends DistrictFigures {
  id: string;
  code: string;
  name: Bilingual;
  displayOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpdateLiveDashboardDistrictInput extends Partial<DistrictFigures> {
  expectedUpdatedAt?: string;
}

/* What the website reads (GET /public/live-dashboard). */
export interface PublicLiveDashboard {
  /* false: the website leaves the whole section out; cards are then empty and map/modes null. */
  showSection: boolean;
  heading: Bilingual;
  subtitle: Bilingual | null;
  /* null when switched off or blank. */
  disclaimer: Bilingual | null;
  /* Active cards only, in display order. */
  cards: { id: string; label: Bilingual; value: string; detail: Bilingual | null; link: string | null; tone: LiveDashboardTone }[];
  /* null when the map card is switched off. */
  map: { title: Bilingual; districts: (DistrictFigures & { code: string; name: Bilingual })[] } | null;
  /* null when the training-modes card is switched off. */
  modes: {
    title: Bilingual;
    offline: { label: Bilingual; count: number };
    online: { label: Bilingual; count: number };
    centerLabel: Bilingual;
    /* Active figures only, in display order. */
    stats: { id: string; label: Bilingual; value: string }[];
  } | null;
}
