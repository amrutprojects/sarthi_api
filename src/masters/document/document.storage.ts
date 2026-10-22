import { createHash, randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import type { FileHandle } from 'fs/promises';
import path from 'path';
import { env } from '../../config/env.config';
import { logger } from '../../observability/logger';
import { AppError } from '../../shared/errors/app-error';
import type { DocumentMimeType, StoredDocumentFile, UploadedFile } from './document.types';

/*
 * Private file storage of the Document Master.
 *
 * Files live under DOCUMENT_STORAGE_DIR (outside the web root, never served statically) as
 * <random uuid>.<ext>. The name on disk never comes from the client: the original file name is only
 * metadata on the row, and every path is built from the stored key and checked to stay inside the
 * storage directory.
 *
 * The file type is decided by its first bytes, not by the extension or the Content-Type the browser
 * sent, so a renamed executable or HTML page is refused however it is labelled. The recorded name (shown
 * in the lists and suggested for the download) always ends in an extension of that detected type, so a
 * PDF uploaded as "letter.hta" is saved by whoever downloads it as "letter.hta.pdf", never as an .hta.
 */

interface FileKind {
  mimeType: DocumentMimeType;
  ext: '.pdf' | '.png' | '.jpg';
  magic: Buffer;
}

const KINDS: FileKind[] = [
  { mimeType: 'application/pdf', ext: '.pdf', magic: Buffer.from('%PDF-', 'ascii') },
  { mimeType: 'image/png', ext: '.png', magic: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
  { mimeType: 'image/jpeg', ext: '.jpg', magic: Buffer.from([0xff, 0xd8, 0xff]) },
];

/* Shape of every key this module writes; anything else on a row is treated as tampering. */
const STORAGE_KEY_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:pdf|png|jpg)$/;

const MAX_NAME_LENGTH = 255;

/* Extensions a file name may end with for each stored type (compared in lower case); the first is the one appended. */
const NAME_EXTENSIONS: Record<DocumentMimeType, readonly string[]> = {
  'application/pdf': ['.pdf'],
  'image/png': ['.png'],
  'image/jpeg': ['.jpg', '.jpeg'],
};

/*
 * Never kept in a file name: control characters, path separators, line / paragraph separators and the
 * invisible format characters, among them the bidi overrides (U+202E would show "x<RLO>fdp.hta" as
 * "xath.pdf"). ZWNJ / ZWJ (U+200C / U+200D) stay: Devanagari spelling needs them and they cannot reorder text.
 */
const UNSAFE_NAME_CHARS = /(?![\u200c\u200d])[\p{Cc}\p{Cf}\u2028\u2029/\\]/gu;

export const fileRuleMessage = () => `Upload a PDF, JPG or PNG file of at most ${env.DOCUMENT_MAX_FILE_MB} MB`;

/* 400 carrying field "file", so the admin panel shows it under the file input. */
export const fileError = (message = fileRuleMessage()) => AppError.badRequest(message, [{ field: 'file', message }]);

const storageRoot = () => path.resolve(env.DOCUMENT_STORAGE_DIR);

const detectKind = (buffer: Buffer): FileKind | undefined =>
  KINDS.find((k) => buffer.length >= k.magic.length && buffer.subarray(0, k.magic.length).equals(k.magic));

/*
 * Busboy (inside multer) decodes the multipart filename as latin1, while browsers send UTF-8 bytes, so a
 * Marathi file name arrives garbled. Re-decode it when it round-trips cleanly; otherwise keep it as is.
 */
const decodeOriginalName = (raw: string): string => {
  if (Array.from(raw).some((c) => (c.codePointAt(0) ?? 0) > 0xff)) return raw;
  const utf8 = Buffer.from(raw, 'latin1').toString('utf8');
  return utf8.includes('\uFFFD') ? raw : utf8;
};

/*
 * A name that is safe to show and to save a download under: unsafe characters removed, whitespace collapsed,
 * ending in an extension of the stored type (any other ending, ".hta", ".html" or none, gets that type's
 * extension appended), at most 255 characters with the extension kept when cut. Applying it to its own
 * result changes nothing, so it can be re-applied to names recorded earlier.
 */
function typedFileName(name: string, mimeType: DocumentMimeType): string {
  const allowed = NAME_EXTENSIONS[mimeType];
  const cleaned = name.replace(UNSAFE_NAME_CHARS, '').replace(/\s+/g, ' ').trim();
  const dot = cleaned.lastIndexOf('.');
  const current = dot >= 0 ? cleaned.slice(dot) : '';
  const keep = allowed.includes(current.toLowerCase());
  const ext = keep ? current : allowed[0];
  const stem = keep ? cleaned.slice(0, dot) : cleaned;
  if (/^\.*$/.test(stem)) return `document${ext}`;
  return Array.from(stem).slice(0, MAX_NAME_LENGTH - Array.from(ext).length).join('') + ext;
}

/* The original name of an upload, kept for display and for the download's suggested name only: its last path segment, typed as above. */
export function sanitizeFileName(raw: string, mimeType: DocumentMimeType): string {
  const base = decodeOriginalName(raw).split(/[/\\]/).pop() ?? '';
  return typedFileName(base, mimeType);
}

/* A type this module stores. Any other mimeType on a row is treated as tampering, like a foreign storage key. */
export const isDocumentMimeType = (mimeType: string): mimeType is DocumentMimeType => KINDS.some((k) => k.mimeType === mimeType);

/*
 * The recorded name as the API shows it and a download offers it: typed again from the row's mimeType, so
 * a row written before the extension rule never offers another extension either. A row of an unknown type
 * keeps its cleaned name; its file is never served (DocumentService.openFile).
 */
export function displayFileName(fileName: string, mimeType: string): string {
  return isDocumentMimeType(mimeType) ? typedFileName(fileName, mimeType) : fileName.replace(UNSAFE_NAME_CHARS, '');
}

/* Absolute path of a stored file. Refuses any key that is not one this module wrote, or that escapes the directory. */
export function storedFilePath(storageKey: string): string {
  const root = storageRoot();
  const full = path.resolve(root, storageKey);
  const rel = path.relative(root, full);
  if (!STORAGE_KEY_RE.test(storageKey) || rel !== storageKey || path.isAbsolute(rel)) {
    throw AppError.notFound('The file of this document is missing');
  }
  return full;
}

/*
 * Checks an upload (content type by magic bytes, size) and writes it to private storage under a fresh
 * random key. Runs before the database transaction; if that transaction fails the caller removes the file
 * again with discardStoredFile.
 */
export async function storeUpload(file: UploadedFile): Promise<StoredDocumentFile> {
  const maxBytes = env.DOCUMENT_MAX_FILE_MB * 1024 * 1024;
  const size = file.buffer.length;
  if (size === 0 || size > maxBytes) throw fileError();
  const kind = detectKind(file.buffer);
  if (!kind) throw fileError();

  const storageKey = `${randomUUID()}${kind.ext}`;
  const root = storageRoot();
  await fs.mkdir(root, { recursive: true });
  /* 'wx': never overwrite an existing file, even on the (theoretical) uuid collision. */
  await fs.writeFile(storedFilePath(storageKey), file.buffer, { flag: 'wx', mode: 0o640 });

  return {
    fileName: sanitizeFileName(file.originalname, kind.mimeType),
    mimeType: kind.mimeType,
    fileSize: size,
    sha256: createHash('sha256').update(file.buffer).digest('hex'),
    storageKey,
  };
}

/* Best effort: removes a file written for a request whose database write then failed. */
export async function discardStoredFile(storageKey: string): Promise<void> {
  try {
    await fs.unlink(storedFilePath(storageKey));
  } catch (err) {
    logger.warn({ err, storageKey }, 'could not remove an orphaned document file');
  }
}

/* Opens a stored file for streaming. A missing file is a 404, not a 500. */
export async function openStoredFile(storageKey: string): Promise<{ handle: FileHandle; size: number }> {
  let handle: FileHandle;
  try {
    handle = await fs.open(storedFilePath(storageKey), 'r');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR' || code === 'EISDIR') throw AppError.notFound('The file of this document is missing');
    throw err;
  }
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw AppError.notFound('The file of this document is missing');
    return { handle, size: stat.size };
  } catch (err) {
    await handle.close();
    throw err;
  }
}

/*
 * Content-Disposition for a download: an ASCII fallback for old clients plus the exact UTF-8 name
 * (RFC 6266 / RFC 5987), so a Devanagari file name survives and no quote or newline can break the header.
 */
export function attachmentDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_') || 'document';
  const encoded = encodeURIComponent(fileName).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
