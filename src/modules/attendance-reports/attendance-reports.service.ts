import { lmsReadsService, type LmsAttendance, type LmsBatch, type LmsReadResult, type LmsReadsStatus } from '../lms-reads';
import { buildReport, type BuiltReport, type ReportMasters } from './attendance-report.builder';
import { BATCH_MAX_PAGES, BATCH_PAGE_SIZE } from './attendance-reports.constants';
import { loadReportMasters } from './attendance-reports.masters';
import type { AttendanceReportQuery } from './attendance-reports.validation';

/*
 * M3 attendance reports. One LMS read (GET /tenant/v1/attendance, through the M1 read client and its short cache,
 * LMS_READS_CACHE_SECONDS) per report, plus the LMS batch list at batch level; the codes are named from Amrut's own
 * masters. Nothing is stored. The M1 client's switches and errors apply unchanged: 404 LMS_READS_DISABLED while the
 * reads are off, 503 LMS_NOT_CONFIGURED without the LMS link, 503 LMS_TIMEOUT / LMS_UNREACHABLE / LMS_UNAVAILABLE /
 * LMS_KEY_REJECTED … when the LMS cannot be used. The key never leaves the server.
 */
export interface AttendanceReport extends BuiltReport {
  dateFrom: string | null;
  dateTo: string | null;
}

export interface AttendanceReportResult {
  data: AttendanceReport;
  fetchedAt: Date;
  cache: LmsReadResult<unknown>['cache'];
}

export interface AttendanceReportsDeps {
  status(): LmsReadsStatus;
  attendance(q: {
    groupBy: 'district' | 'division' | 'centre' | 'batch';
    dateFrom?: string;
    dateTo?: string;
    entityCode?: string;
  }): Promise<LmsReadResult<LmsAttendance>>;
  batches(q: { page: number; limit: number; entityCode?: string }): Promise<LmsReadResult<LmsBatch[]>>;
  masters(): Promise<ReportMasters>;
}

const defaultDeps: AttendanceReportsDeps = {
  status: () => lmsReadsService.status(),
  attendance: (q) => lmsReadsService.attendance(q),
  batches: (q) => lmsReadsService.batches(q),
  masters: loadReportMasters,
};

export class AttendanceReportsService {
  constructor(private readonly deps: AttendanceReportsDeps = defaultDeps) {}

  /* Whether reports can be read now (never calls the LMS, never returns the key or URL). */
  status(): LmsReadsStatus {
    return this.deps.status();
  }

  /* LMS batch code → centre code, over the LMS's batch pages (bounded by BATCH_MAX_PAGES). */
  private async batchCentres(entityCode?: string): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    for (let page = 1; page <= BATCH_MAX_PAGES; page += 1) {
      const r = await this.deps.batches({ page, limit: BATCH_PAGE_SIZE, entityCode });
      for (const b of r.data) if (b.code && b.centreCode) map.set(b.code, b.centreCode);
      const total = r.meta?.total ?? 0;
      if (r.data.length === 0 || page * BATCH_PAGE_SIZE >= total) break;
    }
    return map;
  }

  async report(q: AttendanceReportQuery): Promise<AttendanceReportResult> {
    /* The LMS read first: it carries the switch and configuration checks, so a refused report reads no master. */
    const lms = await this.deps.attendance({ groupBy: q.level, dateFrom: q.dateFrom, dateTo: q.dateTo, entityCode: q.entityCode });
    const [masters, batchCentres] = await Promise.all([
      this.deps.masters(),
      q.level === 'batch' ? this.batchCentres(q.entityCode) : Promise.resolve(undefined),
    ]);
    const built = buildReport({
      level: q.level,
      filters: { division: q.division, district: q.district, centre: q.centre },
      lmsRows: lms.data.items,
      masters,
      batchCentres,
    });
    return { data: { ...built, dateFrom: lms.data.dateFrom, dateTo: lms.data.dateTo }, fetchedAt: lms.fetchedAt, cache: lms.cache };
  }
}

export const attendanceReportsService = new AttendanceReportsService();
