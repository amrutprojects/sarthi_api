import type { Request } from 'express';
import type { EntityManager } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { AppDataSource } from '../../config/database.config';
import { auditService } from '../../modules/audit';
import { AUDIT_ACTIONS } from '../../shared/constants/app.constants';
import { AppError, type ErrorDetail } from '../../shared/errors/app-error';
import type { Paginated } from '../../shared/utils/pagination';
import { lockForUpdate, plural } from '../../masters/shared/master-refs';
import { LMS_LANGUAGES_CONFIRMED, LMS_PLATFORM_LANGUAGES } from '../entity/entity.constants';
import {
  CUSTOM_FIELD_TYPES, FIELD_SENSITIVITIES, FILE_FIELD_CONSTRAINTS, LMS_CONFIGURABLE_FORMS, REQUIRED_STAGES, findForm, isChoiceType,
} from './form-field.constants';
import { LmsFormField, type FormFieldTranslations } from './form-field.model';
import { lmsFormFieldRepository } from './form-field.repository';
import { RULE_KEYS_BY_TYPE, checkTypedConfig, effectiveRules } from './form-field.rules';
import { countStoredValues } from './form-field.values';
import type {
  CreateLmsFormFieldInput, EffectiveFormConfiguration, EffectiveFormField, LmsFormFieldFormOptions, LmsFormFieldListQuery,
  LmsFormSectionSummary, PublicLmsFormField, UpdateLmsFormFieldInput,
} from './form-field.types';
import { assertNoDependencies, defineDependencies } from '../../shared/dependencies/dependencies';
import { P } from '../../modules/roles-permissions/permission.constants';

/*
 * The form field's delete rule (shared/dependencies): the records that hold a value for it (FORM_FIELD_VALUE_SOURCES).
 * remove() still answers its own FIELD_HAS_VALUES for them, which the admin panel and its tests know; this rule lets the
 * delete dialog ask the same question first, and catches any rule added here later.
 */
export const LMS_FORM_FIELD_DEPENDENCIES = defineDependencies({
  kind: 'lms-form-field',
  noun: 'form field',
  table: 'lms_form_fields',
  permission: P.LMS_FORM_FIELDS_DELETE,
  hint: 'Archive it instead.',
  rules: [
    {
      label: 'records holding a value',
      count: async (m, id) => {
        const field = await m.getRepository(LmsFormField).findOne({ where: { id } });
        return field ? countStoredValues(m, field.formCode, field.fieldCode) : 0;
      },
    },
  ],
});

const conflict = (message: string, field: string, detail: string, code = 'CONFLICT') => new AppError(409, message, code, [{ field, message: detail }]);

/* Spec error catalogue: FIELD_SYSTEM_LOCKED / FIELD_TYPE_LOCKED → 409. */
const SYSTEM_LOCKED = 'This field is required by the system and cannot be changed in this way.';
const systemLocked = (field: string) => conflict(SYSTEM_LOCKED, field, SYSTEM_LOCKED, 'FIELD_SYSTEM_LOCKED');
const TYPE_LOCKED = 'The type cannot be changed because values already exist.';

/* A standard field's type, options, rules and classification belong to the application's catalogue. */
const STANDARD = 'This is a standard field of the form: only its label, help text, visibility, compulsory rule, section and order can change.';

const HIDDEN_REQUIRED: ErrorDetail = { field: 'body.isRequired', message: 'A hidden field cannot be compulsory.' };

const sectionLabel = (formCode: string, sectionCode: string): string =>
  findForm(formCode)?.sections.find((s) => s.code === sectionCode)?.label ?? sectionCode;

const toPublic = (f: LmsFormField): PublicLmsFormField => ({
  id: f.id,
  formCode: f.formCode,
  formLabel: findForm(f.formCode)?.label ?? null,
  fieldCode: f.fieldCode,
  isCustom: f.isCustom,
  isSystemLocked: f.isSystemLocked,
  label: f.label,
  helpText: f.helpText,
  translations: f.translations,
  sectionCode: f.sectionCode,
  sectionLabel: sectionLabel(f.formCode, f.sectionCode),
  sortOrder: f.sortOrder,
  dataType: f.dataType,
  options: f.options,
  rules: f.rules,
  isVisible: f.isVisible,
  isRequired: f.isRequired,
  requiredStage: f.requiredStage,
  sensitivity: f.sensitivity,
  isExportable: f.isExportable,
  isActive: f.isActive,
  createdAt: f.createdAt,
  updatedAt: f.updatedAt,
});

/* What the audit records of a field (config.form_field.*: form, field, visible / compulsory / stage / label / order…). */
const snapshot = (f: Pick<LmsFormField, 'label' | 'helpText' | 'translations' | 'sectionCode' | 'sortOrder' | 'dataType' | 'options' | 'rules' | 'isVisible' | 'isRequired' | 'requiredStage' | 'sensitivity' | 'isExportable' | 'isActive'>) => ({
  label: f.label,
  helpText: f.helpText,
  translations: f.translations,
  sectionCode: f.sectionCode,
  sortOrder: f.sortOrder,
  dataType: f.dataType,
  options: f.options,
  rules: f.rules,
  isVisible: f.isVisible,
  isRequired: f.isRequired,
  requiredStage: f.requiredStage,
  sensitivity: f.sensitivity,
  isExportable: f.isExportable,
  isActive: f.isActive,
});

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

type Editable = Pick<
  LmsFormField,
  'label' | 'helpText' | 'translations' | 'sectionCode' | 'sortOrder' | 'dataType' | 'options' | 'rules' | 'isVisible' | 'isRequired' | 'requiredStage' | 'sensitivity' | 'isExportable'
>;

/*
 * Form Field Configuration — AMRUT_KALASH_03 L-38 / FR-338, form F-LMS-FFC (Table 40), table DB-305, AD-12.
 *
 * - Standard fields come from the catalogue (seeded, BRL-349) and are never added, archived or deleted
 *   here; their label, help text, visibility, compulsory rule, stage, section and order are configurable.
 * - Custom fields are added here (custom_added), configurable in full, archived (ACTIVE ↔ ARCHIVED), and
 *   deleted only while no record holds a value (FORM_FIELD_VALUE_SOURCES) — otherwise archived.
 * - System-locked fields (Trainer Name) stay visible and compulsory on every save: FIELD_SYSTEM_LOCKED.
 * - A hidden field cannot be compulsory (422). The type of a field with values cannot change:
 *   FIELD_TYPE_LOCKED. Options and rules are checked against the data type (form-field.rules.ts).
 * - Field key and label are unique within the form among non-deleted rows (409 with the field).
 * - Every write runs in one transaction with its audit record (before / after values); the change takes
 *   effect on the next request (the effective configuration is read from the table each time).
 * - Re-checking existing profiles after a rule change (BRL-350 'profile incomplete', NOT-346) belongs to
 *   the Trainer Profile (L-12), which does not exist in this system yet.
 */
export class LmsFormFieldService {
  async list(q: LmsFormFieldListQuery): Promise<Paginated<PublicLmsFormField>> {
    const page = await lmsFormFieldRepository.list(q);
    return { items: page.items.map(toPublic), meta: page.meta };
  }

  async get(id: string): Promise<PublicLmsFormField> {
    const field = await lmsFormFieldRepository.findById(id);
    if (!field) throw AppError.notFound('Form field not found');
    const storedValues = await countStoredValues(AppDataSource.manager, field.formCode, field.fieldCode);
    return { ...toPublic(field), storedValues, typeLocked: storedValues > 0 };
  }

  formOptions(): LmsFormFieldFormOptions {
    return {
      forms: LMS_CONFIGURABLE_FORMS.map((f) => ({ code: f.code, label: f.label, specRef: f.specRef, sections: f.sections.map((s) => ({ ...s })) })),
      customDataTypes: CUSTOM_FIELD_TYPES.map((code) => ({ code, rules: RULE_KEYS_BY_TYPE[code], hasOptions: isChoiceType(code) })),
      requiredStages: [...REQUIRED_STAGES],
      sensitivities: [...FIELD_SENSITIVITIES],
      languages: LMS_PLATFORM_LANGUAGES.map((l) => ({ code: l.code, label: l.label })),
      languagesConfirmed: LMS_LANGUAGES_CONFIRMED,
      fileConstraints: FILE_FIELD_CONSTRAINTS,
    };
  }

  /*
   * The configuration a form is rendered and validated from (AD-12; L-38 "the form is rendered from the same
   * configuration, so interface and API cannot disagree"): active, visible fields grouped by section — the
   * form's sections in their order, then custom sections A to Z — each in display order.
   */
  async effective(formCode: string): Promise<EffectiveFormConfiguration> {
    const form = findForm(formCode);
    if (!form) throw AppError.notFound('Form not found');
    const rows = await lmsFormFieldRepository.findEffective(formCode);

    const standardOrder = form.sections.map((s) => s.code as string);
    const sectionCodes = [...new Set(rows.map((r) => r.sectionCode))].sort((a, b) => {
      const ia = standardOrder.indexOf(a);
      const ib = standardOrder.indexOf(b);
      if (ia >= 0 || ib >= 0) return (ia < 0 ? Infinity : ia) - (ib < 0 ? Infinity : ib);
      return a.localeCompare(b);
    });

    const toField = (f: LmsFormField): EffectiveFormField => ({
      fieldCode: f.fieldCode,
      label: f.label,
      helpText: f.helpText,
      translations: f.translations,
      dataType: f.dataType,
      options: f.options,
      rules: effectiveRules(f.dataType, f.rules),
      isRequired: f.isRequired,
      requiredStage: f.isRequired ? f.requiredStage : null,
      isSystemLocked: f.isSystemLocked,
      isCustom: f.isCustom,
      sensitivity: f.sensitivity,
      isExportable: f.isExportable,
      sortOrder: f.sortOrder,
    });

    return {
      form: { code: form.code, label: form.label, specRef: form.specRef },
      sections: sectionCodes.map((code) => ({
        code,
        label: sectionLabel(formCode, code),
        isCustomSection: !standardOrder.includes(code),
        fields: rows.filter((r) => r.sectionCode === code).map(toField),
      })),
    };
  }

  /*
   * Every section of one form (F-LMS-FFC-08): its standard sections in form order, each with its field count
   * (0 when empty), then every custom section any non-deleted field uses, A to Z. Counts include hidden and
   * archived fields, so a section whose fields are all hidden or archived is still listed (the section filter
   * and picker need it; the effective configuration leaves such sections out).
   */
  async sections(formCode: string): Promise<LmsFormSectionSummary[]> {
    const form = findForm(formCode);
    if (!form) throw AppError.notFound('Form not found');
    const counts = await lmsFormFieldRepository.countBySection(formCode);
    const standardCodes = form.sections.map((s) => s.code as string);
    const standard = form.sections.map((s) => ({ code: s.code as string, label: s.label as string | null, isStandard: true, fieldCount: counts.get(s.code) ?? 0 }));
    const custom = [...counts.keys()]
      .filter((code) => !standardCodes.includes(code))
      .sort((a, b) => a.localeCompare(b))
      .map((code) => ({ code, label: null, isStandard: false, fieldCount: counts.get(code) ?? 0 }));
    return [...standard, ...custom];
  }

  private async assertUniqueFieldCode(formCode: string, fieldCode: string, excludeId: string | undefined, m: EntityManager): Promise<void> {
    if (await lmsFormFieldRepository.findByFieldCode(formCode, fieldCode, { excludeId, manager: m })) {
      throw conflict('A field with this key already exists in the form', 'fieldCode', 'This field key is already used in the form.');
    }
  }

  /* F-LMS-FFC-03 "Label unique within the form" (case-insensitive). */
  private async assertUniqueLabel(formCode: string, label: string, excludeId: string | undefined, m: EntityManager): Promise<void> {
    if (await lmsFormFieldRepository.findByLabel(formCode, label, { excludeId, manager: m })) {
      throw conflict('A field with this label already exists in the form', 'label', 'This label is already used in the form.');
    }
  }

  /*
   * F-LMS-FFC-03 "Label unique within the form", per language: the label this field shows in each platform
   * language (its translation, else its base label) must not be the label another field shows in it.
   */
  private async assertUniqueLanguageLabels(
    formCode: string, label: string, translations: FormFieldTranslations, excludeId: string | undefined, m: EntityManager,
  ): Promise<void> {
    for (const { code, label: language } of LMS_PLATFORM_LANGUAGES) {
      const own = translations[code]?.label;
      if (await lmsFormFieldRepository.findByLanguageLabel(formCode, code, own ?? label, { excludeId, manager: m })) {
        throw conflict(
          'A field with this label already exists in the form',
          own ? `translations.${code}.label` : 'label',
          `This label is already used in the form in ${language}.`,
        );
      }
    }
  }

  private typed(dataType: string, options: string[] | null | undefined, rules: Record<string, unknown> | undefined) {
    const result = checkTypedConfig(dataType, options, rules);
    if (!result.ok) throw AppError.validation(result.details);
    return result.value;
  }

  /* 'Add custom field' (F-LMS-FFC-02; audit config.form_field.custom_added). */
  async create(input: CreateLmsFormFieldInput, req?: Request): Promise<PublicLmsFormField> {
    const id = await AppDataSource.transaction(async (m) => {
      if (!input.isVisible && input.isRequired) throw AppError.validation([HIDDEN_REQUIRED]);
      const { options, rules } = this.typed(input.dataType, input.options, input.rules);
      await this.assertUniqueFieldCode(input.formCode, input.fieldCode, undefined, m);
      await this.assertUniqueLabel(input.formCode, input.label, undefined, m);
      await this.assertUniqueLanguageLabels(input.formCode, input.label, input.translations ?? {}, undefined, m);

      const field = await lmsFormFieldRepository.create(
        {
          formCode: input.formCode,
          fieldCode: input.fieldCode,
          isCustom: true,
          isSystemLocked: false,
          label: input.label,
          helpText: input.helpText ?? null,
          translations: input.translations ?? {},
          sectionCode: input.sectionCode,
          sortOrder: input.sortOrder ?? (await lmsFormFieldRepository.nextSortOrder(input.formCode, input.sectionCode, m)),
          dataType: input.dataType,
          options,
          rules,
          isVisible: input.isVisible,
          isRequired: input.isRequired,
          requiredStage: input.requiredStage,
          sensitivity: input.sensitivity,
          isExportable: input.isExportable,
          isActive: input.isActive ?? true,
        },
        m,
      );
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.LMS_FORM_FIELD_CREATE,
        resource: 'lms-form-field',
        resourceId: field.id,
        details: { event: 'config.form_field.custom_added', form: field.formCode, field: field.fieldCode, after: snapshot(field) },
      });
      return field.id;
    });
    return this.get(id);
  }

  /* Field rule change (audit config.form_field.updated, before and after). */
  async update(id: string, input: UpdateLmsFormFieldInput, req?: Request): Promise<PublicLmsFormField> {
    await AppDataSource.transaction(async (m) => {
      const field = await lockForUpdate(m, LmsFormField, id);
      if (!field) throw AppError.notFound('Form field not found');

      /* L-38: system-locked fields are always visible and compulsory (on every save, BRL-349). */
      if (field.isSystemLocked) {
        if (input.isVisible !== undefined && input.isVisible !== field.isVisible) throw systemLocked('isVisible');
        if (input.isRequired !== undefined && input.isRequired !== field.isRequired) throw systemLocked('isRequired');
        if (input.requiredStage !== undefined && input.requiredStage !== field.requiredStage) throw systemLocked('requiredStage');
      }

      /* F-LMS-FFC-07 / -09 apply to custom fields: a standard field keeps the catalogue's values. */
      if (!field.isCustom) {
        for (const key of ['dataType', 'options', 'rules', 'sensitivity', 'isExportable'] as const) {
          if (input[key] !== undefined && !same(input[key], field[key])) throw conflict(STANDARD, key, STANDARD, 'FIELD_STANDARD');
        }
      }

      const isVisible = input.isVisible ?? field.isVisible;
      const isRequired = input.isRequired ?? field.isRequired;
      if (!isVisible && isRequired) throw AppError.validation([HIDDEN_REQUIRED]);

      const columns: Partial<Editable> = {};
      const before: Record<string, unknown> = {};
      const set = <K extends keyof Editable>(key: K, value: Editable[K] | undefined) => {
        if (value === undefined || same(value, field[key])) return;
        columns[key] = value;
        before[key] = field[key];
      };

      if (field.isCustom && (input.dataType !== undefined || input.options !== undefined || input.rules !== undefined)) {
        const dataType = input.dataType ?? field.dataType;
        const typeChanged = dataType !== field.dataType;
        if (typeChanged && (await countStoredValues(m, field.formCode, field.fieldCode)) > 0) {
          throw conflict(TYPE_LOCKED, 'dataType', TYPE_LOCKED, 'FIELD_TYPE_LOCKED');
        }
        /* Left out: options carry over between choice types; rules carry over only within the same type. */
        const options = input.options !== undefined ? input.options : isChoiceType(dataType) ? field.options : null;
        const rules = input.rules !== undefined ? input.rules : typeChanged ? {} : field.rules;
        const checked = this.typed(dataType, options, rules);
        set('dataType', dataType);
        set('options', checked.options);
        set('rules', checked.rules);
      }

      const labelChanged = input.label !== undefined && input.label !== field.label;
      if (input.label !== undefined && labelChanged) await this.assertUniqueLabel(field.formCode, input.label, id, m);
      /* translations are replaced whole, so the labels shown per language come from the merged values. */
      if (labelChanged || (input.translations !== undefined && !same(input.translations, field.translations))) {
        await this.assertUniqueLanguageLabels(field.formCode, input.label ?? field.label, input.translations ?? field.translations, id, m);
      }
      set('label', input.label);
      set('helpText', input.helpText);
      set('translations', input.translations);
      set('sectionCode', input.sectionCode);
      set('sortOrder', input.sortOrder);
      set('isVisible', input.isVisible);
      set('isRequired', input.isRequired);
      set('requiredStage', input.requiredStage);
      if (field.isCustom) {
        set('sensitivity', input.sensitivity);
        set('isExportable', input.isExportable);
      }

      if (Object.keys(columns).length) {
        /* jsonb columns (rules, translations) are plain objects; TypeORM types them as nested partials. */
        await lmsFormFieldRepository.update(id, columns as QueryDeepPartialEntity<LmsFormField>, m);
      }
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.LMS_FORM_FIELD_UPDATE,
        resource: 'lms-form-field',
        resourceId: id,
        details: { event: 'config.form_field.updated', form: field.formCode, field: field.fieldCode, fields: Object.keys(columns), before, after: columns },
      });
    });
    return this.get(id);
  }

  /* Custom field ACTIVE ↔ ARCHIVED (audit config.form_field.archived). Archived: values kept, field no longer shown. */
  async setStatus(id: string, isActive: boolean, req?: Request): Promise<PublicLmsFormField> {
    await AppDataSource.transaction(async (m) => {
      const field = await lockForUpdate(m, LmsFormField, id);
      if (!field) throw AppError.notFound('Form field not found');
      if (!field.isCustom && !isActive) {
        throw conflict('Standard fields cannot be archived. Hide the field instead.', 'isActive', 'Only custom fields can be archived.', 'FIELD_STANDARD');
      }
      await lmsFormFieldRepository.update(id, { isActive }, m);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.LMS_FORM_FIELD_STATUS,
        resource: 'lms-form-field',
        resourceId: id,
        details: {
          event: isActive ? 'config.form_field.updated' : 'config.form_field.archived',
          form: field.formCode,
          field: field.fieldCode,
          before: { isActive: field.isActive },
          after: { isActive },
        },
      });
    });
    return this.get(id);
  }

  /*
   * Soft delete of a custom field that no record holds a value for. Standard fields cannot be deleted
   * (F-LMS-FFC-02); a custom field with values is archived, not deleted (L-38).
   */
  async remove(id: string, req?: Request): Promise<void> {
    await AppDataSource.transaction(async (m) => {
      const field = await lockForUpdate(m, LmsFormField, id);
      if (!field) throw AppError.notFound('Form field not found');
      if (!field.isCustom) throw new AppError(409, 'Standard fields cannot be deleted. Hide the field instead.', 'FIELD_STANDARD');
      const values = await countStoredValues(m, field.formCode, field.fieldCode);
      if (values > 0) {
        throw new AppError(409, `This custom field cannot be deleted while ${plural(values, 'record holds a value', 'records hold a value')}. Archive it instead.`, 'FIELD_HAS_VALUES');
      }
      await assertNoDependencies(LMS_FORM_FIELD_DEPENDENCIES, id, m);
      await lmsFormFieldRepository.softDelete(id, m);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.LMS_FORM_FIELD_DELETE,
        resource: 'lms-form-field',
        resourceId: id,
        details: { form: field.formCode, field: field.fieldCode, label: field.label },
      });
    });
  }

  /* Brings a deleted custom field back, archived. Refused when its key or label has been taken meanwhile. */
  async restore(id: string, req?: Request): Promise<PublicLmsFormField> {
    await AppDataSource.transaction(async (m) => {
      const existing = await lmsFormFieldRepository.findByIdIncludingDeleted(id, m);
      if (!existing) throw AppError.notFound('Form field not found');
      if (!existing.isDelete) throw AppError.conflict('Form field is not deleted');
      await this.assertUniqueFieldCode(existing.formCode, existing.fieldCode, id, m);
      await this.assertUniqueLabel(existing.formCode, existing.label, id, m);
      await this.assertUniqueLanguageLabels(existing.formCode, existing.label, existing.translations, id, m);
      await lmsFormFieldRepository.restore(id, m);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.LMS_FORM_FIELD_RESTORE,
        resource: 'lms-form-field',
        resourceId: id,
        details: { form: existing.formCode, field: existing.fieldCode, label: existing.label },
      });
    });
    return this.get(id);
  }
}

export const lmsFormFieldService = new LmsFormFieldService();
