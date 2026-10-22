import type { ListQuery } from '../../shared/utils/pagination';
import type { FormFieldTranslations } from './form-field.model';

/* Columns a client may sort by (?sortBy=). position = form, section, order. */
export type LmsFormFieldSortField = 'position' | 'label' | 'fieldCode' | 'createdAt' | 'updatedAt';

/* L-38 "Filter by form, section, compulsory, visible, custom / standard; search label"; isActive = status. */
export interface LmsFormFieldListQuery extends ListQuery<LmsFormFieldSortField> {
  formCode?: string;
  sectionCode?: string;
  isRequired?: boolean;
  isVisible?: boolean;
  isCustom?: boolean;
  /* true = only soft-deleted fields (restore candidates), with the same search, sort, paging and filters. */
  deleted?: boolean;
}

/* API shape of a field configuration row (list rows and detail). */
export interface PublicLmsFormField {
  id: string;
  formCode: string;
  formLabel: string | null;
  fieldCode: string;
  isCustom: boolean;
  isSystemLocked: boolean;
  label: string;
  helpText: string | null;
  translations: FormFieldTranslations;
  sectionCode: string;
  sectionLabel: string;
  sortOrder: number;
  dataType: string;
  options: string[] | null;
  rules: Record<string, unknown>;
  isVisible: boolean;
  isRequired: boolean;
  requiredStage: string;
  sensitivity: string;
  isExportable: boolean;
  /* ACTIVE / ARCHIVED (custom fields); standard fields are always true. */
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  /* Only on the single-record response: records holding a value; > 0 locks the type and blocks delete. */
  storedValues?: number;
  typeLocked?: boolean;
}

/* GET /lms/form-fields/form-options: the values the configuration form's dropdowns offer. */
export interface LmsFormFieldFormOptions {
  forms: { code: string; label: string; specRef: string; sections: { code: string; label: string }[] }[];
  customDataTypes: { code: string; rules: string[]; hasOptions: boolean }[];
  requiredStages: string[];
  sensitivities: string[];
  languages: { code: string; label: string }[];
  /* false while OQ-023 (platform languages) is open. */
  languagesConfirmed: boolean;
  fileConstraints: { extensions: readonly string[]; mimeTypes: readonly string[]; maxBytes: number };
}

/*
 * GET /lms/form-fields/forms/:formCode/sections: every section of a form — its standard sections in form
 * order, then each custom section (F-LMS-FFC-08) used by a non-deleted field, A to Z. Unlike the effective
 * configuration it includes sections whose fields are all hidden or archived.
 */
export interface LmsFormSectionSummary {
  code: string;
  /* The form's name for a standard section; null for a custom section (it has only a code). */
  label: string | null;
  isStandard: boolean;
  /* Non-deleted fields in the section, hidden and archived ones included. */
  fieldCount: number;
}

/* One field of the effective configuration (what a form renders and the server enforces). */
export interface EffectiveFormField {
  fieldCode: string;
  label: string;
  helpText: string | null;
  translations: FormFieldTranslations;
  dataType: string;
  options: string[] | null;
  rules: Record<string, unknown>;
  isRequired: boolean;
  requiredStage: string | null;
  isSystemLocked: boolean;
  isCustom: boolean;
  sensitivity: string;
  isExportable: boolean;
  sortOrder: number;
}

/* GET /lms/form-fields/forms/:formCode/effective: visible, active fields by section, in display order. */
export interface EffectiveFormConfiguration {
  form: { code: string; label: string; specRef: string };
  sections: { code: string; label: string; isCustomSection: boolean; fields: EffectiveFormField[] }[];
}

export interface CreateLmsFormFieldInput {
  formCode: string;
  fieldCode: string;
  label: string;
  helpText?: string | null;
  translations?: FormFieldTranslations;
  sectionCode: string;
  sortOrder?: number;
  dataType: string;
  options?: string[] | null;
  rules?: Record<string, unknown>;
  isVisible: boolean;
  isRequired: boolean;
  requiredStage: string;
  sensitivity: string;
  isExportable: boolean;
  isActive?: boolean;
}

/* undefined = not sent (left alone); null = cleared. dataType / options / rules / sensitivity / isExportable: custom fields only. */
export interface UpdateLmsFormFieldInput {
  label?: string;
  helpText?: string | null;
  translations?: FormFieldTranslations;
  sectionCode?: string;
  sortOrder?: number;
  dataType?: string;
  options?: string[] | null;
  rules?: Record<string, unknown>;
  isVisible?: boolean;
  isRequired?: boolean;
  requiredStage?: string;
  sensitivity?: string;
  isExportable?: boolean;
}
