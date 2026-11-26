/*
 * The single source of HTTP status codes and common API response messages for the whole backend.
 * Controllers, middleware and services use these constants; no module defines its own status codes
 * or repeats these messages. Module-specific wording (e.g. "Decision recorded") stays in the module.
 */

export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
  UNPROCESSABLE_ENTITY: 422,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
  BAD_GATEWAY: 502,
  SERVICE_UNAVAILABLE: 503,
} as const;

export type HttpStatus = (typeof HTTP_STATUS)[keyof typeof HTTP_STATUS];

/* Stable, machine-readable error codes sent in `error.code` (clients branch on these, not on messages). */
export const ERROR_CODES = {
  BAD_REQUEST: 'BAD_REQUEST',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  CSRF_INVALID: 'CSRF_INVALID',
  SELF_PRIVILEGE_CHANGE: 'SELF_PRIVILEGE_CHANGE',
  PRIVILEGE_ESCALATION: 'PRIVILEGE_ESCALATION',
  PROTECTED_ROLE: 'PROTECTED_ROLE',
  NOT_FOUND: 'NOT_FOUND',
  ROUTE_NOT_FOUND: 'ROUTE_NOT_FOUND',
  CONFLICT: 'CONFLICT',
  /* A delete refused because other records still use the record (shared/dependencies). */
  HAS_DEPENDENCIES: 'HAS_DEPENDENCIES',
  IDEMPOTENCY_KEY_REUSED: 'IDEMPOTENCY_KEY_REUSED',
  IDEMPOTENCY_IN_PROGRESS: 'IDEMPOTENCY_IN_PROGRESS',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  NO_LMS_ACCESS: 'NO_LMS_ACCESS',
  SIGNATURE_INVALID: 'SIGNATURE_INVALID',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/* Common messages. */
export const RESPONSE_MESSAGES = {
  SUCCESS: 'Request completed successfully',
  DATA_RETRIEVED: 'Data retrieved successfully',
  RECORD_CREATED: 'Record created successfully',
  RECORD_UPDATED: 'Record updated successfully',
  RECORD_DELETED: 'Record deleted successfully',
  LOGIN_SUCCESS: 'Login successful',
  LOGOUT_SUCCESS: 'Logged out',

  BAD_REQUEST: 'Invalid request',
  MALFORMED_JSON: 'Malformed JSON body',
  INVALID_VALUE: 'Invalid value',
  VALIDATION_FAILED: 'Validation failed',
  PAYLOAD_TOO_LARGE: 'Request body too large',

  UNAUTHORIZED: 'Authentication required',
  INVALID_CREDENTIALS: 'Invalid email or password',
  INVALID_TOKEN: 'Invalid or expired token',
  TOKEN_REVOKED: 'Token has been revoked',
  ACCOUNT_INACTIVE: 'Account is not active',
  FORBIDDEN: 'You do not have permission to perform this action',
  CSRF_INVALID: 'Missing or invalid CSRF token',

  RESOURCE_NOT_FOUND: 'Resource not found',
  ROUTE_NOT_FOUND: 'Route not found',

  DUPLICATE_RECORD: 'A record with the same unique value already exists',
  RELATED_RECORDS_CONFLICT: 'The operation conflicts with related records',

  DATABASE_ERROR: 'A database error occurred',
  INTERNAL_SERVER_ERROR: 'Internal server error',

  TOO_MANY_REQUESTS: 'Too many requests, please try again later',
  TOO_MANY_LOGIN_ATTEMPTS: 'Too many login attempts, please try again later',
  BAD_GATEWAY: 'Another service did not answer',
  SERVICE_UNAVAILABLE: 'Service unavailable',
  SERVICE_HEALTHY: 'Service healthy',
  SERVICE_NOT_READY: 'Service not ready',
} as const;

/* Message builders for a named resource, so every module words the common cases the same way. */
export const MESSAGES = {
  retrieved: (resource: string) => `${resource} retrieved successfully`,
  created: (resource: string) => `${resource} created successfully`,
  updated: (resource: string) => `${resource} updated successfully`,
  deleted: (resource: string) => `${resource} deleted successfully`,
  /* Restored records come back inactive; an administrator activates them explicitly. */
  restored: (resource: string) => `${resource} restored (inactive)`,
  activated: (resource: string) => `${resource} activated`,
  deactivated: (resource: string) => `${resource} deactivated`,
  notFound: (resource: string) => `${resource} not found`,
  alreadyExists: (resource: string, field = 'value') => `A ${resource.toLowerCase()} with this ${field} already exists`,
} as const;

/* Default message for each status, used when a response does not supply its own. */
export const STATUS_MESSAGES: Record<HttpStatus, string> = {
  [HTTP_STATUS.OK]: RESPONSE_MESSAGES.SUCCESS,
  [HTTP_STATUS.CREATED]: RESPONSE_MESSAGES.RECORD_CREATED,
  [HTTP_STATUS.NO_CONTENT]: RESPONSE_MESSAGES.SUCCESS,
  [HTTP_STATUS.BAD_REQUEST]: RESPONSE_MESSAGES.BAD_REQUEST,
  [HTTP_STATUS.UNAUTHORIZED]: RESPONSE_MESSAGES.UNAUTHORIZED,
  [HTTP_STATUS.FORBIDDEN]: RESPONSE_MESSAGES.FORBIDDEN,
  [HTTP_STATUS.NOT_FOUND]: RESPONSE_MESSAGES.RESOURCE_NOT_FOUND,
  [HTTP_STATUS.CONFLICT]: RESPONSE_MESSAGES.DUPLICATE_RECORD,
  [HTTP_STATUS.PAYLOAD_TOO_LARGE]: RESPONSE_MESSAGES.PAYLOAD_TOO_LARGE,
  [HTTP_STATUS.UNPROCESSABLE_ENTITY]: RESPONSE_MESSAGES.VALIDATION_FAILED,
  [HTTP_STATUS.TOO_MANY_REQUESTS]: RESPONSE_MESSAGES.TOO_MANY_REQUESTS,
  [HTTP_STATUS.INTERNAL_SERVER_ERROR]: RESPONSE_MESSAGES.INTERNAL_SERVER_ERROR,
  [HTTP_STATUS.BAD_GATEWAY]: RESPONSE_MESSAGES.BAD_GATEWAY,
  [HTTP_STATUS.SERVICE_UNAVAILABLE]: RESPONSE_MESSAGES.SERVICE_UNAVAILABLE,
};

/* Default error code for each error status. */
export const STATUS_ERROR_CODES: Partial<Record<HttpStatus, ErrorCode>> = {
  [HTTP_STATUS.BAD_REQUEST]: ERROR_CODES.BAD_REQUEST,
  [HTTP_STATUS.UNAUTHORIZED]: ERROR_CODES.UNAUTHORIZED,
  [HTTP_STATUS.FORBIDDEN]: ERROR_CODES.FORBIDDEN,
  [HTTP_STATUS.NOT_FOUND]: ERROR_CODES.NOT_FOUND,
  [HTTP_STATUS.CONFLICT]: ERROR_CODES.CONFLICT,
  [HTTP_STATUS.PAYLOAD_TOO_LARGE]: ERROR_CODES.PAYLOAD_TOO_LARGE,
  [HTTP_STATUS.UNPROCESSABLE_ENTITY]: ERROR_CODES.VALIDATION_ERROR,
  [HTTP_STATUS.TOO_MANY_REQUESTS]: ERROR_CODES.RATE_LIMITED,
  [HTTP_STATUS.INTERNAL_SERVER_ERROR]: ERROR_CODES.INTERNAL_ERROR,
  [HTTP_STATUS.SERVICE_UNAVAILABLE]: ERROR_CODES.SERVICE_UNAVAILABLE,
};
