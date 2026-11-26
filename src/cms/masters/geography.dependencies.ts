import { P } from '../../modules/roles-permissions/permission.constants';
import { defineDependencies, rowsWhere, rowsWithJson } from '../../shared/dependencies/dependencies';

/*
 * What keeps a state, district or taluka from being deleted (shared/dependencies). A district is used by far more than
 * the Masters group: student registrations, the contact page, IPP candidate batches, Divisional Officer mappings, and
 * EDP applications, student import rows and LMS student reviews that keep its id in their JSON data. A deleted
 * coordinator's or user's own links are kept with them and do not count.
 */
const AGAIN = 'Deactivate it instead, or remove those records first.';

export const STATE_DEPENDENCIES = defineDependencies({
  kind: 'state',
  noun: 'state',
  table: 'states',
  permission: P.CMS_STATES_DELETE,
  hint: AGAIN,
  rules: [rowsWhere('districts', 'districts', 'stateId')],
});

export const DISTRICT_DEPENDENCIES = defineDependencies({
  kind: 'district',
  noun: 'district',
  table: 'districts',
  permission: P.CMS_DISTRICTS_DELETE,
  hint: AGAIN,
  rules: [
    rowsWhere('talukas', 'talukas', 'districtId'),
    rowsWhere('colleges', 'colleges', 'districtId'),
    rowsWhere('training centres', 'training_centres', 'districtId'),
    rowsWhere('centers', 'edp_centres', 'districtId'),
    rowsWhere('documents', 'documents', 'districtId'),
    rowsWhere('student registrations', 'students', 'districtId'),
    rowsWhere('IPP candidate batches', 'ipp_batches', 'districtId', { live: false }),
    rowsWhere('Divisional Officer district mappings', 'user_districts', 'districtId', {
      where: `"userId" IN (SELECT id FROM users WHERE "isDelete" = false)`,
    }),
    rowsWhere('contact coordinator districts', 'contact_coordinator_districts', 'districtId', {
      live: false,
      where: `"coordinatorId" IN (SELECT id FROM contact_coordinators WHERE "isDelete" = false)`,
    }),
    rowsWhere('contact district offices', 'contact_district_offices', 'districtId'),
    rowsWhere('contact training centres', 'contact_training_centres', 'districtId'),
    rowsWithJson('EDP applications', 'edp_applications', 'data', 'district_id'),
    rowsWithJson('student import rows', 'import_rows', 'data', 'districtId'),
    rowsWithJson('LMS student reviews', 'lms_student_reviews', 'data', 'districtId', { live: false }),
  ],
});

export const TALUKA_DEPENDENCIES = defineDependencies({
  kind: 'taluka',
  noun: 'taluka',
  table: 'talukas',
  permission: P.CMS_TALUKAS_DELETE,
  hint: AGAIN,
  rules: [
    rowsWhere('colleges', 'colleges', 'talukaId'),
    rowsWhere('training centres', 'training_centres', 'talukaId'),
    rowsWhere('centers', 'edp_centres', 'talukaId'),
    rowsWhere('student registrations', 'students', 'talukaId'),
    rowsWithJson('student import rows', 'import_rows', 'data', 'talukaId'),
    rowsWithJson('LMS student reviews', 'lms_student_reviews', 'data', 'talukaId', { live: false }),
  ],
});
