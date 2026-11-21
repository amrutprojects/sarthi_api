import type { ErrorRequestHandler, Response } from 'express';
import type { FieldError } from './lms-student.fields';

/*
 * Errors of the LMS endpoints (contract amrut-student-api.md): a status, a stable code and, for a 400, `{field, code}`
 * pairs only — never a value that was sent or stored. The body keeps Amrut's envelope (success, status, message,
 * error.code, error.requestId) and also carries `details` at the top level, where the LMS client and the Amrut
 * simulator read them.
 */
export const LMS_API_CODES = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  NOT_FOUND: 'NOT_FOUND',
  STALE: 'STALE',
  IDEMPOTENCY_KEY_REUSED: 'IDEMPOTENCY_KEY_REUSED',
} as const;

export class LmsApiError extends Error {
  constructor(
    readonly status: 400 | 404 | 409 | 422,
    readonly code: string,
    message: string,
    readonly details: FieldError[] = [],
  ) {
    super(message);
    this.name = 'LmsApiError';
  }

  static validation(details: FieldError[]) {
    return new LmsApiError(400, LMS_API_CODES.VALIDATION_FAILED, 'Validation failed', details);
  }
}

export function sendLmsError(res: Response, status: number, code: string, message: string, details: FieldError[] = []): void {
  res.status(status).json({
    success: false,
    status,
    message,
    data: null,
    error: { code, requestId: res.locals.requestId as string | undefined, ...(details.length ? { details } : {}) },
    ...(details.length ? { details } : {}),
  });
}

/* Router-level handler: LmsApiError in the contract's shape; anything else goes on to the global handler. */
export const lmsErrorHandler: ErrorRequestHandler = (err, _req, res, next) => {
  if (err instanceof LmsApiError) {
    sendLmsError(res, err.status, err.code, err.message, err.details);
    return;
  }
  if (err?.type === 'entity.parse.failed') {
    sendLmsError(res, 400, LMS_API_CODES.VALIDATION_FAILED, 'Malformed JSON body', [{ field: 'body', code: 'malformed_json' }]);
    return;
  }
  next(err);
};
