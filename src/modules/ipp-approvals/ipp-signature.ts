import { createHash, createHmac, timingSafeEqual } from 'crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { appConfig } from '../../config/app.config';
import { HTTP_STATUS } from '../../constants/api-response.constants';
import { AppError } from '../../shared/errors/app-error';
import { IPP_ERROR } from './ipp-approvals.constants';
import { ippLink, linkNotConfigured } from './ipp-link.settings';

/*
 * Signature of every call between IPP and Sarthi, both ways (contract ipp_backend/docs/SARTHI_LINK.md section 1):
 *
 *   Authorization: IPP-SARTHI <client>:<signature>     client = ipp (IPP calls Sarthi) or sarthi (Sarthi calls IPP)
 *   X-Timestamp:   <unix seconds>
 *
 * signature = hex HMAC-SHA256(shared secret) of client, METHOD, path with query as sent, timestamp and the SHA-256 of the
 * raw body, joined with newlines. The client is part of the text, so a call cannot be sent back to its sender.
 */
export const IPP_SCHEME = 'IPP-SARTHI';
export const CLIENT_IPP = 'ipp';
export const CLIENT_SARTHI = 'sarthi';

export interface SignedCall {
  client: string;
  method: string;
  /* Path with query, as sent. */
  path: string;
  timestamp: string;
  body: Buffer | string;
}

export function signingText(c: SignedCall): string {
  const bodyHash = createHash('sha256').update(c.body).digest('hex');
  return [c.client, c.method.toUpperCase(), c.path, c.timestamp, bodyHash].join('\n');
}

export const signCall = (secret: string, c: SignedCall): string => createHmac('sha256', secret).update(signingText(c)).digest('hex');

/* The headers of a call Sarthi makes. */
export function signedHeaders(secret: string, method: string, path: string, body: Buffer | string): Record<string, string> {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = signCall(secret, { client: CLIENT_SARTHI, method, path, timestamp, body });
  return { Authorization: `${IPP_SCHEME} ${CLIENT_SARTHI}:${signature}`, 'X-Timestamp': timestamp };
}

const HEADER_RE = new RegExp(`^${IPP_SCHEME} ${CLIENT_IPP}:([0-9a-f]{64})$`);

const refuse = (message: string) => new AppError(HTTP_STATUS.UNAUTHORIZED, message, IPP_ERROR.LINK_UNAUTHORIZED);

function readHeaders(req: Request): { signature: string; timestamp: string } {
  const match = HEADER_RE.exec(req.header('authorization') ?? '');
  if (!match) throw refuse('Missing or malformed signature');
  const timestamp = req.header('x-timestamp') ?? '';
  if (!/^\d{9,11}$/.test(timestamp) || Math.abs(Date.now() / 1000 - Number(timestamp)) > appConfig.ippLink.maxSkewSeconds)
    throw refuse('Request timestamp outside the allowed window');
  return { signature: match[1], timestamp };
}

/* Before the body is read: link not configured → 503, no usable signature header or an old timestamp → 401. */
export const ippLinkGate: RequestHandler = (req: Request, _res: Response, next: NextFunction) => {
  try {
    if (!ippLink().configured) throw linkNotConfigured();
    readHeaders(req);
    next();
  } catch (err) {
    next(err);
  }
};

/* The signature itself, over the exact body bytes (req.rawBody) and before they are parsed. */
export const verifyIppSignature: RequestHandler = (req: Request, _res: Response, next: NextFunction) => {
  try {
    const { signature, timestamp } = readHeaders(req);
    const expected = signCall(ippLink().secret, {
      client: CLIENT_IPP,
      method: req.method,
      path: req.originalUrl,
      timestamp,
      body: req.rawBody ?? '',
    });
    /* Both are 64 hex digits (HEADER_RE), so the lengths are equal. */
    if (!timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'))) throw refuse('Signature does not match');
    next();
  } catch (err) {
    next(err);
  }
};
