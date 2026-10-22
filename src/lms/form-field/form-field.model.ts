import { Column, Entity } from 'typeorm';
import { AppBaseEntity } from '../../database/base.entity';

/* Per-language label / help text (F-LMS-FFC-03 "per language"), keyed by platform language code. */
export type FormFieldTranslations = Partial<Record<string, { label?: string; helpText?: string }>>;

/* Validation rules of a custom field, typed per data type (see form-field.rules.ts). */
export type FormFieldRules = Record<string, unknown>;

/*
 * One field of a configurable data-capture form — AMRUT_KALASH_03 L-38 / FR-338, form F-LMS-FFC (Table 40),
 * table DB-305 form_field_config ("same structure as DB-207"), architecture decision AD-12: profile forms are
 * rendered and validated from this table (visible, compulsory, stage, custom fields).
 *
 * Key (form_code, field_code) among non-deleted rows. DB-305 has no foreign key: the configuration is per
 * form, not per LMS entity.
 *
 * Standard fields (isCustom false) come from the application's field catalogue, seeded by the migration
 * (BRL-349) and never created, archived or deleted here (F-LMS-FFC-02). Custom fields are added at run time;
 * status ACTIVE ↔ ARCHIVED is AppBaseEntity.isActive (L-38 "custom field: ACTIVE ↔ ARCHIVED").
 * Who changed what, and when, is the audit log (config.form_field.* events).
 */
@Entity({ name: 'lms_form_fields' })
export class LmsFormField extends AppBaseEntity {
  /* F-LMS-FFC-01: a form of LMS_CONFIGURABLE_FORMS. */
  @Column({ type: 'varchar', length: 40, name: 'formCode' })
  formCode!: string;

  /* F-LMS-FFC-02: the key the value is stored under; fixed once created. */
  @Column({ type: 'varchar', length: 60, name: 'fieldCode' })
  fieldCode!: string;

  /* false = standard field of the catalogue; true = custom field added in Form Field Configuration. */
  @Column({ type: 'boolean', name: 'isCustom', default: false })
  isCustom!: boolean;

  /* System-locked (Trainer Name): always visible and compulsory (L-38, BRL-349). */
  @Column({ type: 'boolean', name: 'isSystemLocked', default: false })
  isSystemLocked!: boolean;

  /* F-LMS-FFC-03: label ≤ 80 (unique within the form), help text ≤ 200; other languages in translations. */
  @Column({ type: 'varchar', length: 80 })
  label!: string;

  @Column({ type: 'varchar', length: 200, name: 'helpText', nullable: true })
  helpText!: string | null;

  @Column({ type: 'jsonb', default: () => `'{}'::jsonb` })
  translations!: FormFieldTranslations;

  /* F-LMS-FFC-08: section of the form (or a custom section) and position within it. */
  @Column({ type: 'varchar', length: 40, name: 'sectionCode' })
  sectionCode!: string;

  @Column({ type: 'integer', name: 'sortOrder' })
  sortOrder!: number;

  /* F-LMS-FFC-07: chosen for a custom field; the catalogue's control for a standard one. */
  @Column({ type: 'varchar', length: 20, name: 'dataType' })
  dataType!: string;

  /* Option list of a SINGLE_CHOICE / MULTIPLE_CHOICE custom field; null otherwise. */
  @Column({ type: 'jsonb', nullable: true })
  options!: string[] | null;

  /* Typed validation rules of a custom field ({} = none); standard fields keep the catalogue's rules. */
  @Column({ type: 'jsonb', default: () => `'{}'::jsonb` })
  rules!: FormFieldRules;

  /* F-LMS-FFC-04 (default on). */
  @Column({ type: 'boolean', name: 'isVisible', default: true })
  isVisible!: boolean;

  /* F-LMS-FFC-05 (default off: every field is optional except the system-locked ones). */
  @Column({ type: 'boolean', name: 'isRequired', default: false })
  isRequired!: boolean;

  /* F-LMS-FFC-06: ON_SAVE | ON_VERIFICATION (default ON_VERIFICATION). */
  @Column({ type: 'varchar', length: 20, name: 'requiredStage', default: 'ON_VERIFICATION' })
  requiredStage!: string;

  /* F-LMS-FFC-09: INTERNAL | PERSONAL | RESTRICTED, and whether the field is exported. */
  @Column({ type: 'varchar', length: 20, default: 'INTERNAL' })
  sensitivity!: string;

  @Column({ type: 'boolean', name: 'isExportable', default: true })
  isExportable!: boolean;
}
