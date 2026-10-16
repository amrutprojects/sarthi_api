import type { RequestHandler } from 'express';
import { ApiResponse } from '../utils/api-response';

export const notFound: RequestHandler = (req, res) => {
  ApiResponse.error(res, 404, `Route not found: ${req.method} ${req.path}`, 'ROUTE_NOT_FOUND');
};
