import type { Response } from 'express';
import {
  ERROR_CODES,
  HTTP_STATUS,
  RESPONSE_MESSAGES,
  STATUS_ERROR_CODES,
  STATUS_MESSAGES,
  type ErrorCode,
  type HttpStatus,
} from '../constants/api-response.constants';
import type { ErrorDetail } from '../shared/errors/app-error';

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

/* { success, status, message, data, meta? } — `status` always equals the HTTP status code sent. */
export interface SuccessBody<T> {
  success: true;
  status: number;
  message: string;
  data: T;
  meta?: PaginationMeta;
}

/* { success: false, status, message, data: null, error: { code, details?, requestId } } */
export interface ErrorBody {
  success: false;
  status: number;
  message: string;
  data: null;
  error: { code: string; details?: ErrorDetail[]; requestId?: string };
}

/*
 * The one response utility for every API. It writes the HTTP status and the JSON `status` field from the
 * same value, so they can never disagree. Messages default to the common ones for the status.
 */
export const ApiResponse = {
  success<T>(res: Response, status: HttpStatus, data: T, message?: string, meta?: PaginationMeta): Response<SuccessBody<T>> {
    const body: SuccessBody<T> = { success: true, status, message: message ?? STATUS_MESSAGES[status], data };
    if (meta) body.meta = meta;
    return res.status(status).json(body);
  },

  /* 200 OK. */
  ok<T>(res: Response, data: T, message: string = RESPONSE_MESSAGES.DATA_RETRIEVED, meta?: PaginationMeta): Response<SuccessBody<T>> {
    return ApiResponse.success(res, HTTP_STATUS.OK, data, message, meta);
  },

  /* 201 Created. */
  created<T>(res: Response, data: T, message: string = RESPONSE_MESSAGES.RECORD_CREATED): Response<SuccessBody<T>> {
    return ApiResponse.success(res, HTTP_STATUS.CREATED, data, message);
  },

  /* 204 No Content (no body, by definition). */
  noContent(res: Response): Response {
    return res.status(HTTP_STATUS.NO_CONTENT).end();
  },

  error(res: Response, status: HttpStatus, message?: string, code?: ErrorCode | string, details?: ErrorDetail[]): Response<ErrorBody> {
    const body: ErrorBody = {
      success: false,
      status,
      message: message ?? STATUS_MESSAGES[status],
      data: null,
      error: {
        code: code ?? STATUS_ERROR_CODES[status] ?? ERROR_CODES.INTERNAL_ERROR,
        requestId: res.locals.requestId as string | undefined,
      },
    };
    if (details?.length) body.error.details = details;
    return res.status(status).json(body);
  },
};
