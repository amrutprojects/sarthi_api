import type { RequestHandler } from 'express';
import type { ZodError, ZodTypeAny } from 'zod';
import { AppError, type ErrorDetail } from '../utils/app-error';

export interface RequestSchemas {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
}

const toDetails = (part: string, err: ZodError): ErrorDetail[] =>
  err.issues.map((i) => ({ field: [part, ...i.path].join('.'), message: i.message }));

/*
 * Validates body / query / params with Zod and stores the parsed (coerced, defaulted, stripped)
 * values on req.validated. Controllers read only from req.validated. Any failure is 422.
 */
export const validateRequest = (schemas: RequestSchemas): RequestHandler => (req, _res, next) => {
  const details: ErrorDetail[] = [];
  const validated: NonNullable<typeof req.validated> = {};
  for (const part of ['params', 'query', 'body'] as const) {
    const schema = schemas[part];
    if (!schema) continue;
    const result = schema.safeParse(req[part] ?? {});
    if (result.success) validated[part] = result.data;
    else details.push(...toDetails(part, result.error));
  }
  if (details.length) {
    next(AppError.validation(details));
    return;
  }
  req.validated = validated;
  next();
};

/* Typed accessors for controllers. */
export const body = <T>(req: { validated?: { body?: unknown } }) => req.validated?.body as T;
export const query = <T>(req: { validated?: { query?: unknown } }) => req.validated?.query as T;
export const params = <T>(req: { validated?: { params?: unknown } }) => req.validated?.params as T;
