/*
 * Register buckets and the dashboard summary (GET /students/summary).
 *
 * applications  = every non-deleted student, any status, active or not
 * pending       = status REGISTRATION_PENDING
 * eligible      = status RECEIVED, active, not deleted (the statuses that may take a batch seat)
 * enrolled      = eligible with a live batch assignment (assignment active, not deleted)
 * awaiting      = eligible without one (awaitingBatch in the summary)
 */
export const STUDENT_BUCKETS = ['applications', 'pending', 'eligible', 'enrolled', 'awaiting'] as const;
export type StudentBucket = (typeof STUDENT_BUCKETS)[number];

/* Track filter value for students whose track is to be confirmed (trackCode null); 'TBC' is kept as an alias. */
export const NO_TRACK = 'none';

export interface BucketCounts {
  applications: number;
  eligible: number;
  enrolled: number;
}

export interface StudentSummary {
  /* When the counts were taken (ISO 8601). */
  asOf: string;
  totals: BucketCounts & { pending: number; awaitingBatch: number; inactive: number };
  bySource: { source: string; count: number }[];
  /* Every active region of the regions master (code = students.centreCode), zeros included, ordered by name. */
  byCentre: (BucketCounts & { code: string; name: string })[];
  /* T01..T12 in order, then null = track to be confirmed. */
  byTrack: (BucketCounts & { code: string | null; name: string })[];
  /* Applications per master value, highest first; id null = not recorded. */
  byCaste: { id: string | null; name: string; count: number }[];
  byEducation: { id: string | null; name: string; count: number }[];
  /* The last 12 months up to the current one (APP_TIMEZONE): applications by coalesce(approvedAt, createdAt), enrolled by assignedAt. */
  byMonth: { month: string; applications: number; enrolled: number }[];
}

/* The live batch of a list row (null when the student has no active assignment). */
export interface StudentBatchRef {
  id: string;
  code: string;
  name: string;
}
