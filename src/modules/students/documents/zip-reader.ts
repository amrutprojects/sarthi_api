import yauzl, { type Entry, type ZipFile } from 'yauzl';
import { DOCUMENTS } from '../student.constants';

export class ZipFormatError extends Error {}

export interface ZipLimits {
  maxFiles: number;
  /* Per file, enforced on the actual decompressed bytes, not the size the archive claims. */
  maxFileBytes: number;
  /* Total decompressed bytes across the archive (zip-bomb guard). */
  maxTotalBytes: number;
}

/* One document file found in the ZIP. `data` is null when the file was too large to read. */
export interface ZipDocument {
  path: string;
  studentFolder: string | null;
  docType: string | null;
  fileName: string;
  data: Buffer | null;
  tooLarge: boolean;
}

const norm = (s: string) =>
  s
    .toUpperCase()
    .replace(/&/g, 'AND')
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

/* Document type from a file name (without extension): the key itself, the label, or a common alias. */
const TYPE_BY_NAME = new Map<string, string>();
for (const d of DOCUMENTS) {
  TYPE_BY_NAME.set(norm(d.key), d.key);
  TYPE_BY_NAME.set(norm(d.label), d.key);
}
for (const [alias, key] of Object.entries({
  PHOTOGRAPH: 'PHOTO',
  PASSPORT_PHOTO: 'PHOTO',
  SIGN: 'SIGNATURE',
  AADHAAR: 'AADHAAR_CARD',
  AADHAR: 'AADHAAR_CARD',
  AADHAR_CARD: 'AADHAAR_CARD',
  PAN: 'PAN_CARD',
  INCOME: 'INCOME_EWS',
  EWS: 'INCOME_EWS',
  INCOME_CERTIFICATE: 'INCOME_EWS',
  DOMICILE_CERTIFICATE: 'DOMICILE',
  LEAVING_CERTIFICATE: 'SCHOOL_LEAVING',
  TC: 'SCHOOL_LEAVING',
  LC: 'SCHOOL_LEAVING',
  EDUCATION: 'EDU_CERT',
  QUALIFICATION: 'EDU_CERT',
  MEDICAL: 'FITNESS',
  MEDICAL_CERTIFICATE: 'FITNESS',
  FITNESS_CERTIFICATE: 'FITNESS',
  DECLARATION: 'SELF_DECLARATION',
  CASTE: 'CASTE_CERT',
  CASTE_CERTIFICATE: 'CASTE_CERT',
  GAZETTE: 'NAME_CHANGE',
  MARRIAGE_CERTIFICATE: 'NAME_CHANGE',
}))
  TYPE_BY_NAME.set(alias, key);

export const documentTypeFromName = (base: string): string | null => TYPE_BY_NAME.get(norm(base)) ?? null;

/*
 * Where a file belongs. Only one layout is accepted: one folder per student, named by the row's source_record_id:
 *   <studentId>/<file>                  e.g. MA-0001/photo.jpg
 *   <oneWrappingFolder>/<studentId>/<file>   the same, when a whole folder was zipped (e.g. documents/MA-0001/photo.jpg)
 * Files at the top level, or nested deeper inside a student folder, have no student folder (they are rejected).
 */
export function locate(entryPath: string): { studentFolder: string | null; docType: string | null; fileName: string } {
  const parts = entryPath.split('/').filter(Boolean);
  const fileName = parts[parts.length - 1] ?? '';
  const docType = documentTypeFromName(fileName.replace(/\.[^.]+$/, ''));
  if (parts.length === 2) return { studentFolder: parts[0], docType, fileName };
  if (parts.length === 3) return { studentFolder: parts[1], docType, fileName };
  return { studentFolder: null, docType, fileName };
}

/* Paths that are unsafe (absolute, drive letters, '..') are refused outright: zip-slip protection. */
const unsafePath = (p: string) => p.startsWith('/') || /^[A-Za-z]:/.test(p) || p.split(/[\\/]/).includes('..');
const ignored = (p: string) =>
  p.split('/').some((s) => s === '__MACOSX' || (s.startsWith('.') && s.length > 1)) || /(^|\/)(Thumbs\.db|desktop\.ini)$/i.test(p);

const open = (file: string) =>
  new Promise<ZipFile>((resolve, reject) =>
    yauzl.open(file, { lazyEntries: true, autoClose: true, strictFileNames: false, validateEntrySizes: true }, (err, zip) =>
      err || !zip ? reject(new ZipFormatError('The documents file is not a valid ZIP archive')) : resolve(zip),
    ),
  );

/* Reads one entry, stopping as soon as it exceeds the per-file limit. */
function readEntry(zip: ZipFile, entry: Entry, maxBytes: number): Promise<{ data: Buffer | null; bytes: number }> {
  return new Promise((resolve, reject) => {
    if (entry.uncompressedSize > maxBytes) return resolve({ data: null, bytes: 0 });
    zip.openReadStream(entry, (err, stream) => {
      if (err || !stream) return reject(new ZipFormatError(`Cannot read ${entry.fileName}`));
      const chunks: Buffer[] = [];
      let bytes = 0;
      stream.on('data', (c: Buffer) => {
        bytes += c.length;
        if (bytes > maxBytes) {
          stream.destroy();
          resolve({ data: null, bytes });
          return;
        }
        chunks.push(c);
      });
      stream.on('end', () => resolve({ data: Buffer.concat(chunks), bytes }));
      stream.on('error', () => reject(new ZipFormatError(`Corrupt entry ${entry.fileName}`)));
    });
  });
}

/* Streams the archive entry by entry (never the whole archive in memory) and calls onDocument for each file. */
export async function readDocumentsZip(
  file: string,
  limits: ZipLimits,
  onDocument: (doc: ZipDocument) => Promise<void>,
): Promise<{ skipped: string[] }> {
  const zip = await open(file);
  const skipped: string[] = [];
  let files = 0;
  let total = 0;
  return new Promise((resolve, reject) => {
    const fail = (e: unknown) => {
      zip.close();
      reject(e instanceof ZipFormatError ? e : new ZipFormatError((e as Error).message));
    };
    zip.on('error', fail);
    zip.on('end', () => resolve({ skipped }));
    zip.on('entry', (entry: Entry) => {
      (async () => {
        const p = entry.fileName.replace(/\\/g, '/');
        if (p.endsWith('/')) return; // directory
        if (unsafePath(p)) throw new ZipFormatError(`Unsafe path in archive: ${p}`);
        if (ignored(p)) {
          skipped.push(p);
          return;
        }
        if (++files > limits.maxFiles) throw new ZipFormatError(`The archive has more than ${limits.maxFiles} files`);
        const { data, bytes } = await readEntry(zip, entry, limits.maxFileBytes);
        total += data ? data.length : Math.max(bytes, entry.uncompressedSize);
        if (total > limits.maxTotalBytes) throw new ZipFormatError('The archive expands beyond the allowed total size');
        await onDocument({ path: p, ...locate(p), data, tooLarge: !data });
      })().then(() => zip.readEntry(), fail);
    });
    zip.readEntry();
  });
}
