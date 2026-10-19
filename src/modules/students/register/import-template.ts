import ExcelJS from 'exceljs';
import { ZipFile } from 'yazl';
import { withVerhoeffDigit } from '../aadhaar';
import { DOCUMENTS, IMPORT_COLUMNS } from '../student.constants';

/*
 * Import templates built from one set of synthetic sample rows, so the Excel template and the sample
 * documents ZIP always agree: every document column holds the path of a file that is inside the sample ZIP.
 * The sample uses one folder per student (named by source_record_id); any path works as long as the Excel names it.
 */

/* Tiny but valid files (open in any viewer). */
const PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj ' +
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 100]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
);
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==', 'base64');
const JPG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////' +
    'wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
  'base64',
);
const fileFor = (key: string) =>
  key === 'PHOTO' ? { ext: 'jpg', data: JPG } : key === 'SIGNATURE' ? { ext: 'png', data: PNG } : { ext: 'pdf', data: PDF };

interface SampleRow {
  values: Record<string, string>;
  files: { path: string; data: Buffer }[];
}

function sampleRows(): SampleRow[] {
  const people = [
    {
      n: 1,
      first: 'Asha',
      last: 'Synthetic',
      track: 'Cyber Security',
      centre: 'PUN',
      folder: (id: string, key: string, ext: string) => `${id}/${key.toLowerCase()}.${ext}`,
    },
    {
      n: 2,
      first: 'Vikram',
      last: 'Example',
      track: 'AI-ML Engineer',
      centre: 'Nashik',
      folder: (id: string, key: string, ext: string) => `${id}/${key.toLowerCase()}.${ext}`,
    },
  ];
  return people.map((p) => {
    const id = `MA-SYN-${String(p.n).padStart(6, '0')}`;
    const values: Record<string, string> = {
      source_record_id: id,
      first_name: p.first,
      last_name: p.last,
      father_name: `Ramesh ${p.last}`,
      mother_name: `Sunita ${p.last}`,
      email: `${p.first.toLowerCase()}.${p.last.toLowerCase()}@example.invalid`,
      date_of_birth: '2003-04-12',
      current_address: 'Flat 0, Test Lane, Sample Nagar',
      aadhaar_number: withVerhoeffDigit(`23456789${String(100 + p.n).padStart(3, '0')}`),
      mobile_number: `90000000${String(p.n).padStart(2, '0')}`,
      religion: 'हिंदू',
      caste: 'मराठी',
      course_centre: p.centre,
      technology: p.track,
      education_qualification: 'Graduate',
      approval_status: 'APPROVED',
      approved_at: '2026-01-10T06:30:00Z',
      evidence_ref: `MA-APR-${p.n}`,
      declaration_accepted: 'Yes',
    };
    const files: SampleRow['files'] = [];
    for (const d of DOCUMENTS) {
      const col = `doc_${d.key.toLowerCase()}`;
      if (d.required) {
        const { ext, data } = fileFor(d.key);
        const path = p.folder(id, d.key, ext);
        values[col] = path;
        files.push({ path, data });
      } else values[col] = 'No';
      if (d.barcode) values[`${col}_barcode`] = d.barcode === 'required' ? `BC-${d.key}-${p.n}` : '';
    }
    return { values, files };
  });
}

const header = () => IMPORT_COLUMNS.map((c) => c.field);

/* CSV template (UTF-8 with BOM so Excel opens Marathi text correctly). */
export function templateCsv(): string {
  const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const lines = [header(), ...sampleRows().map((r) => header().map((h) => r.values[h] ?? ''))];
  return String.fromCharCode(0xfeff) + lines.map((l) => l.map(esc).join(',')).join('\r\n') + '\r\n';
}

/* Excel template: the data sheet (first sheet, read by the import) and an instructions sheet. */
export async function templateXlsx(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'AMRUT × SUMAGO Admin';
  const ws = wb.addWorksheet('Students', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = IMPORT_COLUMNS.map((c) => ({
    header: c.field,
    key: c.field,
    width: c.field.startsWith('doc_') ? 34 : Math.max(14, c.field.length + 2),
    style: { numFmt: '@' }, // text: keeps leading zeros and stops Excel turning Aadhaar numbers into 2.34E+11
  }));
  ws.getRow(1).font = { bold: true };
  IMPORT_COLUMNS.forEach((c, i) => {
    const cell = ws.getRow(1).getCell(i + 1);
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: c.required ? 'FFFDEEDB' : 'FFF2EDE7' } };
    cell.note = `${c.label}${c.required ? ' (required)' : ''}`;
  });
  for (const r of sampleRows()) ws.addRow(r.values);

  const help = wb.addWorksheet('Instructions');
  help.columns = [{ width: 34 }, { width: 110 }];
  const rows: [string, string][] = [
    ['How to fill this file', ''],
    ['One row per student', 'Keep the header row. The first sheet ("Students") is the one imported.'],
    ['Dates', 'date_of_birth as YYYY-MM-DD; approved_at as an ISO date-time. Aadhaar and mobile as text.'],
    [
      'Document columns (doc_…)',
      'Write the file name of the document inside this student\'s folder in the ZIP, e.g. photo.jpg (or MA-0001/photo.jpg). Matching ignores case. Write "No" if the document is not supplied.',
    ],
    [
      'Documents ZIP',
      "One folder per student, named exactly like source_record_id (e.g. MA-0001/photo.jpg, MA-0001/aadhaar_card.pdf). No other folders. Each file must be PDF, JPG or PNG, at most 5 MB. Upload it with this file (or later from the batch page); after finalising, the files are stored in that student's own folder.",
    ],
    [
      'Without file names',
      'You may also write "Yes" and name the files by document type inside the student folder, e.g. MA-0001/AADHAAR_CARD.pdf.',
    ],
    ['Sample', 'Download the sample documents ZIP next to this template: uploading both together shows the expected result.'],
    ['', ''],
    ['Column', 'Meaning'],
    ...IMPORT_COLUMNS.map((c): [string, string] => [c.field, `${c.label}${c.required ? ' — required' : ''}`]),
  ];
  rows.forEach((r) => help.addRow(r));
  help.getRow(1).font = { bold: true, size: 13 };
  help.getRow(9).font = { bold: true };
  help.getColumn(2).alignment = { wrapText: true, vertical: 'top' };

  return Buffer.from(await wb.xlsx.writeBuffer());
}

/* Sample documents ZIP matching the template's paths. */
export function sampleDocumentsZip(): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const zip = new ZipFile();
    for (const r of sampleRows()) for (const f of r.files) zip.addBuffer(f.data, f.path);
    const chunks: Buffer[] = [];
    zip.outputStream.on('data', (c: Buffer) => chunks.push(c));
    zip.outputStream.on('end', () => resolve(Buffer.concat(chunks)));
    zip.outputStream.on('error', reject);
    zip.end();
  });
}
