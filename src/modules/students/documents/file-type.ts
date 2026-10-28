/* Allowed document types, detected from the file content (magic bytes), never from the name alone (spec Table 81). */
export type DocumentFileType = { ext: 'pdf' | 'jpg' | 'png'; mime: 'application/pdf' | 'image/jpeg' | 'image/png' };
export type VideoFileType = { ext: 'mp4'; mime: 'video/mp4' };

export function detectFileType(buf: Buffer): DocumentFileType | null {
  if (buf.length >= 5 && buf.subarray(0, 5).toString('latin1') === '%PDF-') return { ext: 'pdf', mime: 'application/pdf' };
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { ext: 'jpg', mime: 'image/jpeg' };
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { ext: 'png', mime: 'image/png' };
  }
  return null;
}

/*
 * An MP4 video: an ISO base media file whose first box is "ftyp" (bytes 4–7). A QuickTime file (major brand "qt  ",
 * usually .mov) is not accepted as MP4.
 */
export function detectVideoType(buf: Buffer): VideoFileType | null {
  if (buf.length < 12 || buf.subarray(4, 8).toString('latin1') !== 'ftyp') return null;
  if (buf.subarray(8, 12).toString('latin1') === 'qt  ') return null;
  return { ext: 'mp4', mime: 'video/mp4' };
}

/* The name's extension must agree with the content (a renamed .exe is rejected even if it starts like a PDF). */
export function extensionMatches(fileName: string, type: DocumentFileType | VideoFileType): boolean {
  const ext = fileName.toLowerCase().split('.').pop() ?? '';
  return type.ext === 'jpg' ? ext === 'jpg' || ext === 'jpeg' : ext === type.ext;
}

/*
 * Upload rules per document type. Every document is a PDF / JPG / JPEG / PNG of at most 5 MB, except the video types
 * (Applicant Video with Aadhaar): an MP4 of at most 50 MB.
 */
export const DOCUMENT_FILE_MAX_MB = 5;
export const VIDEO_FILE_MAX_MB = 50;
export const VIDEO_DOCUMENT_TYPES: readonly string[] = ['APPLICANT_VIDEO'];
export const isVideoDocumentType = (code: string) => VIDEO_DOCUMENT_TYPES.includes(code.toUpperCase());
export const documentFileRule = (code: string) =>
  isVideoDocumentType(code)
    ? { formats: ['MP4'], maxMb: VIDEO_FILE_MAX_MB }
    : { formats: ['PDF', 'JPG', 'JPEG', 'PNG'], maxMb: DOCUMENT_FILE_MAX_MB };
/* The largest file any document type allows (the multipart limit; each type's own limit is checked afterwards). */
export const UPLOAD_FILE_MAX_MB = Math.max(DOCUMENT_FILE_MAX_MB, VIDEO_FILE_MAX_MB);
