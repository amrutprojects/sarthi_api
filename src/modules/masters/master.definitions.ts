import type { EntityTarget } from 'typeorm';
import { Caste, DocumentType, Education, Region, type MasterEntity } from './master.entity';

export type MasterKey = 'region' | 'caste' | 'documentType' | 'education';

/* Everything that differs between the four masters; service, routes, validation and OpenAPI are generated from this. */
export interface MasterDefinition {
  key: MasterKey;
  entity: EntityTarget<MasterEntity>;
  table: string;
  /* Mounted at /api/v1/<path>. */
  path: string;
  /* Singular / plural labels for messages and docs. */
  label: string;
  plural: string;
  /* Permission module: <permission>.view|create|update|status|delete. */
  permission: string;
  /* Audit action prefix: <audit>.create|update|status|delete. */
  audit: string;
  codeMax: number;
  nameMax: number;
  /* SQL returning one row when the record is referenced by a non-deleted record ($1 = master id). */
  referencedSql: string;
  /* Document types carry the extra isMandatory flag. */
  hasMandatory?: boolean;
}

const studentFk = (col: string) => `SELECT 1 FROM "students" WHERE "isDelete" = false AND "${col}" = $1 LIMIT 1`;

export const MASTERS: Record<MasterKey, MasterDefinition> = {
  region: {
    key: 'region',
    entity: Region,
    table: 'regions',
    path: 'regions',
    label: 'Region',
    plural: 'Regions',
    permission: 'regions',
    audit: 'master.region',
    /* Stored in students.centreCode varchar(10). */
    codeMax: 10,
    nameMax: 150,
    referencedSql: studentFk('regionId'),
  },
  caste: {
    key: 'caste',
    entity: Caste,
    table: 'castes',
    path: 'castes',
    label: 'Caste',
    plural: 'Castes',
    permission: 'castes',
    audit: 'master.caste',
    codeMax: 20,
    /* Stored in students.caste varchar(80). */
    nameMax: 80,
    referencedSql: studentFk('casteId'),
  },
  documentType: {
    key: 'documentType',
    entity: DocumentType,
    table: 'document_types',
    /* Not /documents: /students/:id/documents serves uploaded files. */
    path: 'document-types',
    label: 'Document type',
    plural: 'Document types',
    permission: 'document-types',
    audit: 'master.document-type',
    /* student_documents.docType varchar(30); import columns doc_<code>. */
    codeMax: 20,
    nameMax: 150,
    referencedSql: `SELECT 1 WHERE EXISTS (SELECT 1 FROM "students" s WHERE s."isDelete" = false
        AND jsonb_path_exists(s."documents", '$.*.documentTypeId ? (@ == $id)', jsonb_build_object('id', $1::text)))
      OR EXISTS (SELECT 1 FROM "student_documents" d JOIN "document_types" t ON t."code" = d."docType"
        WHERE d."isDelete" = false AND t."id" = $1::uuid)`,
    hasMandatory: true,
  },
  education: {
    key: 'education',
    entity: Education,
    table: 'educations',
    path: 'education',
    label: 'Education',
    plural: 'Education qualifications',
    permission: 'education',
    audit: 'master.education',
    codeMax: 20,
    /* Stored in students.educationQualification varchar(150). */
    nameMax: 150,
    referencedSql: studentFk('educationId'),
  },
};

export const MASTER_LIST = Object.values(MASTERS);
export const MASTER_ACTIONS = ['view', 'create', 'update', 'status', 'delete'] as const;
export type MasterAction = (typeof MASTER_ACTIONS)[number];
export const masterPermission = (d: MasterDefinition, a: MasterAction) => `${d.permission}.${a}`;
