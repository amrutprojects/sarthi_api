/* Allowed document types, detected from the file content (magic bytes), never from the name alone (spec Table 81). */
export type DocumentFileType = { ext: 'pdf' | 'jpg' | 'png'; mime: 'application/pdf' | 'image/jpeg' | 'image/png' };

export function detectFileType(buf: Buffer): DocumentFileType | null {
  if (buf.length >= 5 && buf.subarray(0, 5).toString('latin1') === '%PDF-') return { ext: 'pdf', mime: 'application/pdf' };
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { ext: 'jpg', mime: 'image/jpeg' };
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { ext: 'png', mime: 'image/png' };
  }
  return null;
}

/* The name's extension must agree with the content (a renamed .exe is rejected even if it starts like a PDF). */
export function extensionMatches(fileName: string, type: DocumentFileType): boolean {
  const ext = fileName.toLowerCase().split('.').pop() ?? '';
  return type.ext === 'jpg' ? ext === 'jpg' || ext === 'jpeg' : ext === type.ext;
}
