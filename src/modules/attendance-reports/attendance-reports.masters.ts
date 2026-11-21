import { AppDataSource } from '../../config/database.config';
import type { MasterCentre, MasterDistrict, ReportMasters } from './attendance-report.builder';

/*
 * Amrut's own names for the LMS's codes: the District Master (CMS geography) and the Training Centre master.
 * Read-only, non-deleted rows (inactive ones too: past attendance may belong to a centre closed since).
 */
export async function loadReportMasters(): Promise<ReportMasters> {
  const [districts, centres] = await Promise.all([
    AppDataSource.query<MasterDistrict[]>(
      `SELECT d."code", d."name" FROM "districts" d WHERE d."isDelete" = false ORDER BY d."isActive" DESC, d."name"`,
    ),
    AppDataSource.query<MasterCentre[]>(
      `SELECT tc."code", tc."name", d."code" AS "districtCode"
         FROM "training_centres" tc
         JOIN "districts" d ON d."id" = tc."districtId"
        WHERE tc."isDelete" = false
        ORDER BY tc."isActive" DESC, tc."name"`,
    ),
  ]);
  return { districts, centres };
}
