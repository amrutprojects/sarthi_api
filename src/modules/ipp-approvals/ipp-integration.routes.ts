import express, { Router, type NextFunction, type Request, type Response } from 'express';
import { appConfig } from '../../config/app.config';
import { body } from '../../middleware/validate-request.middleware';
import { AppError } from '../../shared/errors/app-error';
import { asyncHandler } from '../../shared/http/async-handler';
import { ApiResponse } from '../../utils/api-response';
import { ippMessageService } from './ipp-message.service';
import { ippMessageSchema, MESSAGE_ISSUES_MAX, type IppMessageInput } from './ipp-message.validation';
import { ippLinkGate, verifyIppSignature } from './ipp-signature';

/*
 * /integration/v1/ipp — called by IPP's server only (contract ipp_backend/docs/SARTHI_LINK.md section 2). Mounted by
 * app.ts before the general /integration/v1 parser, whose limit is far below the 5 MB of a message. The order matters:
 * the headers are checked before the body is read, and the signature over the raw bytes before they are parsed.
 */
export const ippIntegrationRouter = Router();

/* Malformed input is 422 here (contract), with the places but never the values; the first ones are enough to find it. */
function parseMessage(req: Request, _res: Response, next: NextFunction): void {
  let json: unknown;
  try {
    json = JSON.parse((req.rawBody ?? Buffer.alloc(0)).toString('utf8'));
  } catch {
    next(AppError.unprocessable('The body is not JSON'));
    return;
  }
  const result = ippMessageSchema.safeParse(json);
  if (!result.success) {
    next(
      AppError.validation(
        result.error.issues.slice(0, MESSAGE_ISSUES_MAX).map((i) => ({ field: ['body', ...i.path].join('.'), message: i.message })),
        'The message is malformed',
      ),
    );
    return;
  }
  req.validated = { body: result.data };
  next();
}

ippIntegrationRouter.use(
  ippLinkGate,
  express.raw({ type: () => true, limit: appConfig.ippLink.bodyLimit }),
  (req: Request, _res: Response, next: NextFunction) => {
    /* body-parser leaves `{}` when there is no body (a GET). */
    req.rawBody = Buffer.isBuffer(req.body) ? req.body : undefined;
    next();
  },
  verifyIppSignature,
);

ippIntegrationRouter.get('/ping', (_req, res) => {
  ApiResponse.ok(res, { ok: true, time: new Date().toISOString() }, 'Sarthi answers');
});

ippIntegrationRouter.post(
  '/messages',
  parseMessage,
  asyncHandler(async (req, res) => {
    const answer = await ippMessageService.receive(req, body<IppMessageInput>(req));
    ApiResponse.ok(res, answer, answer.duplicate ? 'Message already received' : 'Message received');
  }),
);
