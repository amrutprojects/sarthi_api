/**
 * The home page's "Programme at a glance" card.
 *
 * Four figures. Three are DERIVED from the modules — total hours is the sum of each active
 * module's own total, and the module and domain counts are the lists themselves — so they cannot
 * contradict the Modules page and are read-only here. Only the district count is stored, because
 * nothing in the programme content supplies it: the geography master holds the districts a FORM
 * may choose from, which is a different thing.
 */
export interface AdminHomeGlance {
  /** Summed from the active modules. Read-only. */
  totalHours: number;
  /** Active modules. Read-only. */
  modules: number;
  /** Distinct employment domains across the active modules. Read-only. */
  domains: number;
  /** The one figure an administrator enters. */
  districtCount: number;
  /**
   * How the modules line reads on the page: "4 × 120 hours" when every module runs the same
   * length, and just the count when they differ.
   */
  modulesLabel: string;
  /** Modules switched off, and so absent from both the website and the figures above. */
  hiddenModules: number;
  updatedAt: Date;
}

export interface UpdateHomeGlanceInput {
  districtCount: number;
}
