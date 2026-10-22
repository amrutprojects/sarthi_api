/*
 * Fixed values of the Course Master (AMRUT_KALASH_03 L-06 / FR-306, form F-LMS-06), each in ONE place.
 */

/*
 * Course lifecycle (L-06 "Course / module: DRAFT → PUBLISHED → RETIRED"; F-LMS-06-06; DB-310 statuses).
 * - DRAFT: the system default on creation.
 * - PUBLISHED: set by the first published content release (L-30). Content releases (DB-312) are not built
 *   in this system yet, so no endpoint sets it.
 * - RETIRED: the Retire action, from PUBLISHED only ("retired, never deleted" once a release uses it).
 */
export const COURSE_STATUSES = ['DRAFT', 'PUBLISHED', 'RETIRED'] as const;
export type CourseStatus = (typeof COURSE_STATUSES)[number];

/*
 * F-LMS-06-01: A–Z, 0–9 and hyphen. The spec gives no length; the entity code's 2–20 (F-LMS-03-02, the
 * same character rule) is used. Same shape as CHK_lms_entities_code_upper.
 */
export const COURSE_CODE_MAX = 20;
