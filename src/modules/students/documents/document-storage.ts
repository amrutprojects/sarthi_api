import { createReadStream } from 'fs';
import fs from 'fs/promises';
import path from 'path';
import { env } from '../../../config/env.config';

/*
 * Private file storage for student documents (spec SEC: private storage, access only through the API).
 * Layout under STORAGE_DIR:
 *   imports/<batchCode>/<sourceRecordId>/<DOCTYPE>.<ext>   staged while a batch is being reviewed
 *   students/<studentCode>/<DOCTYPE>.<ext>                 one folder per student after finalisation
 *   students/<studentCode>/_replaced/<time>-<DOCTYPE>.<ext> earlier versions kept when a document is replaced
 * Keys are always relative, forward-slash paths; every key is resolved and checked to stay inside the root.
 */
const backendRoot = path.resolve(__dirname, '../../../..');
export const storageRoot = () => path.resolve(backendRoot, env.STORAGE_DIR);

/* Folder and file names: letters, digits, '.', '_' and '-' only (source IDs are sanitised the same way). */
export const safeSegment = (s: string) =>
  s
    .replace(/[^A-Za-z0-9._-]/g, '_')
    .replace(/^\.+/, '_')
    .slice(0, 100) || '_';

export function resolveKey(key: string): string {
  const root = storageRoot();
  const full = path.resolve(root, ...key.split('/'));
  if (full !== root && !full.startsWith(root + path.sep)) throw new Error(`Storage key escapes the storage root: ${key}`);
  return full;
}

export const documentStorage = {
  stagingKey: (batchCode: string, sourceRecordId: string, fileName: string) =>
    ['imports', safeSegment(batchCode), safeSegment(sourceRecordId), safeSegment(fileName)].join('/'),
  studentKey: (studentCode: string, fileName: string) => ['students', safeSegment(studentCode), safeSegment(fileName)].join('/'),
  replacedKey: (studentCode: string, fileName: string) =>
    ['students', safeSegment(studentCode), '_replaced', `${Date.now()}-${safeSegment(fileName)}`].join('/'),

  async write(key: string, data: Buffer): Promise<void> {
    const full = resolveKey(key);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, data, { mode: 0o600 });
  },

  async copy(fromKey: string, toKey: string): Promise<void> {
    const to = resolveKey(toKey);
    await fs.mkdir(path.dirname(to), { recursive: true });
    await fs.copyFile(resolveKey(fromKey), to);
  },

  async move(fromKey: string, toKey: string): Promise<void> {
    const to = resolveKey(toKey);
    await fs.mkdir(path.dirname(to), { recursive: true });
    await fs.rename(resolveKey(fromKey), to);
  },

  async remove(key: string): Promise<void> {
    await fs.rm(resolveKey(key), { force: true });
  },

  /* Removes a folder (e.g. a cancelled batch's staging area). */
  async removeTree(key: string): Promise<void> {
    await fs.rm(resolveKey(key), { recursive: true, force: true });
  },

  async exists(key: string): Promise<boolean> {
    return fs.access(resolveKey(key)).then(
      () => true,
      () => false,
    );
  },

  read: (key: string) => createReadStream(resolveKey(key)),
};
