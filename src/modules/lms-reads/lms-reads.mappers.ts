import type { PaginationMeta } from '../../utils/api-response';

/*
 * LMS /tenant/v1 answers (snake_case wire names, docs/openapi/tenant-v1.json on lms-api) → the Panel's camelCase
 * shapes (docs/lms-reads/README.md). Mapping is tolerant: a missing field becomes null (or 0 for a count, [] for a
 * list), so an additive LMS change never breaks a screen. Where an existing Panel endpoint already names the same
 * fact, the same field name is used (the centre fields follow /lms/reference/centres: code, name, districtCode,
 * districtName, centreTypeName, isActive, sourceUpdatedAt).
 */

type Wire = Record<string, unknown>;

const obj = (v: unknown): Wire => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Wire) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const reqStr = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const numOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const strList = (v: unknown): string[] => arr(v).filter((x): x is string => typeof x === 'string');

export const toCamel = (k: string): string => k.replace(/_([a-z0-9])/g, (_m, c: string) => c.toUpperCase());

/* Deep snake_case → camelCase of the keys, for the summary's open-ended count objects. Values are kept as they are. */
export function camelizeKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(camelizeKeys);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v as Wire).map(([k, x]) => [toCamel(k), camelizeKeys(x)]));
  return v;
}

/* ------------------------------------------------------------------ paging */

export interface LmsPage {
  items: unknown[];
  page: number;
  pageSize: number;
  total: number;
}

export const readPage = (raw: unknown): LmsPage => {
  const r = obj(raw);
  return { items: arr(r.items), page: num(r.page) || 1, pageSize: num(r.page_size) || 1, total: num(r.total) };
};

/* LMS {page, page_size, total} → the Panel's pagination meta (page, limit, total, totalPages). */
export const toMeta = (p: Pick<LmsPage, 'page' | 'pageSize' | 'total'>): PaginationMeta => ({
  page: p.page,
  limit: p.pageSize,
  total: p.total,
  totalPages: Math.max(1, Math.ceil(p.total / Math.max(1, p.pageSize))),
});

/* ------------------------------------------------------------------ summary */

export interface LmsSummary {
  tenant: { code: string; name: string } | null;
  entity: { code: string; name: string } | null;
  entities: { code: string; name: string }[];
  generatedAt: string | null;
  learners: Record<string, unknown>;
  batches: Record<string, unknown>;
  centresActive: number;
  trainersActive: number;
  attendance: { sessionsScheduled: number; recordsMarked: number; attended: number; attendancePercent: number | null };
  outcomes: Record<string, unknown>;
  byCentre: Record<string, unknown>[];
  byTrack: Record<string, unknown>[];
  byBatch: Record<string, unknown>[];
}

const codeName = (v: unknown, codeKey: string): { code: string; name: string } | null => {
  const o = obj(v);
  const code = str(o[codeKey]) ?? str(o.code);
  return code === null ? null : { code, name: reqStr(o.name) };
};

const rows = (v: unknown) => arr(v).map((x) => camelizeKeys(obj(x)) as Record<string, unknown>);

export function mapSummary(raw: unknown): LmsSummary {
  const r = obj(raw);
  const a = obj(r.attendance);
  return {
    tenant: codeName(r.tenant, 'tenant_code'),
    entity: codeName(r.entity, 'entity_code'),
    entities: arr(r.entities)
      .map((e) => codeName(e, 'entity_code'))
      .filter((e): e is { code: string; name: string } => e !== null),
    generatedAt: str(r.generated_at),
    learners: camelizeKeys(obj(r.learners)) as Record<string, unknown>,
    batches: camelizeKeys(obj(r.batches)) as Record<string, unknown>,
    centresActive: num(r.centres_active),
    trainersActive: num(r.trainers_active),
    attendance: {
      sessionsScheduled: num(a.sessions_scheduled),
      recordsMarked: num(a.records_marked),
      attended: num(a.attended),
      attendancePercent: numOrNull(a.attendance_percent),
    },
    outcomes: camelizeKeys(obj(r.outcomes)) as Record<string, unknown>,
    byCentre: rows(r.by_centre),
    byTrack: rows(r.by_track),
    byBatch: rows(r.by_batch),
  };
}

/* ------------------------------------------------------------------ centres */

export interface LmsCentre {
  code: string;
  name: string;
  districtCode: string | null;
  districtName: string | null;
  centreTypeName: string | null;
  status: string;
  isActive: boolean;
  sourceUpdatedAt: string | null;
}

export function mapCentre(raw: unknown): LmsCentre {
  const r = obj(raw);
  const status = reqStr(r.status);
  return {
    code: reqStr(r.centre_code),
    name: reqStr(r.name),
    districtCode: str(r.district_code),
    districtName: str(r.district_name),
    centreTypeName: str(r.centre_type),
    status,
    isActive: status.toUpperCase() === 'ACTIVE',
    sourceUpdatedAt: str(r.updated_at),
  };
}

/* ------------------------------------------------------------------ batches */

export interface LmsBatch {
  id: string;
  code: string;
  entityCode: string;
  courseCode: string;
  centreCode: string;
  centreName: string;
  trackCode: string | null;
  startDate: string | null;
  endDate: string | null;
  deliveryMode: string | null;
  status: string;
  capacity: number | null;
  learnersEnrolled: number;
  learnersActive: number;
  learnersCompleted: number;
  learnersWithdrawn: number;
  updatedAt: string | null;
}

export function mapBatch(raw: unknown): LmsBatch {
  const r = obj(raw);
  return {
    id: reqStr(r.batch_id),
    code: reqStr(r.batch_code),
    entityCode: reqStr(r.entity_code),
    courseCode: reqStr(r.course_code),
    centreCode: reqStr(r.centre_code),
    centreName: reqStr(r.centre_name),
    trackCode: str(r.track_code),
    startDate: str(r.start_date),
    endDate: str(r.end_date),
    deliveryMode: str(r.delivery_mode),
    status: reqStr(r.status),
    capacity: numOrNull(r.capacity),
    learnersEnrolled: num(r.learners_enrolled),
    learnersActive: num(r.learners_active),
    learnersCompleted: num(r.learners_completed),
    learnersWithdrawn: num(r.learners_withdrawn),
    updatedAt: str(r.updated_at),
  };
}

/* ------------------------------------------------------------------ class sessions */

export interface LmsSession {
  id: string;
  batchCode: string;
  centreCode: string;
  entityCode: string;
  title: string | null;
  moduleNo: number | null;
  startsAt: string | null;
  endsAt: string | null;
  deliveryMode: string | null;
  attendanceMode: string | null;
  status: string;
  trainerCode: string | null;
  attendance: { present: number; late: number; absent: number; excused: number };
  updatedAt: string | null;
}

export function mapSession(raw: unknown): LmsSession {
  const r = obj(raw);
  return {
    id: reqStr(r.session_id),
    batchCode: reqStr(r.batch_code),
    centreCode: reqStr(r.centre_code),
    entityCode: reqStr(r.entity_code),
    title: str(r.title),
    moduleNo: numOrNull(r.module_no),
    startsAt: str(r.starts_at),
    endsAt: str(r.ends_at),
    deliveryMode: str(r.delivery_mode),
    attendanceMode: str(r.attendance_mode),
    status: reqStr(r.status),
    trainerCode: str(r.trainer_code),
    attendance: {
      present: num(r.attendance_present),
      late: num(r.attendance_late),
      absent: num(r.attendance_absent),
      excused: num(r.attendance_excused),
    },
    updatedAt: str(r.updated_at),
  };
}

/* ------------------------------------------------------------------ live sessions (API-110) */

export interface LmsLiveSession {
  id: string;
  batchCode: string;
  centreCode: string;
  deliveryMode: string | null;
  trainerCode: string | null;
  trainerName: string | null;
  topic: string | null;
  startsAt: string | null;
  endsAt: string | null;
  status: string;
  inProgress: boolean;
  enrolled: number;
  present: number;
  late: number;
}

export interface LmsLiveSessions {
  asOf: string | null;
  date: string | null;
  items: LmsLiveSession[];
}

export function mapLiveSession(raw: unknown): LmsLiveSession {
  const r = obj(raw);
  return {
    id: reqStr(r.session_id),
    batchCode: reqStr(r.batch_code),
    centreCode: reqStr(r.centre_code),
    deliveryMode: str(r.delivery_mode),
    trainerCode: str(r.trainer_code),
    trainerName: str(r.trainer_name),
    topic: str(r.topic),
    startsAt: str(r.starts_at),
    endsAt: str(r.ends_at),
    status: reqStr(r.status),
    inProgress: r.in_progress === true,
    enrolled: num(r.enrolled),
    present: num(r.present),
    late: num(r.late),
  };
}

export function mapLiveSessions(raw: unknown): LmsLiveSessions {
  const r = obj(raw);
  return { asOf: str(r.as_of), date: str(r.date), items: arr(r.items).map(mapLiveSession) };
}

/* ------------------------------------------------------------------ trainers */

export interface LmsTrainer {
  id: string;
  code: string;
  displayName: string;
  status: string;
  entityCode: string;
  centreCodes: string[];
  batchCodes: string[];
  updatedAt: string | null;
}

export function mapTrainer(raw: unknown): LmsTrainer {
  const r = obj(raw);
  return {
    id: reqStr(r.trainer_id),
    code: reqStr(r.trainer_code),
    displayName: reqStr(r.display_name),
    status: reqStr(r.status),
    entityCode: reqStr(r.entity_code),
    centreCodes: strList(r.centre_codes),
    batchCodes: strList(r.batch_codes),
    updatedAt: str(r.updated_at),
  };
}

/* ------------------------------------------------------------------ attendance */

export interface LmsAttendanceRow {
  code: string;
  batches: number;
  sessionsHeld: number;
  present: number;
  late: number;
  absent: number;
  excused: number;
  selfCheckIns: number;
  geoCheckIns: number;
  selfies: number;
  groupPhotos: number;
}

export interface LmsAttendance {
  groupBy: string;
  dateFrom: string | null;
  dateTo: string | null;
  items: LmsAttendanceRow[];
}

export function mapAttendance(raw: unknown): LmsAttendance {
  const r = obj(raw);
  return {
    groupBy: reqStr(r.group_by),
    dateFrom: str(r.date_from),
    dateTo: str(r.date_to),
    items: arr(r.items).map((x) => {
      const i = obj(x);
      return {
        code: reqStr(i.code),
        batches: num(i.batches),
        sessionsHeld: num(i.sessions_held),
        present: num(i.present),
        late: num(i.late),
        absent: num(i.absent),
        excused: num(i.excused),
        selfCheckIns: num(i.self_check_ins),
        geoCheckIns: num(i.geo_check_ins),
        selfies: num(i.selfies),
        groupPhotos: num(i.group_photos),
      };
    }),
  };
}
