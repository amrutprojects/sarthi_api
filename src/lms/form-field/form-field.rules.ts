import { z } from 'zod';
import { isoDate } from '../../shared/validation/common.validation';
import type { ErrorDetail } from '../../shared/errors/app-error';
import { FILE_FIELD_CONSTRAINTS, RULE_LENGTH_MAX, RULE_PATTERN_MAX, isChoiceType } from './form-field.constants';

/*
 * Typed validation rules of a custom field (F-LMS-FFC-07 "Data type and options"; L-38 "Custom-field values
 * … are validated by the server against the configured type and options").
 *
 * Each data type accepts only its own rules (strict schemas): length / pattern for text, min / max for
 * numbers, date bounds for dates, a selection count for multiple choice, nothing for yes / no, single
 * choice and file (the file rule is fixed by the spec: FILE_FIELD_CONSTRAINTS). Every rule is optional;
 * none is assumed by default. Options exist only for the choice types, and a choice type needs them.
 */

const length = z.number().int('Enter a whole number').min(0, 'Must be at least 0').max(RULE_LENGTH_MAX, `Must be at most ${RULE_LENGTH_MAX}`);

const validRegex = (p: string) => {
  try {
    new RegExp(p, 'u');
    return true;
  } catch {
    return false;
  }
};

const minNotAboveMax = <T extends Record<string, unknown>>(min: keyof T & string, max: keyof T & string) => (r: T, ctx: z.RefinementCtx) => {
  const lo = r[min];
  const hi = r[max];
  if (lo !== undefined && hi !== undefined && (lo as number | string) > (hi as number | string)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: [min], message: `Must not be greater than ${max}` });
  }
};

const textRules = z
  .object({
    minLength: length.optional(),
    maxLength: length.min(1, 'Must be at least 1').optional(),
    pattern: z.string().min(1).max(RULE_PATTERN_MAX, `Must be at most ${RULE_PATTERN_MAX} characters`).refine(validRegex, 'Enter a valid regular expression').optional(),
  })
  .strict()
  .superRefine(minNotAboveMax('minLength', 'maxLength'));

const longTextRules = z
  .object({ minLength: length.optional(), maxLength: length.min(1, 'Must be at least 1').optional() })
  .strict()
  .superRefine(minNotAboveMax('minLength', 'maxLength'));

const finite = z.number().finite('Enter a number');
const numberRules = z
  .object({ min: finite.optional(), max: finite.optional(), integer: z.boolean().optional() })
  .strict()
  .superRefine(minNotAboveMax('min', 'max'));

const dateRules = z
  .object({ notInFuture: z.boolean().optional(), minDate: isoDate.optional(), maxDate: isoDate.optional() })
  .strict()
  .superRefine(minNotAboveMax('minDate', 'maxDate'));

const selectionRules = z
  .object({ minSelected: length.optional(), maxSelected: length.min(1, 'Must be at least 1').optional() })
  .strict()
  .superRefine(minNotAboveMax('minSelected', 'maxSelected'));

const noRules = z.object({}).strict();

export const RULE_SCHEMAS: Record<string, z.ZodTypeAny> = {
  TEXT: textRules,
  LONG_TEXT: longTextRules,
  NUMBER: numberRules,
  DATE: dateRules,
  YES_NO: noRules,
  SINGLE_CHOICE: noRules,
  MULTIPLE_CHOICE: selectionRules,
  FILE: noRules,
};

/* The rules each custom type accepts (served to the form so it offers only those). */
export const RULE_KEYS_BY_TYPE: Record<string, string[]> = {
  TEXT: ['minLength', 'maxLength', 'pattern'],
  LONG_TEXT: ['minLength', 'maxLength'],
  NUMBER: ['min', 'max', 'integer'],
  DATE: ['notInFuture', 'minDate', 'maxDate'],
  YES_NO: [],
  SINGLE_CHOICE: [],
  MULTIPLE_CHOICE: ['minSelected', 'maxSelected'],
  FILE: [],
};

export interface TypedConfig {
  options: string[] | null;
  rules: Record<string, unknown>;
}

/*
 * Checks a custom field's options and rules against its data type. Returns the normalised values, or the
 * field errors (paths as the request validator writes them, e.g. body.rules.min).
 */
export function checkTypedConfig(
  dataType: string,
  options: string[] | null | undefined,
  rules: Record<string, unknown> | null | undefined,
): { ok: true; value: TypedConfig } | { ok: false; details: ErrorDetail[] } {
  const details: ErrorDetail[] = [];
  const choice = isChoiceType(dataType);

  let opts: string[] | null = null;
  if (choice) {
    if (!options || options.length === 0) details.push({ field: 'body.options', message: 'Add at least one option for a choice field.' });
    else opts = options;
  } else if (options && options.length) {
    details.push({ field: 'body.options', message: 'Options apply only to single-choice and multiple-choice fields.' });
  }

  const schema = RULE_SCHEMAS[dataType];
  let parsed: Record<string, unknown> = {};
  if (!schema) {
    details.push({ field: 'body.dataType', message: 'Select a data type.' });
  } else {
    const result = schema.safeParse(rules ?? {});
    if (!result.success) {
      for (const i of result.error.issues) {
        const message = i.code === z.ZodIssueCode.unrecognized_keys
          ? `Not a rule of a ${dataType} field: ${i.keys.join(', ')}`
          : i.message;
        details.push({ field: ['body', 'rules', ...i.path].join('.'), message });
      }
    } else {
      parsed = result.data as Record<string, unknown>;
      /* A selection count cannot exceed the number of options. */
      if (dataType === 'MULTIPLE_CHOICE' && opts) {
        for (const key of ['minSelected', 'maxSelected'] as const) {
          const n = parsed[key];
          if (typeof n === 'number' && n > opts.length) {
            details.push({ field: `body.rules.${key}`, message: `Must be at most the number of options (${opts.length})` });
          }
        }
      }
    }
  }
  return details.length ? { ok: false, details } : { ok: true, value: { options: opts, rules: parsed } };
}

/* The rules the form applies to a field: the configured ones, or the spec's fixed file rule. */
export const effectiveRules = (dataType: string, rules: Record<string, unknown>): Record<string, unknown> =>
  dataType === 'FILE' ? { ...FILE_FIELD_CONSTRAINTS } : rules;
