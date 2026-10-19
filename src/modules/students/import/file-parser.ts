import { parse as parseCsv } from 'csv-parse/sync';
import ExcelJS from 'exceljs';
import { IGNORED_COLUMNS, IMPORT_COLUMNS } from '../student.constants';

export class ImportFileError extends Error {}

export interface ParsedFile {
  /* field name → source header actually used */
  mapping: Record<string, string>;
  ignoredColumns: string[];
  rows: Record<string, string>[];
}

/* Byte-order mark that Excel and Notepad put at the start of UTF-8 CSV files. */
const BOM_RE = new RegExp('^' + String.fromCharCode(0xfeff));
const norm = (h: string) =>
  h
    .replace(BOM_RE, '')
    .toLowerCase()
    .replace(/[_\s]+/g, ' ')
    .replace(/&amp;/g, '&')
    .trim();

/* Type is decided by content, not by the file name: XLSX is a ZIP (PK\x03\x04); CSV must be valid UTF-8 text. */
function detectType(buf: Buffer): 'xlsx' | 'csv' {
  if (buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) return 'xlsx';
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    throw new ImportFileError('The file is neither an XLSX workbook nor UTF-8 encoded CSV');
  }
  if (buf.subarray(0, 4096).includes(0)) throw new ImportFileError('The file contains binary data and is not CSV');
  return 'csv';
}

function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10); // dates arrive as UTC midnight
  if (typeof v === 'object') {
    if ('text' in v && typeof v.text === 'string') return v.text;
    if ('result' in v) return cellText(v.result as ExcelJS.CellValue);
    if ('richText' in v) return v.richText.map((r) => r.text).join('');
    if ('hyperlink' in v && 'text' in v) return String(v.text);
    return '';
  }
  return String(v);
}

async function readTable(buf: Buffer): Promise<string[][]> {
  if (detectType(buf) === 'csv') {
    try {
      return parseCsv(buf.toString('utf8').replace(BOM_RE, ''), {
        relax_column_count: true,
        skip_empty_lines: true,
        bom: true,
      }) as string[][];
    } catch (e) {
      throw new ImportFileError(`The CSV file could not be read: ${(e as Error).message}`);
    }
  }
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
  } catch {
    throw new ImportFileError('The XLSX workbook could not be read');
  }
  const ws = wb.worksheets[0];
  if (!ws) throw new ImportFileError('The workbook has no sheet');
  const out: string[][] = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    const vals = (row.values as ExcelJS.CellValue[]).slice(1).map(cellText);
    if (vals.some((v) => v.trim())) out.push(vals);
  });
  return out;
}

/* Reads the file, maps its header row to internal fields by name and alias, and returns the data rows. */
export async function parseImportFile(buf: Buffer, maxRows: number): Promise<ParsedFile> {
  if (!buf.length) throw new ImportFileError('The file is empty');
  const table = await readTable(buf);
  if (!table.length) throw new ImportFileError('The file has no header row');
  const header = table[0].map((h) => String(h ?? ''));
  const dataRows = table.slice(1);
  if (!dataRows.length) throw new ImportFileError('The file has a header row but no data rows');
  if (dataRows.length > maxRows) throw new ImportFileError(`The file has ${dataRows.length} rows; the limit is ${maxRows}`);

  const mapping: Record<string, string> = {};
  const indexOf: Record<string, number> = {};
  const ignoredColumns: string[] = [];
  header.forEach((h, i) => {
    const key = norm(h);
    if (!key) return;
    const col = IMPORT_COLUMNS.find((c) => norm(c.field) === key || norm(c.label) === key || c.aliases.some((a) => norm(a) === key));
    if (!col) {
      ignoredColumns.push(h.trim());
      return;
    }
    if (col.field in indexOf)
      throw new ImportFileError(`Two columns map to the same field "${col.field}": "${mapping[col.field]}" and "${h.trim()}"`);
    mapping[col.field] = h.trim();
    indexOf[col.field] = i;
  });

  const missing = IMPORT_COLUMNS.filter((c) => c.required && !(c.field in indexOf)).map((c) => c.label);
  if (missing.length) throw new ImportFileError(`Required columns missing: ${missing.join(', ')}`);

  const rows = dataRows.map((r) => Object.fromEntries(Object.entries(indexOf).map(([f, i]) => [f, String(r[i] ?? '')])));
  /* Unmapped columns are listed on the batch and ignored (Caste Description is expected and ignored in V1.0). */
  return { mapping, ignoredColumns: ignoredColumns.map((c) => (IGNORED_COLUMNS.includes(norm(c)) ? `${c} (not used in V1.0)` : c)), rows };
}
