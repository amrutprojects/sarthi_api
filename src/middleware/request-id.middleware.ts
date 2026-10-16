import { randomUUID } from 'crypto';
import type { RequestHandler } from 'express';
import { REQUEST_ID_HEADER } from '../constants/app.constants';

const SAFE_ID = /^[A-Za-z0-9._-]{1,100}$/;

/* Accepts a well-formed incoming X-Request-Id (from a gateway) or generates one; echoes it back. */
export const requestId: RequestHandler = (req, res, next) => {
  const incoming = req.header(REQUEST_ID_HEADER);
  req.id = incoming && SAFE_ID.test(incoming) ? incoming : randomUUID();
  res.locals.requestId = req.id;
  res.setHeader(REQUEST_ID_HEADER, req.id);
  next();
};
