import { countedBy, defineDependencies, rowsWhere } from '../../shared/dependencies/dependencies';

/*
 * What keeps a student registration from being deleted (shared/dependencies): a batch assignment holding a seat, the
 * link to the LMS, and the import rows, LMS reviews and requests and EDP applications that point at the student. The
 * student's own uploaded documents are part of the registration, not something that uses it.
 */
export const STUDENT_DEPENDENCIES = defineDependencies({
  kind: 'student',
  noun: 'student',
  person: true,
  table: 'students',
  permission: 'registrations.delete',
  hint: 'Deactivate the student instead.',
  rules: [
    rowsWhere('batch assignments', 'batch_assignments', 'studentId'),
    rowsWhere('LMS enrolment links', 'student_lms_link', 'studentId'),
    countedBy(
      'student import rows',
      `SELECT count(*)::int AS n FROM "import_rows" WHERE "isDelete" = false AND ("studentId" = $1 OR "matchStudentId" = $1)`,
    ),
    countedBy(
      'LMS student reviews',
      `SELECT count(*)::int AS n FROM "lms_student_reviews" WHERE "studentId" = $1 OR "matchStudentId" = $1`,
    ),
    rowsWhere('LMS student requests', 'lms_student_requests', 'studentId', { live: false }),
    rowsWhere('EDP applications', 'edp_applications', 'studentId'),
  ],
});
