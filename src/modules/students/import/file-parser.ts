import { parse as parseCsv } from 'csv-parse/sync';
import ExcelJS from 'exceljs';
import { IGNORED_COLUMNS, IMPORT_COLUMNS, REQUIRED_COLUMN_GROUPS, SENSITIVE_COLUMN_RE } from '../student.constants';

export class ImportFileError extends Error {}

export interface ParsedFile {
  /* field name → source header actually used */
  mapping: Record<string, string>;
  /* Columns not read into a field: unknown columns (kept per row in `extras`) and columns never stored. */
  ignoredColumns: string[];
  rows: Record<string, string>[];
  /* Per row (same order as rows): the non-empty values of the columns no field reads, by their header as written. */
  extras: Record<string, string>[];
}

/* Byte-order mark that Excel and Notepad put at the start of UTF-8 CSV files. */
const BOM_RE = new RegExp('^' + String.fromCharCode(0xfeff));
/*
 * Header key: case, spaces, underscores and punctuation do not matter, so "applicationId", "Application ID" and
 * "application_id" are one header, as are "Father's Name" and "Are you a disabled person ?". Letters (with their
 * marks, for Marathi headers) and digits are kept.
 */
export const headerKey = (h: string) =>
  h
    .replace(BOM_RE, '')
    .normalize('NFC')
    .replace(/&amp;/g, '&')
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, '');

/* Field by header key (the internal name, the label and every alias). */
const FIELD_BY_KEY = new Map<string, string>();
for (const c of IMPORT_COLUMNS)
  for (const h of [c.field, c.label, ...c.aliases]) if (!FIELD_BY_KEY.has(headerKey(h))) FIELD_BY_KEY.set(headerKey(h), c.field);
const IGNORED_KEYS = new Set(IGNORED_COLUMNS.map(headerKey));

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

const pad = (n: number) => String(n).padStart(2, '0');

/*
 * Excel stores a date as the wall-clock value in UTC: a date alone becomes YYYY-MM-DD; a date with a time becomes
 * "YYYY-MM-DD HH:mm:ss" (no zone, read in the source time zone like the same text in a CSV). A number formatted as a
 * percentage (0.785 shown as 78.5%) is read as the percentage shown.
 */
function cellText(v: ExcelJS.CellValue, numFmt?: string): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return '';
    const day = v.toISOString().slice(0, 10);
    const hasTime = v.getUTCHours() || v.getUTCMinutes() || v.getUTCSeconds();
    return hasTime ? `${day} ${pad(v.getUTCHours())}:${pad(v.getUTCMinutes())}:${pad(v.getUTCSeconds())}` : day;
  }
  if (typeof v === 'number') {
    if (numFmt && numFmt.includes('%')) return String(Math.round(v * 100 * 1e6) / 1e6);
    return String(v);
  }
  if (typeof v === 'object') {
    if ('richText' in v && Array.isArray(v.richText)) return v.richText.map((r) => r.text).join('');
    if ('text' in v && typeof v.text === 'string') return v.text;
    if ('result' in v) return cellText(v.result as ExcelJS.CellValue, numFmt);
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
    const vals: string[] = [];
    for (let i = 1; i <= row.cellCount; i++) {
      const cell = row.getCell(i);
      vals.push(cellText(cell.value, cell.numFmt));
    }
    if (vals.some((v) => v.trim())) out.push(vals);
  });
  return out;
}

/*
 * Reads the file, maps its header row to internal fields by name and alias, and returns the data rows. Columns no
 * field reads are returned per row in `extras` (kept with the student), except identity-number columns and the
 * columns the specification ignores, which are only listed.
 */
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
  const extraIndex: { header: string; i: number }[] = [];
  const seenExtra = new Set<string>();
  header.forEach((h, i) => {
    const key = headerKey(h);
    if (!key) return;
    const label = h.replace(BOM_RE, '').trim();
    const field = FIELD_BY_KEY.get(key);
    if (!field) {
      if (IGNORED_KEYS.has(key)) ignoredColumns.push(`${label} (not used in V1.0)`);
      else if (SENSITIVE_COLUMN_RE.test(label)) ignoredColumns.push(`${label} (identity number: not stored)`);
      else if (seenExtra.has(key)) ignoredColumns.push(`${label} (repeated column)`);
      else {
        seenExtra.add(key);
        extraIndex.push({ header: label, i });
        ignoredColumns.push(`${label} (kept as an other source value)`);
      }
      return;
    }
    if (field in indexOf) throw new ImportFileError(`Two columns map to the same field "${field}": "${mapping[field]}" and "${label}"`);
    mapping[field] = label;
    indexOf[field] = i;
  });

  const missing = IMPORT_COLUMNS.filter((c) => c.required && !(c.field in indexOf)).map((c) => c.label);
  for (const g of REQUIRED_COLUMN_GROUPS) if (!g.anyOf.some((fields) => fields.every((f) => f in indexOf))) missing.push(g.label);
  if (missing.length) throw new ImportFileError(`Required columns missing: ${missing.join(', ')}`);

  const rows = dataRows.map((r) => Object.fromEntries(Object.entries(indexOf).map(([f, i]) => [f, String(r[i] ?? '')])));
  const extras = dataRows.map((r) =>
    Object.fromEntries(extraIndex.map(({ header: h, i }) => [h, String(r[i] ?? '').trim()]).filter(([, v]) => v !== '')),
  );
  return { mapping, ignoredColumns, rows, extras };
}
