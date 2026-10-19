import { OpenAPIRegistry, extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { z, type ZodTypeAny } from 'zod';

/*
 * OpenAPI registry (ADR-0004). Each module documents its endpoints in `<module>.openapi.ts` with
 * `documentEndpoint`, reusing the same Zod schemas that validate requests, so the documentation
 * cannot drift from validation. The contract test fails if an Express route is not documented.
 */
extendZodWithOpenApi(z);

export const registry = new OpenAPIRegistry();

registry.registerComponent('securitySchemes', 'cookieAuth', {
  type: 'apiKey', in: 'cookie', name: 'amrut_session',
  description: 'Browser session (HttpOnly). State-changing requests must also send X-CSRF-Token (from login or GET /auth/me).',
});
registry.registerComponent('securitySchemes', 'bearerAuth', {
  type: 'http', scheme: 'bearer', bearerFormat: 'JWT',
  description: 'API clients: POST /auth/login with header X-Auth-Mode: bearer returns accessToken.',
});

export const ErrorDetailSchema = z.object({ field: z.string().optional(), message: z.string() });
export const ErrorEnvelope = registry.register('ErrorEnvelope', z.object({
  success: z.literal(false),
  message: z.string(),
  error: z.object({ code: z.string(), requestId: z.string().optional(), details: z.array(ErrorDetailSchema).optional() }),
}));
export const PageMetaSchema = registry.register('PageMeta', z.object({
  page: z.number().int(), limit: z.number().int(), total: z.number().int(), totalPages: z.number().int(),
}));

/* Response envelopes — the shape every endpoint returns (shared/http/api-response.ts). */
export const envelope = <T extends ZodTypeAny>(data: T) => z.object({ success: z.literal(true), message: z.string(), data });
export const pagedEnvelope = <T extends ZodTypeAny>(item: T) =>
  z.object({ success: z.literal(true), message: z.string(), data: z.array(item), meta: PageMetaSchema });

const ERROR_TEXT: Record<number, string> = {
  400: 'Bad request', 401: 'Not authenticated', 403: 'Missing permission (or CSRF token)', 404: 'Not found',
  409: 'Conflict with the current state', 422: 'Validation failed', 429: 'Rate limited',
};

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';
interface EndpointDoc {
  method: Method;
  /* Express-style path under /api/v1, e.g. /users/:id */
  path: string;
  tag: string;
  summary: string;
  description?: string;
  /* Permission code(s) required (any of); null = authenticated only; 'public' = no authentication. */
  permission: string | string[] | null | 'public';
  request?: { params?: z.AnyZodObject; query?: ZodTypeAny; body?: ZodTypeAny; multipart?: z.AnyZodObject };
  /* Success response schema (full envelope), or a content type for file downloads. */
  response: ZodTypeAny | { file: string };
  status?: number;
  idempotent?: boolean;
  errors?: number[];
}

/* Documented routes, used by the contract test to compare against the Express router. */
export const documentedRoutes: { method: Method; path: string }[] = [];

export function documentEndpoint(doc: EndpointDoc): void {
  const openApiPath = doc.path.replace(/:([A-Za-z]+)/g, '{$1}');
  documentedRoutes.push({ method: doc.method, path: doc.path });
  const isPublic = doc.permission === 'public';
  const perms = isPublic || doc.permission === null ? [] : ([] as string[]).concat(doc.permission);
  const errors = new Set([...(isPublic ? [] : [401, 403]), ...(doc.request?.body || doc.request?.query || doc.request?.params ? [422] : []), ...(doc.errors ?? []), 429]);
  const status = doc.status ?? (doc.method === 'post' ? 201 : 200);

  registry.registerPath({
    method: doc.method,
    path: '/api/v1' + openApiPath,
    tags: [doc.tag],
    summary: doc.summary,
    description: [doc.description, perms.length ? `**Permission:** ${perms.map((p) => `\`${p}\``).join(' or ')}` : isPublic ? '**Public.**' : '**Any authenticated user.**',
      doc.idempotent ? 'Supports the `Idempotency-Key` header: a retry with the same key and body returns the first response.' : '']
      .filter(Boolean).join('\n\n'),
    security: isPublic ? [] : [{ cookieAuth: [] }, { bearerAuth: [] }],
    request: {
      ...(doc.request?.params ? { params: doc.request.params } : {}),
      ...(doc.request?.query ? { query: doc.request.query as z.AnyZodObject } : {}),
      ...(doc.request?.body ? { body: { content: { 'application/json': { schema: doc.request.body } } } } : {}),
      ...(doc.request?.multipart ? { body: { content: { 'multipart/form-data': { schema: doc.request.multipart } } } } : {}),
      ...(doc.idempotent ? { headers: z.object({ 'Idempotency-Key': z.string().min(8).max(100).optional() }) } : {}),
    },
    responses: {
      [status]: 'file' in doc.response
        ? { description: 'File', content: { [doc.response.file]: { schema: z.string() } } }
        : { description: 'Success', content: { 'application/json': { schema: doc.response } } },
      ...Object.fromEntries([...errors].map((code) => [code, { description: ERROR_TEXT[code] ?? 'Error', content: { 'application/json': { schema: ErrorEnvelope } } }])),
    },
    ...(perms.length ? { 'x-permissions': perms } : {}),
  });
}
