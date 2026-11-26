import { defineDependencies, rowsWhere } from '../../shared/dependencies/dependencies';

/*
 * What keeps a user from being deleted (shared/dependencies): the approvals, decisions and verifications they made,
 * and the districts they are mapped to as a Divisional Officer. Not their own role assignments, and not the rows they
 * merely created, uploaded or changed (stamps), nor audit logs and sessions.
 */
export const USER_DEPENDENCIES = defineDependencies({
  kind: 'user',
  noun: 'user',
  person: true,
  table: 'users',
  /* P.USERS_DELETE; a plain code so the module does not load roles-permissions (tests check every kind's code exists). */
  permission: 'users.delete',
  hint: 'Deactivate the account instead.',
  rules: [
    /* IPP candidate forms they decided as Divisional Officer, COEP, Head Office or Super Admin (append-only history). */
    rowsWhere('candidate application approvals', 'ipp_approval_events', 'byUserId', { live: false, where: `event = 'APPROVED'` }),
    rowsWhere('candidate application rejections', 'ipp_approval_events', 'byUserId', { live: false, where: `event = 'REJECTED'` }),
    rowsWhere('candidate application moves', 'ipp_approval_events', 'byUserId', { live: false, where: `event = 'MOVED'` }),
    rowsWhere('Divisional Officer district mappings', 'user_districts', 'userId'),
    rowsWhere('student import row decisions', 'import_rows', 'decidedById'),
    rowsWhere('finalised student imports', 'import_batches', 'finalisedById'),
    rowsWhere('cancelled student imports', 'import_batches', 'cancelledById'),
    rowsWhere('student document verifications', 'student_documents', 'verifiedById'),
    rowsWhere('Document Master verifications', 'documents', 'verifiedById'),
    rowsWhere('LMS student review decisions', 'lms_student_reviews', 'decidedById', { live: false }),
  ],
});
