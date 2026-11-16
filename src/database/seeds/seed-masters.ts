import type { DataSource } from 'typeorm';
import { CASTE_LIST, CENTRES, DOCUMENTS } from '../../modules/students/student.constants';

/*
 * Reference data for the four masters. Idempotent: a row is inserted only when its code and name are both unused
 * (ON CONFLICT DO NOTHING), so existing, edited, deactivated or soft-deleted records are never changed or revived.
 * Regions, castes and document types repeat the lists the Masters migration inserted, for databases created another way.
 */

/*
 * Starter education list: an assumption, not a confirmed specification list (OQ-007 is still open).
 * Edit, deactivate or add entries in Admin > Masters > Education.
 */
const EDUCATIONS: [string, string][] = [
  ['SSC', 'SSC (10th)'],
  ['HSC', 'HSC (12th)'],
  ['ITI', 'ITI'],
  ['DIPLOMA', 'Diploma'],
  ['BA', 'B.A.'],
  ['BCOM', 'B.Com'],
  ['BSC', 'B.Sc'],
  ['BCA', 'BCA'],
  ['BBA', 'BBA'],
  ['BE_BTECH', 'B.E. / B.Tech'],
  ['GRAD_OTHER', 'Other Graduate'],
  ['MA', 'M.A.'],
  ['MCOM', 'M.Com'],
  ['MSC', 'M.Sc'],
  ['MCA', 'MCA'],
  ['MBA', 'MBA'],
  ['ME_MTECH', 'M.E. / M.Tech'],
  ['PG_OTHER', 'Other Post Graduate'],
];

/* Short names shown with some document types. */
const DOCUMENT_DESCRIPTIONS: Record<string, string> = {
  AADHAAR_CARD: 'Aadhaar',
  PAN_CARD: 'PAN',
  SCHOOL_LEAVING: 'LC (Leaving Certificate)',
};

async function insert(ds: DataSource, table: string, rows: Record<string, unknown>[]): Promise<number> {
  let added = 0;
  for (const row of rows) {
    const cols = Object.keys(row);
    const result = await ds.query(
      `INSERT INTO "${table}" (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})
       ON CONFLICT DO NOTHING RETURNING "id"`,
      Object.values(row),
    );
    added += result.length;
  }
  return added;
}

export async function seedMasters(ds: DataSource): Promise<Record<string, number>> {
  return {
    regions: await insert(
      ds,
      'regions',
      CENTRES.map((c) => ({ code: c.code, name: c.name })),
    ),
    /*
     * The official list, in order (CasteOfficialList migration). On a migrated database every code or name is already
     * taken, so nothing is inserted; on one created another way, codes C01–C26 follow the official order.
     */
    castes: await insert(
      ds,
      'castes',
      CASTE_LIST.map((c, i) => ({
        code: 'C' + String(i + 1).padStart(2, '0'),
        name: c.name.normalize('NFC'),
        nameEn: c.nameEn,
        displayOrder: i + 1,
      })),
    ),
    documentTypes: await insert(
      ds,
      'document_types',
      DOCUMENTS.map((d) => ({ code: d.key, name: d.label, isMandatory: d.required, description: DOCUMENT_DESCRIPTIONS[d.key] ?? null })),
    ),
    educations: await insert(
      ds,
      'educations',
      EDUCATIONS.map(([code, name]) => ({ code, name })),
    ),
  };
}
