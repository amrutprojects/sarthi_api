import type { EntityManager } from 'typeorm';

/*
 * Where the values of a configured field are stored. L-38: "its data type cannot change once values exist"
 * (FIELD_TYPE_LOCKED) and "a custom field is archived, not deleted, while values exist".
 *
 * ======================================= FORM FIELD VALUE SOURCES =======================================
 * The module that stores a configurable form's records appends ONE entry here, e.g. the Trainer Profile
 * (L-12, DB-321 trainer.custom_fields jsonb):
 *     { formCode: 'TRAINER_PROFILE', count: (m, fieldCode) => countTrainersWithCustomValue(m, fieldCode) },
 * `count` returns how many non-deleted records hold a value for the field.
 * The Trainer Profile does not exist in this system yet, so no value can exist and the list is empty.
 * ========================================================================================================
 */
export interface FormFieldValueSource {
  formCode: string;
  count: (m: EntityManager, fieldCode: string) => Promise<number>;
}

export const FORM_FIELD_VALUE_SOURCES: FormFieldValueSource[] = [
  /* ↓ form record modules append their source here ↓ */
];

export async function countStoredValues(m: EntityManager, formCode: string, fieldCode: string): Promise<number> {
  let total = 0;
  for (const s of FORM_FIELD_VALUE_SOURCES) if (s.formCode === formCode) total += await s.count(m, fieldCode);
  return total;
}
