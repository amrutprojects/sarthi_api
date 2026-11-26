import type { Request, Response } from 'express';
import { Readable, Transform, type TransformCallback } from 'stream';
import { pipeline } from 'stream/promises';
import type { ReadableStream as WebReadableStream } from 'stream/web';
import { appConfig } from '../../config/app.config';
import { HTTP_STATUS } from '../../constants/api-response.constants';
import { attachmentDisposition } from '../../masters/document/document.storage';
import { logger } from '../../observability/logger';
import { AppError } from '../../shared/errors/app-error';
import { auditService } from '../audit';
import { accessOf } from './ipp-access';
import { IPP_AUDIT, IPP_ERROR } from './ipp-approvals.constants';
import { ippApprovalsRepository } from './ipp-approvals.repository';
import { IppError, type IppDocument } from './ipp-client';
import { ippHeadOfficeService } from './ipp-head-office.service';
import { linkNotConfigured } from './ipp-link.settings';
import { ippClient } from './ipp-outbox.runtime';
import { oneLine } from './ipp-text';

/*
 * A document of a form, fetched from IPP when an officer opens it and passed on as it comes: nothing is stored here. The
 * officer must be allowed to see the form, the form must list the file, and only these types and at most
 * appConfig.ippLink.documentMaxBytes go through, always as an attachment.
 */
const TYPES: readonly string[] = ['application/pdf', 'image/jpeg', 'image/png', 'video/mp4'];

const unavailable = () =>
  new AppError(HTTP_STATUS.BAD_GATEWAY, 'The document could not be fetched from IPP. Please try again.', IPP_ERROR.IPP_UNAVAILABLE);
const noFile = () => AppError.notFound('The document is not available');

class IppDocumentService {
  async send(req: Request, res: Response, id: string, code: string): Promise<void> {
    const auth = req.auth!;
    const access = accessOf(auth, await ippHeadOfficeService.isEnabled());
    const row = await ippApprovalsRepository.findApplication(access, id);
    if (!row) throw AppError.notFound('Application not found');
    const listed = row.documents.find((d) => d.code === code);
    if (!listed?.file || code === '.' || code === '..') throw noFile();

    const disposition = attachmentDisposition(this.fileName(listed.file.name, code));
    const document = await this.fetch(req, row.id, code);
    let passedOn = false;
    const left = () => {
      if (!passedOn) document.close();
    };
    res.once('close', left);
    try {
      /* Who opened which document of which form; no personal data. Written before the first byte goes out. */
      await auditService.record(req, {
        action: IPP_AUDIT.DOCUMENT_VIEW,
        resource: 'ipp_application',
        resourceId: row.id,
        details: { code },
      });
      res.status(HTTP_STATUS.OK);
      res.setHeader('Content-Type', document.contentType);
      if (document.contentLength !== null) res.setHeader('Content-Length', String(document.contentLength));
      res.setHeader('Content-Disposition', disposition);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'private, no-store');
      await pipeline(Readable.fromWeb(document.body as WebReadableStream<Uint8Array>), this.meter(document), res);
      passedOn = true;
    } catch (err) {
      /* Nothing went out yet: an ordinary error. Otherwise the connection is cut, and the browser shows the download as failed. */
      if (!res.headersSent && !res.destroyed) throw err;
      logger.warn({ requestId: req.id, applicationId: row.id }, 'ipp link: document stopped part way');
      res.destroy();
    } finally {
      res.off('close', left);
      document.close();
    }
  }

  private async fetch(req: Request, id: string, code: string): Promise<IppDocument> {
    const client = ippClient();
    if (!client) throw linkNotConfigured();
    let document: IppDocument;
    try {
      document = await client.document(id, code);
    } catch (err) {
      if (!(err instanceof IppError)) throw err;
      if (err.status === HTTP_STATUS.NOT_FOUND) throw noFile();
      logger.warn({ requestId: req.id, applicationId: id, reason: err.message }, 'ipp link: document not fetched');
      throw unavailable();
    }
    const { contentType, contentLength } = document;
    if (!TYPES.includes(contentType) || (contentLength !== null && contentLength > appConfig.ippLink.documentMaxBytes)) {
      document.close();
      logger.warn({ requestId: req.id, applicationId: id, contentLength }, 'ipp link: document refused (type or size)');
      throw unavailable();
    }
    return document;
  }

  /* Counts the bytes passed on and keeps the time limit of the call running only while nothing comes. */
  private meter(document: IppDocument): Transform {
    let bytes = 0;
    return new Transform({
      transform(chunk: Buffer, _encoding: BufferEncoding, done: TransformCallback) {
        document.alive();
        bytes += chunk.length;
        if (bytes > appConfig.ippLink.documentMaxBytes) done(new Error('document too large'));
        else done(null, chunk);
      },
    });
  }

  /* The last part of the name IPP gave it; a name that is only dots or blank becomes the code. */
  private fileName(name: string, code: string): string {
    const last = oneLine(name.split(/[\\/]/).pop() ?? '');
    return /[^.\s]/.test(last) ? last : code;
  }
}

export const ippDocumentService = new IppDocumentService();
