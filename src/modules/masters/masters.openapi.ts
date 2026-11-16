import { z } from 'zod';
import { documentEndpoint, envelope, pagedEnvelope, registry } from '../../shared/openapi/registry';
import { idParams } from '../../shared/validation/common.validation';
import { MASTER_LIST, masterPermission, type MasterAction } from './master.definitions';
import { masterSchemas } from './master.validation';

/* API contract of the four masters, generated from their definitions. DTOs mirror MasterService.toDto. */
for (const d of MASTER_LIST) {
  const s = masterSchemas(d);
  const schemaName = d.label
    .split(/\s+/)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join('');
  const mandatory: z.ZodRawShape = d.hasMandatory ? { isMandatory: z.boolean() } : {};
  const english: z.ZodRawShape = d.hasEnglishName ? { nameEn: z.string().nullable() } : {};
  const order: z.ZodRawShape = d.ordered ? { displayOrder: z.number().int() } : {};
  const Dto = registry.register(
    schemaName,
    z
      .object({
        id: z.string().uuid(),
        code: z.string(),
        name: z.string(),
        description: z.string().nullable(),
        ...mandatory,
        ...english,
        ...order,
        isActive: z.boolean(),
        createdAt: z.string().datetime(),
        updatedAt: z.string().datetime(),
      })
      .strict(),
  );
  const Option = registry.register(
    `${schemaName}Option`,
    z.object({ id: z.string().uuid(), code: z.string(), name: z.string(), ...mandatory, ...english }).strict(),
  );
  const path = `/${d.path}`;
  const tag = d.plural;
  const one = d.label.toLowerCase();
  const permission = (a: MasterAction) => masterPermission(d, a);

  documentEndpoint({
    method: 'get',
    path,
    tag,
    summary: `List ${d.plural.toLowerCase()}`,
    description: 'Server-side paging; search matches code or name; isActive filters by status.',
    permission: permission('view'),
    request: { query: s.list.query },
    response: pagedEnvelope(Dto),
  });
  documentEndpoint({
    method: 'get',
    path: `${path}/options`,
    tag,
    summary: `Active ${d.plural.toLowerCase()} for dropdowns`,
    description: d.ordered
      ? 'Only active, non-deleted records, in display order (the official sequence). Used by the public registration form and the website.'
      : 'Only active, non-deleted records, sorted by name. Used by the public registration form.',
    permission: 'public',
    response: envelope(z.array(Option)),
  });
  documentEndpoint({
    method: 'post',
    path,
    tag,
    summary: `Create a ${one}`,
    description: 'Code and name must be unique, including against soft-deleted records.',
    permission: permission('create'),
    idempotent: true,
    request: { body: s.create.body },
    response: envelope(Dto),
    errors: [409],
  });
  documentEndpoint({
    method: 'get',
    path: `${path}/:id`,
    tag,
    summary: `Get a ${one}`,
    permission: permission('view'),
    request: { params: idParams },
    response: envelope(Dto),
    errors: [404],
  });
  documentEndpoint({
    method: 'patch',
    path: `${path}/:id`,
    tag,
    summary: `Update a ${one}`,
    description: 'Never changes the active status. The code of a record in use cannot change.',
    permission: permission('update'),
    request: { params: idParams, body: s.update.body },
    response: envelope(Dto),
    errors: [404, 409],
  });
  documentEndpoint({
    method: 'patch',
    path: `${path}/:id/status`,
    tag,
    summary: 'Activate or deactivate',
    permission: permission('status'),
    request: { params: idParams, body: s.status.body },
    response: envelope(Dto),
    errors: [404],
  });
  documentEndpoint({
    method: 'delete',
    path: `${path}/:id`,
    tag,
    summary: `Soft-delete a ${one}`,
    description: 'Refused (409) while students or stored documents reference it. Its code and name stay reserved.',
    permission: permission('delete'),
    request: { params: idParams },
    response: envelope(z.null()),
    errors: [404, 409],
  });
}
