import { AppDataSource } from '../../../config/database.config';
import { env } from '../../../config/env.config';
import { MESSAGES } from '../../../constants/api-response.constants';
import { CENTRES, DOCUMENTS, IMPORT_COLUMNS, STUDENT_SOURCE, STUDENT_STATUS, TRACKS } from '../student.constants';
import { Student } from './student.entity';
import { AppError } from '../../../shared/errors/app-error';
import { decryptAadhaar, maskAadhaar, maskEmail, maskMobile } from '../aadhaar';
import { templateCsv } from './import-template';
import { NO_TRACK, type BucketCounts, type StudentBatchRef, type StudentBucket, type StudentSummary } from './student.types';

const trackName = (code: string | null) => TRACKS.find((t) => t.code === code)?.name ?? null;
const builtInCentreName = (code: string | null) => CENTRES.find((c) => c.code === code)?.name ?? null;

/*
 * Course centres are the rows of the Regions master (the list the import, the registration form and the summary
 * read). A centre added there is not in the built-in CENTRES list, so its name comes from the master; the built-in
 * list stays the fallback for a code the master does not hold. Retired rows keep their name for history.
 */
export async function centreNames(codes: (string | null)[]): Promise<Map<string, string>> {
  const wanted = [...new Set(codes.filter((c): c is string => !!c))];
  if (!wanted.length) return new Map();
  const rows: { code: string; name: string }[] = await AppDataSource.query(
    `SELECT "code", "name" FROM "regions" WHERE "code" = ANY($1::text[]) AND NOT "isDelete"`,
    [wanted],
  );
  return new Map(rows.map((r) => [r.code, r.name]));
}
/* Summary labels for a null track and a null caste / education reference. */
const TRACK_TBC_NAME = 'To be confirmed';
const NOT_RECORDED = 'Not recorded';

/*
 * Full contact details for reviewers (registrations.update): email, mobile and the decrypted Aadhaar grouped in fours.
 * Callers record an audit entry whenever they return these.
 */
export function unmaskedContact(s: Student) {
  const digits = s.aadhaarEnc ? decryptAadhaar(s.aadhaarEnc) : null;
  return { email: s.email, mobile: s.mobile, aadhaar: digits ? digits.replace(/(\d{4})(?=\d)/g, '$1 ') : null };
}

/* Register view of a student: protected values are generated masked on the server and never sent in clear. */
export function publicStudent(s: Student, detail = false, names?: Map<string, string>) {
  const base = {
    id: s.id,
    code: s.code,
    sourceRecordId: s.sourceRecordId,
    name: `${s.firstName} ${s.lastName}`,
    centreCode: s.centreCode,
    centreName: (s.centreCode ? names?.get(s.centreCode) : undefined) ?? builtInCentreName(s.centreCode),
    trackCode: s.trackCode,
    trackName: trackName(s.trackCode),
    trackToBeConfirmed: !s.trackCode,
    caste: s.caste,
    educationQualification: s.educationQualification,
    status: s.status,
    mobile: maskMobile(s.mobile),
    email: maskEmail(s.email),
    aadhaar: maskAadhaar(s.aadhaarLast4),
    approvedAt: s.approvedAt,
    importBatchId: s.importBatchId,
    /* IMPORT or PUBLIC_REGISTRATION (one students table), and the registration number of registrations. */
    source: s.source,
    registrationNumber: s.registrationNumber,
    createdAt: s.createdAt,
  };
  if (!detail) return base;
  return {
    ...base,
    firstName: s.firstName,
    lastName: s.lastName,
    fatherName: s.fatherName,
    motherName: s.motherName,
    dateOfBirth: s.dateOfBirth,
    religion: s.religion,
    trackSourceValue: s.trackSourceValue,
    externalStatus: s.externalStatus,
    evidenceRef: s.evidenceRef,
    declarationAccepted: s.declarationAccepted,
    /* Profile (imported or entered on the EDP portal); alternate contacts masked like the primary ones. */
    gender: s.gender,
    maritalStatus: s.maritalStatus,
    permanentAddress: s.permanentAddress,
    landmark: s.landmark,
    districtId: s.districtId,
    districtName: s.districtName,
    talukaId: s.talukaId,
    talukaName: s.talukaName,
    division: s.division,
    pinCode: s.pinCode,
    alternateMobile: maskMobile(s.alternateMobile),
    alternateEmail: maskEmail(s.alternateEmail),
    disabilityStatus: s.disabilityStatus,
    disabilityType: s.disabilityType,
    disabilityCertificateNumber: s.disabilityCertificateNumber,
    qualificationName: s.qualificationName,
    qualificationStream: s.qualificationStream,
    qualificationBoard: s.qualificationBoard,
    qualificationCompletedOn: s.qualificationCompletedOn,
    gradingType: s.gradingType,
    cgpaScale: s.cgpaScale,
    score: s.score,
    qualificationClass: s.qualificationClass,
    /* The source's own record details and its other columns, as supplied. */
    schemeName: s.schemeName,
    sourceSubmittedAt: s.sourceSubmittedAt,
    sourceUpdatedAt: s.sourceUpdatedAt,
    sourceRemarks: s.sourceRemarks,
    sourceExtra: s.sourceExtra ?? {},
    documents: DOCUMENTS.map((d) => ({
      key: d.key,
      label: d.label,
      required: d.required,
      ...(s.documents[d.key] ?? { supplied: false, barcode: null }),
    })),
  };
}

export class StudentService {
  private repo() {
    return AppDataSource.getRepository(Student);
  }

  /*
   * With `unmask` (reviewers), each row also carries unmaskedContact(); the controller audits that list.
   * Each row also carries its live batch (active, non-deleted assignment) and `enrolled` (eligible with that batch).
   */
  async list(
    q: {
      page: number;
      limit: number;
      search?: string;
      centre?: string;
      track?: string;
      batch?: string;
      source?: string;
      bucket?: StudentBucket;
      casteId?: string;
      educationId?: string;
      regionId?: string;
    },
    unmask = false,
  ) {
    const qb = this.repo().createQueryBuilder('s').where('s.isDelete = false');
    if (q.centre) qb.andWhere('s.centreCode = :centre', { centre: q.centre });
    if (q.track === NO_TRACK || q.track === 'TBC') qb.andWhere('s.trackCode IS NULL');
    else if (q.track) qb.andWhere('s.trackCode = :track', { track: q.track });
    if (q.batch) qb.andWhere('s.importBatchId = :batch', { batch: q.batch });
    if (q.source) qb.andWhere('s.source = :source', { source: q.source });
    if (q.casteId) qb.andWhere('s.casteId = :casteId', { casteId: q.casteId });
    if (q.educationId) qb.andWhere('s.educationId = :educationId', { educationId: q.educationId });
    if (q.regionId) qb.andWhere('s.regionId = :regionId', { regionId: q.regionId });
    const eligible = '(s.status = :received AND s.isActive = true)';
    const live = `EXISTS (SELECT 1 FROM "batch_assignments" ba WHERE ba."studentId" = s.id AND ba."isActive" AND NOT ba."isDelete")`;
    if (q.bucket === 'pending') qb.andWhere('s.status = :pending', { pending: STUDENT_STATUS.REGISTRATION_PENDING });
    else if (q.bucket === 'eligible') qb.andWhere(eligible, { received: STUDENT_STATUS.RECEIVED });
    else if (q.bucket === 'enrolled') qb.andWhere(`${eligible} AND ${live}`, { received: STUDENT_STATUS.RECEIVED });
    else if (q.bucket === 'awaiting') qb.andWhere(`${eligible} AND NOT ${live}`, { received: STUDENT_STATUS.RECEIVED });
    if (q.search) {
      const t = q.search.trim();
      const s = `%${t.replace(/[%_\\]/g, '\\$&')}%`;
      /* Mobile is searchable by its last four digits only. */
      qb.andWhere(
        `(s.code ILIKE :s OR s.registrationNumber LIKE :s OR s.sourceRecordId ILIKE :s OR (s.firstName || ' ' || s.lastName) ILIKE :s OR s.email ILIKE :s ${/^\d{4}$/.test(t) ? 'OR right(s.mobile, 4) = :last4' : ''})`,
        { s, last4: t },
      );
    }
    const [items, total] = await qb
      .orderBy('s.createdAt', 'DESC')
      .addOrderBy('s.code', 'DESC')
      .skip((q.page - 1) * q.limit)
      .take(q.limit)
      .getManyAndCount();
    const [batches, names] = await Promise.all([this.liveBatches(items.map((s) => s.id)), centreNames(items.map((s) => s.centreCode))]);
    return {
      items: items.map((s) => {
        const batch = batches.get(s.id) ?? null;
        return {
          ...publicStudent(s, false, names),
          enrolled: batch !== null && s.status === STUDENT_STATUS.RECEIVED && s.isActive,
          batch,
          ...(unmask ? { unmasked: unmaskedContact(s) } : {}),
        };
      }),
      total,
      codes: items.map((s) => s.code),
    };
  }

  /* studentId → the batch of its live assignment (at most one per student). */
  private async liveBatches(ids: string[]): Promise<Map<string, StudentBatchRef>> {
    if (!ids.length) return new Map();
    const rows: (StudentBatchRef & { studentId: string })[] = await AppDataSource.query(
      `SELECT ba."studentId", b."id", b."code", b."name"
       FROM "batch_assignments" ba JOIN "batches" b ON b."id" = ba."batchId"
       WHERE ba."studentId" = ANY($1::uuid[]) AND ba."isActive" AND NOT ba."isDelete"`,
      [ids],
    );
    return new Map(rows.map((r) => [r.studentId, { id: r.id, code: r.code, name: r.name }]));
  }

  /*
   * Dashboard counts (no personal data), computed with GROUP BY in the database. `centre` narrows every figure to
   * one district; byCentre still lists every active region (the others then show zeros).
   */
  async summary(q: { centre?: string } = {}): Promise<StudentSummary> {
    const asOf = new Date().toISOString();
    const params: unknown[] = [];
    const where = ['NOT s."isDelete"'];
    if (q.centre) {
      params.push(q.centre);
      where.push(`s."centreCode" = $${params.length}`);
    }
    const received = `'${STUDENT_STATUS.RECEIVED}'`;
    /* One row per non-deleted student with its bucket flags and live assignment date. */
    const st = `WITH st AS (
      SELECT s."id", s."status", s."isActive", s."source", s."centreCode", s."trackCode", s."casteId", s."educationId",
        coalesce(s."approvedAt", s."createdAt") AS "monthAt",
        (s."status" = ${received} AND s."isActive") AS "eligible",
        (s."status" = ${received} AND s."isActive" AND ba."assignedAt" IS NOT NULL) AS "enrolled",
        ba."assignedAt"
      FROM "students" s
      LEFT JOIN LATERAL (
        SELECT a."assignedAt" FROM "batch_assignments" a
        WHERE a."studentId" = s."id" AND a."isActive" AND NOT a."isDelete"
        ORDER BY a."assignedAt" DESC LIMIT 1
      ) ba ON true
      WHERE ${where.join(' AND ')}
    )`;
    const buckets = `count(st."id")::int AS "applications", count(*) FILTER (WHERE st."eligible")::int AS "eligible",
      count(*) FILTER (WHERE st."enrolled")::int AS "enrolled"`;
    const byMaster = (table: 'castes' | 'educations', column: 'casteId' | 'educationId') =>
      AppDataSource.query(
        `${st} SELECT st."${column}" AS "id", m."name", count(*)::int AS "count"
         FROM st LEFT JOIN "${table}" m ON m."id" = st."${column}"
         GROUP BY st."${column}", m."name" ORDER BY "count" DESC, m."name" NULLS LAST`,
        params,
      ) as Promise<{ id: string | null; name: string | null; count: number }[]>;
    const tz = params.length + 1;
    const local = (col: string) => `to_char(timezone($${tz}::text, ${col}), 'YYYY-MM')`;
    const thisMonth = `date_trunc('month', timezone($${tz}::text, now()))`;

    const [[totals], sources, centres, tracks, castes, educations, months] = await Promise.all([
      AppDataSource.query(
        `${st} SELECT ${buckets},
           count(*) FILTER (WHERE st."status" = '${STUDENT_STATUS.REGISTRATION_PENDING}')::int AS "pending",
           count(*) FILTER (WHERE NOT st."isActive")::int AS "inactive"
         FROM st`,
        params,
      ) as Promise<{ applications: number; eligible: number; enrolled: number; pending: number; inactive: number }[]>,
      AppDataSource.query(`${st} SELECT st."source", count(*)::int AS "count" FROM st GROUP BY st."source"`, params) as Promise<
        { source: string; count: number }[]
      >,
      AppDataSource.query(
        `${st} SELECT r."code", r."name", ${buckets}
         FROM "regions" r LEFT JOIN st ON st."centreCode" = r."code"
         WHERE r."isActive" AND NOT r."isDelete"
         GROUP BY r."id", r."code", r."name" ORDER BY r."name", r."code"`,
        params,
      ) as Promise<StudentSummary['byCentre']>,
      AppDataSource.query(`${st} SELECT st."trackCode" AS "code", ${buckets} FROM st GROUP BY st."trackCode"`, params) as Promise<
        (BucketCounts & { code: string | null })[]
      >,
      byMaster('castes', 'casteId'),
      byMaster('educations', 'educationId'),
      AppDataSource.query(
        `${st},
         months AS (
           SELECT to_char(m, 'YYYY-MM') AS "month"
           FROM generate_series(${thisMonth} - interval '11 months', ${thisMonth}, interval '1 month') AS m
         ),
         apps AS (SELECT ${local('st."monthAt"')} AS "month", count(*)::int AS "n" FROM st GROUP BY 1),
         enr AS (SELECT ${local('st."assignedAt"')} AS "month", count(*)::int AS "n" FROM st WHERE st."enrolled" GROUP BY 1)
         SELECT "month", coalesce(apps."n", 0)::int AS "applications", coalesce(enr."n", 0)::int AS "enrolled"
         FROM months LEFT JOIN apps USING ("month") LEFT JOIN enr USING ("month") ORDER BY "month"`,
        [...params, env.APP_TIMEZONE],
      ) as Promise<StudentSummary['byMonth']>,
    ]);

    const zero: BucketCounts = { applications: 0, eligible: 0, enrolled: 0 };
    const trackRow = (code: string | null) => {
      const { applications, eligible, enrolled } = tracks.find((t) => t.code === code) ?? zero;
      return { applications, eligible, enrolled };
    };
    const knownTracks = new Set(TRACKS.map((t) => t.code));
    const knownSources: string[] = Object.values(STUDENT_SOURCE);
    const label = (name: string | null) => name ?? NOT_RECORDED;
    return {
      asOf,
      totals: { ...totals, awaitingBatch: totals.eligible - totals.enrolled },
      bySource: [
        ...knownSources.map((source) => ({ source, count: sources.find((r) => r.source === source)?.count ?? 0 })),
        ...sources.filter((r) => !knownSources.includes(r.source)),
      ],
      byCentre: centres,
      byTrack: [
        ...TRACKS.map((t) => ({ code: t.code, name: t.name, ...trackRow(t.code) })),
        /* A code outside the approved list (should not happen) is still counted, under its own code. */
        ...tracks
          .filter((t) => t.code !== null && !knownTracks.has(t.code))
          .map((t) => ({ code: t.code, name: t.code!, ...trackRow(t.code) })),
        { code: null, name: TRACK_TBC_NAME, ...trackRow(null) },
      ],
      byCaste: castes.map((r) => ({ ...r, name: label(r.name) })),
      byEducation: educations.map((r) => ({ ...r, name: label(r.name) })),
      byMonth: months,
    };
  }

  async get(id: string) {
    const s = await this.repo().findOne({ where: { id, isDelete: false } });
    if (!s) throw AppError.notFound(MESSAGES.notFound('Student'));
    /* The live batch, and `enrolled`, exactly as each list row carries them. */
    const batch = (await this.liveBatches([s.id])).get(s.id) ?? null;
    return { ...publicStudent(s, true, await centreNames([s.centreCode])), enrolled: batch !== null && s.status === STUDENT_STATUS.RECEIVED && s.isActive, batch };
  }

  /* Templates: see import-template.ts (CSV, Excel with instructions, matching sample documents ZIP). */
  template(): string {
    return templateCsv();
  }

  reference() {
    return {
      columns: IMPORT_COLUMNS.map((c) => ({
        field: c.field,
        label: c.label,
        required: c.required,
        alternative: c.alternative ?? null,
        aliases: c.aliases,
      })),
      tracks: TRACKS.map(({ code, name, aliases }) => ({ code, name, aliases })),
      centres: CENTRES,
    };
  }
}

export const studentService = new StudentService();
