import {
  countedBy,
  defineDependencies,
  rowsWhere,
  rowsWithJson,
  type DependencyKind,
  type DependencyRule,
} from '../../shared/dependencies/dependencies';
import { MASTERS, masterPermission, type MasterKey } from './master.definitions';

/*
 * What keeps a Region, Caste, Document type or Education record from being deleted (shared/dependencies): student
 * registrations, EDP applications, student import rows and LMS student reviews that hold it (the last three keep the id
 * in their JSON data, without a foreign key). referencedSql in master.definitions.ts still locks the code of a used record.
 */
const heldBy = (studentColumn: string, edpKey: string, rowKey: string): DependencyRule[] => [
  rowsWhere('student registrations', 'students', studentColumn),
  rowsWithJson('EDP applications', 'edp_applications', 'data', edpKey),
  rowsWithJson('student import rows', 'import_rows', 'data', rowKey),
  rowsWithJson('LMS student reviews', 'lms_student_reviews', 'data', rowKey, { live: false }),
];

/* A document type is held inside each student's documents JSON, and by its code on uploaded files. */
const documentTypeRules: DependencyRule[] = [
  countedBy(
    'student registrations',
    `SELECT count(*)::int AS n FROM "students" s WHERE s."isDelete" = false
       AND jsonb_path_exists(s."documents", '$.*.documentTypeId ? (@ == $id)', jsonb_build_object('id', $1::text))`,
  ),
  countedBy(
    'uploaded student documents',
    `SELECT count(*)::int AS n FROM "student_documents" d JOIN "document_types" t ON t."code" = d."docType"
      WHERE d."isDelete" = false AND t."id" = $1::uuid`,
  ),
  countedBy(
    'EDP application files',
    `SELECT count(*)::int AS n FROM "edp_application_files" f JOIN "document_types" t ON t."code" = f."docType"
      WHERE f."isDelete" = false AND t."id" = $1::uuid`,
  ),
];

const define = (key: MasterKey, kind: string, noun: string, rules: DependencyRule[]) =>
  defineDependencies({
    kind,
    noun,
    table: MASTERS[key].table,
    permission: masterPermission(MASTERS[key], 'delete'),
    hint: 'Deactivate it instead.',
    rules,
  });

export const MASTER_DEPENDENCIES: Record<MasterKey, DependencyKind> = {
  region: define('region', 'region', 'region', heldBy('regionId', 'region_id', 'regionId')),
  caste: define('caste', 'caste', 'caste', heldBy('casteId', 'caste_id', 'casteId')),
  documentType: define('documentType', 'document-type', 'document type', documentTypeRules),
  education: define('education', 'education', 'education qualification', heldBy('educationId', 'education_id', 'educationId')),
};
