import { ZipFile } from 'yazl';

/* Builds a ZIP in memory for tests. Paths are used exactly as given (including unsafe ones, to test zip-slip). */
export function buildZip(entries: Record<string, Buffer | string>): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const zip = new ZipFile();
    for (const [name, data] of Object.entries(entries)) zip.addBuffer(Buffer.isBuffer(data) ? data : Buffer.from(data), name);
    const chunks: Buffer[] = [];
    zip.outputStream.on('data', (c: Buffer) => chunks.push(c));
    zip.outputStream.on('end', () => resolve(Buffer.concat(chunks)));
    zip.outputStream.on('error', reject);
    zip.end();
  });
}

/* Minimal files whose content passes the type check. */
export const samplePdf = (extra = '') => Buffer.from(`%PDF-1.4\n% synthetic test document ${extra}\n%%EOF\n`);
export const sampleJpg = () => Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0xff, 0xd9]);
export const samplePng = () => Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
