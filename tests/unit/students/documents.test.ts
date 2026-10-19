import fs from 'fs';
import os from 'os';
import path from 'path';
import { detectFileType, extensionMatches } from '../../../src/modules/students/documents/file-type';
import { documentTypeFromName, locate, readDocumentsZip, type ZipDocument } from '../../../src/modules/students/documents/zip-reader';
import { resolveKey, safeSegment } from '../../../src/modules/students/documents/document-storage';
import { zipPathFromCell } from '../../../src/modules/students/import/row-validator';
import { buildZip, sampleJpg, samplePdf, samplePng } from '../../helpers/zip';

const limits = { maxFiles: 100, maxFileBytes: 1024, maxTotalBytes: 10 * 1024 };
async function read(entries: Record<string, Buffer | string>, l = limits) {
  const file = path.join(os.tmpdir(), `zip-test-${process.pid}-${Math.random().toString(36).slice(2)}.zip`);
  fs.writeFileSync(file, await buildZip(entries));
  const docs: ZipDocument[] = [];
  try {
    const { skipped } = await readDocumentsZip(file, l, async (d) => void docs.push(d));
    return { docs, skipped };
  } finally {
    fs.rmSync(file, { force: true });
  }
}

describe('document type and location', () => {
  it.each([
    ['PHOTO', 'PHOTO'],
    ['photograph', 'PHOTO'],
    ['Aadhaar Card', 'AADHAAR_CARD'],
    ['aadhar', 'AADHAAR_CARD'],
    ['Income Certificate / EWS', 'INCOME_EWS'],
    ['caste_certificate', 'CASTE_CERT'],
    ['holiday-pics', null],
  ])('%s → %s', (name, type) => expect(documentTypeFromName(name)).toBe(type));

  it('reads folder layouts and flat file names', () => {
    expect(locate('MA-0001/PHOTO.jpg')).toMatchObject({ studentFolder: 'MA-0001', docType: 'PHOTO' });
    expect(locate('batch-docs/MA-0001/aadhaar_card.pdf')).toMatchObject({ studentFolder: 'MA-0001', docType: 'AADHAAR_CARD' });
    expect(locate('MA_0001_CASTE_CERT.pdf')).toMatchObject({ studentFolder: 'MA_0001', docType: 'CASTE_CERT' });
    expect(locate('random.pdf')).toMatchObject({ studentFolder: null });
  });
});

describe('file type by content', () => {
  it('detects PDF, JPEG and PNG and rejects anything else', () => {
    expect(detectFileType(samplePdf())?.ext).toBe('pdf');
    expect(detectFileType(sampleJpg())?.ext).toBe('jpg');
    expect(detectFileType(samplePng())?.ext).toBe('png');
    expect(detectFileType(Buffer.from('MZ\x90\x00 executable'))).toBeNull();
  });

  it('requires the extension to agree with the content', () => {
    const pdf = detectFileType(samplePdf())!;
    expect(extensionMatches('a.PDF', pdf)).toBe(true);
    expect(extensionMatches('a.jpg', pdf)).toBe(false);
    expect(extensionMatches('a.jpeg', detectFileType(sampleJpg())!)).toBe(true);
  });
});

describe('readDocumentsZip', () => {
  it('returns each file with its student folder and type, skipping system files', async () => {
    const { docs, skipped } = await read({
      'MA-1/PHOTO.jpg': sampleJpg(),
      'MA-1/AADHAAR_CARD.pdf': samplePdf(),
      '__MACOSX/MA-1/._PHOTO.jpg': 'x',
      'MA-1/.DS_Store': 'x',
    });
    expect(docs.map((d) => [d.studentFolder, d.docType])).toEqual([
      ['MA-1', 'PHOTO'],
      ['MA-1', 'AADHAAR_CARD'],
    ]);
    expect(skipped).toHaveLength(2);
  });

  it('flags files larger than the per-file limit without reading them into memory', async () => {
    const { docs } = await read({ 'MA-1/PHOTO.pdf': Buffer.concat([samplePdf(), Buffer.alloc(5000)]) });
    expect(docs[0]).toMatchObject({ tooLarge: true, data: null });
  });

  it('refuses path traversal (zip-slip)', async () => {
    /* ZIP writers refuse "../" names, so build a same-length safe name and patch the bytes, as an attacker would. */
    const safe = 'xx/xx/evil/PHOTO.pdf';
    const evil = '../../evil/PHOTO.pdf';
    const zip = await buildZip({ [safe]: samplePdf() });
    let patched = zip.toString('latin1');
    while (patched.includes(safe)) patched = patched.replace(safe, evil);
    const file = path.join(os.tmpdir(), `zip-slip-${process.pid}.zip`);
    fs.writeFileSync(file, Buffer.from(patched, 'latin1'));
    try {
      await expect(readDocumentsZip(file, limits, async () => undefined)).rejects.toThrow(/Unsafe path|invalid relative path/);
    } finally {
      fs.rmSync(file, { force: true });
    }
  });

  it('refuses archives with too many files or too much total data', async () => {
    const many = Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`MA-${i}/PHOTO.pdf`, samplePdf()]));
    await expect(read(many, { ...limits, maxFiles: 3 })).rejects.toThrow(/more than 3 files/);
    await expect(read(many, { ...limits, maxTotalBytes: 100 })).rejects.toThrow(/total size/);
  });

  it('rejects a file that is not a ZIP', async () => {
    const file = path.join(os.tmpdir(), `not-zip-${process.pid}.zip`);
    fs.writeFileSync(file, 'hello');
    await expect(readDocumentsZip(file, limits, async () => undefined)).rejects.toThrow(/not a valid ZIP/);
    fs.rmSync(file, { force: true });
  });
});

describe('storage keys', () => {
  it('sanitises names and never resolves outside the storage root', () => {
    expect(safeSegment('MA/../../etc passwd')).toBe('MA_.._.._etc_passwd');
    expect(() => resolveKey('../outside.txt')).toThrow(/escapes/);
    expect(resolveKey('students/STU-000001/PHOTO.jpg')).toMatch(/students[\\/]STU-000001[\\/]PHOTO\.jpg$/);
  });
});

describe('document paths in the Excel', () => {
  const BS = String.fromCharCode(92);
  it.each([
    ['MA-0001/photo.jpg', 'MA-0001/photo.jpg'],
    [`scans${BS}asha aadhaar.pdf`, 'scans/asha aadhaar.pdf'],
    ['./docs/a.PDF', 'docs/a.PDF'],
    ['/docs//a.pdf', 'docs/a.pdf'],
    ['photo.jpg', 'photo.jpg'],
  ])('%s → %s', (cell, path) => expect(zipPathFromCell(cell)).toBe(path));

  it.each(['Yes', 'no', 'N/A', '', 'Not supplied', '../etc/passwd.pdf', 'Uploaded'])('%s is not a path', (cell) => {
    expect(zipPathFromCell(cell)).toBeNull();
  });
});
