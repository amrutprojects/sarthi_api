import { P } from '../modules/roles-permissions/permission.constants';
import { defineDependencies, rowsWhere, rowsWithJson } from '../shared/dependencies/dependencies';

/*
 * What keeps a record of the Masters group from being deleted (shared/dependencies). Every delete of src/masters checks
 * its kind here; a master nothing points at has no rules and is always deletable, but goes through the same check so a
 * reference added later only needs one line here. An LMS entity's own centre selection counts only while the entity
 * itself is not deleted (its selection stays with it).
 */
const AGAIN = 'Deactivate it instead, or remove those records first.';

export const DEPARTMENT_DEPENDENCIES = defineDependencies({
  kind: 'department',
  noun: 'department',
  table: 'departments',
  permission: P.CMS_DEPARTMENTS_DELETE,
  rules: [],
});

export const COLLEGE_DEPENDENCIES = defineDependencies({
  kind: 'college',
  noun: 'college',
  table: 'colleges',
  permission: P.CMS_COLLEGES_DELETE,
  rules: [],
});

export const CENTRE_DEPENDENCIES = defineDependencies({
  kind: 'centre',
  noun: 'center',
  table: 'edp_centres',
  permission: P.CMS_CENTRES_DELETE,
  hint: 'Deactivate it instead.',
  rules: [
    rowsWhere('student registrations', 'students', 'centreId'),
    rowsWithJson('EDP applications', 'edp_applications', 'data', 'centre_id'),
  ],
});

export const CENTRE_TYPE_DEPENDENCIES = defineDependencies({
  kind: 'centre-type',
  noun: 'training centre type',
  table: 'training_centre_types',
  permission: P.CMS_CENTRE_TYPES_DELETE,
  hint: AGAIN,
  rules: [rowsWhere('training centres', 'training_centres', 'centreTypeId')],
});

export const TRAINING_CENTRE_DEPENDENCIES = defineDependencies({
  kind: 'training-centre',
  noun: 'training centre',
  table: 'training_centres',
  permission: P.CMS_TRAINING_CENTRES_DELETE,
  hint: AGAIN,
  rules: [
    rowsWhere('location information records', 'centre_locations', 'centreId'),
    rowsWhere('capacity & infrastructure records', 'centre_infrastructure', 'centreId'),
    rowsWhere('batches', 'batches', 'centreId'),
    rowsWhere('documents', 'documents', 'centreId'),
    rowsWhere('LMS entity centre selections', 'lms_entity_centres', 'centreId', {
      where: `"entityId" IN (SELECT id FROM lms_entities WHERE "isDelete" = false)`,
    }),
    rowsWhere('LMS academic calendars', 'lms_academic_calendars', 'centreId'),
  ],
});

export const CENTRE_LOCATION_DEPENDENCIES = defineDependencies({
  kind: 'centre-location',
  noun: 'location information record',
  table: 'centre_locations',
  permission: P.CMS_CENTRE_LOCATIONS_DELETE,
  rules: [],
});

export const CENTRE_INFRASTRUCTURE_DEPENDENCIES = defineDependencies({
  kind: 'centre-infrastructure',
  noun: 'capacity & infrastructure record',
  table: 'centre_infrastructure',
  permission: P.CMS_CENTRE_INFRASTRUCTURE_DELETE,
  rules: [],
});

export const BATCH_DEPENDENCIES = defineDependencies({
  kind: 'batch',
  noun: 'batch',
  table: 'batches',
  permission: P.CMS_BATCHES_DELETE,
  hint: AGAIN,
  rules: [rowsWhere('student batch assignments', 'batch_assignments', 'batchId')],
});

export const BATCH_ASSIGNMENT_DEPENDENCIES = defineDependencies({
  kind: 'batch-assignment',
  noun: 'batch assignment',
  table: 'batch_assignments',
  permission: P.CMS_BATCH_ASSIGNMENTS_DELETE,
  rules: [],
});

export const DOCUMENT_DEPENDENCIES = defineDependencies({
  kind: 'document',
  noun: 'document',
  table: 'documents',
  permission: P.CMS_DOCUMENTS_DELETE,
  rules: [],
});
