import type { Response } from 'express';
import type { ErrorDetail } from './app-error';

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface SuccessBody<T> {
  success: true;
  message: string;
  data: T;
  meta?: PaginationMeta;
}

export interface ErrorBody {
  success: false;
  message: string;
  error: { code: string; details?: ErrorDetail[]; requestId?: string };
}

/* Consistent JSON envelope for every response. */
export const ApiResponse = {
  ok<T>(res: Response, data: T, message = 'OK', meta?: PaginationMeta, status = 200): Response<SuccessBody<T>> {
    const body: SuccessBody<T> = { success: true, message, data };
    if (meta) body.meta = meta;
    return res.status(status).json(body);
  },

  created<T>(res: Response, data: T, message = 'Created'): Response<SuccessBody<T>> {
    return ApiResponse.ok(res, data, message, undefined, 201);
  },

  error(res: Response, status: number, message: string, code: string, details?: ErrorDetail[]): Response<ErrorBody> {
    const body: ErrorBody = { success: false, message, error: { code, requestId: res.locals.requestId as string | undefined } };
    if (details?.length) body.error.details = details;
    return res.status(status).json(body);
  },
};
