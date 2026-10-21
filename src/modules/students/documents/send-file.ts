import type { Response } from 'express';
import type { Readable } from 'stream';

/*
 * Streams a stored document as a download. Always an attachment with the stored type (never rendered inline
 * from the API origin), not cached, and sniffing disabled.
 */
export function sendFile(res: Response, file: { stream: Readable; mimeType: string; fileName: string }): void {
  res.setHeader('Content-Type', file.mimeType);
  res.setHeader('Content-Disposition', `attachment; filename="${file.fileName.replace(/[^A-Za-z0-9._-]/g, '_')}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  file.stream.on('error', () => res.destroy());
  file.stream.pipe(res);
}
