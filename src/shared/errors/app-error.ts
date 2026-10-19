import { ERROR_CODES, HTTP_STATUS, RESPONSE_MESSAGES, type HttpStatus } from '../../constants/api-response.constants';

/*
 * Operational error with an HTTP status and a stable machine-readable code (constants/api-response.constants.ts).
 * Anything thrown that is not an AppError is treated as an unexpected 500 by the error handler.
 */
export interface ErrorDetail {
  field?: string;
  message: string;
}

export class AppError extends Error {
  constructor(
    public readonly statusCode: HttpStatus,
    message: string,
    public readonly code: string = ERROR_CODES.INTERNAL_ERROR,
    public readonly details?: ErrorDetail[],
  ) {
    super(message);
    this.name = 'AppError';
  }

  static badRequest(message: string = RESPONSE_MESSAGES.BAD_REQUEST, details?: ErrorDetail[]) {
    return new AppError(HTTP_STATUS.BAD_REQUEST, message, ERROR_CODES.BAD_REQUEST, details);
  }
  static unauthorized(message: string = RESPONSE_MESSAGES.UNAUTHORIZED) {
    return new AppError(HTTP_STATUS.UNAUTHORIZED, message, ERROR_CODES.UNAUTHORIZED);
  }
  static forbidden(message: string = RESPONSE_MESSAGES.FORBIDDEN, code: string = ERROR_CODES.FORBIDDEN) {
    return new AppError(HTTP_STATUS.FORBIDDEN, message, code);
  }
  static notFound(message: string = RESPONSE_MESSAGES.RESOURCE_NOT_FOUND) {
    return new AppError(HTTP_STATUS.NOT_FOUND, message, ERROR_CODES.NOT_FOUND);
  }
  static conflict(message: string = RESPONSE_MESSAGES.DUPLICATE_RECORD, code: string = ERROR_CODES.CONFLICT) {
    return new AppError(HTTP_STATUS.CONFLICT, message, code);
  }
  static validation(details: ErrorDetail[], message: string = RESPONSE_MESSAGES.VALIDATION_FAILED) {
    return new AppError(HTTP_STATUS.UNPROCESSABLE_ENTITY, message, ERROR_CODES.VALIDATION_ERROR, details);
  }
  static unprocessable(message: string, code: string = ERROR_CODES.VALIDATION_ERROR) {
    return new AppError(HTTP_STATUS.UNPROCESSABLE_ENTITY, message, code);
  }
}
