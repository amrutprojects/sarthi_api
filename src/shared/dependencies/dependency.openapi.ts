import { z } from 'zod';
import { documentEndpoint, envelope } from '../openapi/registry';
import { uuid } from '../validation/common.validation';

/* GET /dependencies/:kind/:id (dependency.routes.ts): what still uses a record, asked before it is deleted. */
const DependencyAnswer = z.object({
  kind: z.string().describe('The kind of record, as every delete registers it: user, role, district, lms-course, faq…'),
  id: z.string().uuid(),
  deletable: z.boolean().describe('false while anything still uses the record; its DELETE then answers 409 HAS_DEPENDENCIES'),
  message: z
    .string()
    .nullable()
    .describe('The message the DELETE would give, e.g. "Unable to delete this user because they are associated with existing …"'),
  dependencies: z.array(z.object({ label: z.string(), count: z.number().int() })).describe('What uses it, with how many records'),
});

documentEndpoint({
  method: 'get',
  path: '/dependencies/:kind/:id',
  tag: 'Dependencies',
  summary: 'What still uses a record, before deleting it',
  description:
    'Every delete of the application refuses (409 HAS_DEPENDENCIES) a record that other records still use: approvals and ' +
    'decisions made by a user, assignments, mappings, and records that point at it. This answers the same question for ' +
    "the delete dialog. Requires the kind's delete permission; an unknown kind is 404.",
  permission: null,
  request: { params: z.object({ kind: z.string().min(1).max(60), id: uuid }) },
  response: envelope(DependencyAnswer),
  errors: [403, 404],
});
