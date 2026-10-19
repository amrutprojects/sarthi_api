import { z } from 'zod';
import { listQuerySchema } from '../../shared/utils/pagination';
import { idParams, statusBody } from '../../shared/validation/common.validation';
import type { MasterDefinition } from './master.definitions';

export const MASTER_SORT_FIELDS = ['createdAt', 'updatedAt', 'code', 'name'] as const;
export type MasterSortField = (typeof MASTER_SORT_FIELDS)[number];

const code = (max: number) =>
  z
    .string()
    .trim()
    .toUpperCase()
    .min(1, 'Required')
    .max(max, `Code must be at most ${max} characters`)
    .regex(/^[A-Z0-9][A-Z0-9_-]*$/, 'Code may contain only letters, digits, _ and -');
const name = (max: number) =>
  z
    .string()
    .trim()
    .min(1, 'Required')
    .max(max, `Name must be at most ${max} characters`)
    .transform((v) => v.normalize('NFC').replace(/\s+/g, ' '));
const description = z.string().trim().max(500).nullable().optional();

/* Request schemas for one master. Editing never changes isActive: status has its own endpoint. */
export function masterSchemas(d: MasterDefinition) {
  const mandatory: z.ZodRawShape = d.hasMandatory ? { isMandatory: z.boolean().optional() } : {};
  const fields = { code: code(d.codeMax), name: name(d.nameMax), description, ...mandatory };
  return {
    list: { query: listQuerySchema(MASTER_SORT_FIELDS) },
    id: { params: idParams },
    create: { body: z.object({ ...fields, isActive: z.boolean().optional() }).strict() },
    update: {
      params: idParams,
      body: z
        .object(fields)
        .partial()
        .strict()
        .refine((b) => Object.keys(b).length > 0, 'Provide at least one field to update'),
    },
    status: { params: idParams, body: statusBody },
  };
}

export interface MasterInput {
  code?: string;
  name?: string;
  description?: string | null;
  isMandatory?: boolean;
  isActive?: boolean;
}
