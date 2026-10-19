import crypto from 'crypto';
import type { Request } from 'express';
import { In, type EntityManager } from 'typeorm';
import { AppDataSource } from '../../../config/database.config';
import { env } from '../../../config/env.config';
import { BATCH_STATUS, ISSUE_CODES, ROW_STATUS, type IssueCode } from '../student.constants';
import { ImportBatch, type ImportBatchCounts } from './import-batch.entity';
import { ImportRow, type StoredIssue } from './import-row.entity';
import { Student } from '../register/student.entity';
import type { AuthUser } from '../../auth';
import { AppError } from '../../../shared/errors/app-error';
import { maskAadhaar, maskEmail, maskMobile } from '../aadhaar';
import { auditService } from '../../audit';
import { ImportFileError, parseImportFile } from './file-parser';
import { rowChecksum, validateRow, type NormalisedRow } from './row-validator';

export type MatchDecision = 'SAME_PERSON' | 'DIFFERENT_PERSON' | 'HOLD';

const editable = (b: ImportBatch) => b.status === BATCH_STATUS.VALIDATED_WITH_EXCEPTIONS || b.status === BATCH_STATUS.READY_TO_FINALISE;

/* Row data kept in jsonb: the normalised row without the protected Aadhaar fields. */
function rowData(r: NormalisedRow): Record<string, unknown> {
  const { aadhaarEnc: _e, aadhaarBidx: _b, aadhaarLast4: _l, ...rest } = r;
  return rest;
}

/* Masked view of a row for the preview grid (protected values are masked for every role). */
export function publicRow(r: ImportRow) {
  const d = r.data as Partial<NormalisedRow>;
  return {
    id: r.id, rowNumber: r.rowNumber, status: r.status, sourceRecordId: r.sourceRecordId,
    name: [d.firstName, d.lastName].filter(Boolean).join(' '),
    fatherName: d.fatherName, motherName: d.motherName,
    email: maskEmail(d.email ?? null), mobile: maskMobile(d.mobile ?? null), aadhaar: maskAadhaar(r.aadhaarLast4),
    dateOfBirth: d.dateOfBirth, religion: d.religion, caste: d.caste, centreCode: d.centreCode,
    trackCode: d.trackCode, trackSourceValue: d.trackSourceValue, educationQualification: d.educationQualification,
    approvalStatus: d.approvalStatus, approvedAt: d.approvedAt, evidenceRef: d.evidenceRef, documents: d.documents,
    issues: r.issues,
    match: r.matchTier ? { tier: r.matchTier, studentId: r.matchStudentId, rowNumber: r.matchRowNumber, note: r.matchNote } : null,
    decision: r.decision, decisionReason: r.decisionReason, decidedAt: r.decidedAt, rejectReason: r.rejectReason, studentId: r.studentId,
  };
}

export class ImportService {
  private batches(m?: EntityManager) { return (m ?? AppDataSource.manager).getRepository(ImportBatch); }
  private rows(m?: EntityManager) { return (m ?? AppDataSource.manager).getRepository(ImportRow); }

  async getBatch(id: string, m?: EntityManager): Promise<ImportBatch> {
    const b = await this.batches(m).findOne({ where: { id, isDelete: false } });
    if (!b) throw AppError.notFound('Import batch not found');
    return b;
  }

  /* A-11: one batch per distinct file. Re-uploading the same file returns the existing batch. */
  async createFromFile(file: { buffer: Buffer; originalname: string; size: number }, sourceReference: string | null, actor: AuthUser, req?: Request) {
    const fileChecksum = crypto.createHash('sha256').update(file.buffer).digest('hex');
    const existing = await this.batches().findOne({ where: { fileChecksum, isDelete: false } , order: { createdAt: 'DESC' } });
    if (existing && existing.status !== BATCH_STATUS.CANCELLED) return { batch: existing, duplicate: true };

    const seq = await AppDataSource.query(`SELECT nextval('import_batches_code_seq') AS n`);
    const batch = await this.batches().save(this.batches().create({
      code: 'IMP-' + String(seq[0].n).padStart(6, '0'),
      status: BATCH_STATUS.IMPORT_PENDING,
      fileName: file.originalname.slice(0, 255),
      fileChecksum, fileSize: file.size, sourceReference,
      createdById: actor.id,
      counts: { total: 0, valid: 0, exceptions: 0, duplicates: 0, skipped: 0, rejected: 0, reconciled: 0 },
    }));
    await auditService.record(req, { action: 'import.batch.created', resource: 'import_batch', resourceId: batch.id, details: { code: batch.code, fileName: batch.fileName, size: file.size } });

    let parsed;
    try {
      parsed = await parseImportFile(file.buffer, env.IMPORT_MAX_ROWS);
    } catch (e) {
      if (!(e instanceof ImportFileError)) throw e;
      batch.status = BATCH_STATUS.IMPORT_FAILED;
      batch.failureReason = e.message;
      await this.batches().save(batch);
      return { batch, duplicate: false };
    }

    batch.status = BATCH_STATUS.VALIDATING;
    batch.columnMapping = parsed.mapping;
    batch.ignoredColumns = parsed.ignoredColumns;
    await this.batches().save(batch);
    await this.validate(batch, parsed.rows);
    await auditService.record(req, { action: 'import.batch.validation_completed', resource: 'import_batch', resourceId: batch.id, details: { code: batch.code, counts: batch.counts } });
    return { batch: await this.getBatch(batch.id), duplicate: false };
  }

  /* A-14 + A-15: validate every row and detect duplicates, in the file and against the register. One failing row never blocks others. */
  private async validate(batch: ImportBatch, rawRows: Record<string, string>[]) {
    const results = rawRows.map((raw, i) => ({ rowNumber: i + 2, raw, checksum: rowChecksum(raw), ...validateRow(raw) }));

    /* Load only the register rows that could match. */
    const srcIds = [...new Set(results.map((r) => r.row.sourceRecordId).filter((x): x is string => !!x))];
    const bidxs = [...new Set(results.map((r) => r.row.aadhaarBidx).filter((x): x is string => !!x))];
    const dobs = [...new Set(results.map((r) => r.row.dateOfBirth).filter((x): x is string => !!x))];
    const mobiles = [...new Set(results.map((r) => r.row.mobile).filter((x): x is string => !!x))];
    const emails = [...new Set(results.map((r) => r.row.email).filter((x): x is string => !!x))];
    const students = AppDataSource.getRepository(Student);
    const chunk = <T>(a: T[]) => Array.from({ length: Math.ceil(a.length / 1000) }, (_, i) => a.slice(i * 1000, i * 1000 + 1000));
    const load = async (col: keyof Student, vals: string[]) =>
      (await Promise.all(chunk(vals).map((c) => students.find({ where: { [col]: In(c), isDelete: false } as never })))).flat();
    const [bySrc, byBidx, byDob, byMobile, byEmail] = await Promise.all([
      load('sourceRecordId', srcIds), load('aadhaarBidx', bidxs), load('dateOfBirth', dobs), load('mobile', mobiles), load('email', emails),
    ]);
    const nameKey = (s: Student) => `${s.firstName} ${s.lastName}`.toLowerCase().replace(/\s+/g, ' ').trim();

    const seenSrc = new Map<string, number>();
    const seenBidx = new Map<string, number>();
    const entities: ImportRow[] = [];

    for (const r of results) {
      const issues: StoredIssue[] = r.issues.map((i) => ({ ...i, status: 'OPEN' }));
      const addIssue = (field: string, code: IssueCode, message: string) => issues.push({ field, code, message, status: 'OPEN' });
      let status: string = ROW_STATUS.VALID;
      let matchStudentId: string | null = null; let matchRowNumber: number | null = null; let matchTier: string | null = null; let matchNote: string | null = null;
      const { row } = r;

      /* Duplicates inside this file. */
      const earlier = (row.sourceRecordId && seenSrc.get(row.sourceRecordId)) || (row.aadhaarBidx && seenBidx.get(row.aadhaarBidx));
      if (earlier) {
        addIssue(row.aadhaarBidx && seenBidx.get(row.aadhaarBidx) === earlier ? 'aadhaar_number' : 'source_record_id', 'DUPLICATE_IN_FILE', `Same person as row ${earlier} of this file`);
        matchRowNumber = earlier; matchTier = 'FILE';
      }
      if (row.sourceRecordId && !seenSrc.has(row.sourceRecordId)) seenSrc.set(row.sourceRecordId, r.rowNumber);
      if (row.aadhaarBidx && !seenBidx.has(row.aadhaarBidx)) seenBidx.set(row.aadhaarBidx, r.rowNumber);

      /* Tiered matching against the register (Tier 0 source ID · 1 Aadhaar · 2 name+DOB+contact · 3 contact only, flag). */
      if (!earlier) {
        const t0 = row.sourceRecordId ? bySrc.find((s) => s.sourceRecordId === row.sourceRecordId) : undefined;
        const t1 = row.aadhaarBidx ? byBidx.find((s) => s.aadhaarBidx === row.aadhaarBidx) : undefined;
        const t2 = row.dateOfBirth ? byDob.find((s) => s.dateOfBirth === row.dateOfBirth && nameKey(s) === row.nameKey
          && ((row.mobile && s.mobile === row.mobile) || (row.email && s.email === row.email))) : undefined;
        if (t0 && t0.sourceChecksum === r.checksum) {
          status = ROW_STATUS.SKIPPED_UNCHANGED; matchStudentId = t0.id; matchTier = 'T0'; matchNote = `Already imported as ${t0.code}; unchanged`;
        } else if (t0) {
          matchStudentId = t0.id; matchTier = 'T0'; matchNote = `Source record already imported as ${t0.code}; values differ`;
        } else if (t1) {
          const conflict = nameKey(t1) !== row.nameKey || t1.dateOfBirth !== row.dateOfBirth;
          matchStudentId = t1.id; matchTier = 'T1';
          matchNote = conflict ? `Same Aadhaar as ${t1.code} but different name or date of birth (CONFLICT)` : `Same Aadhaar as ${t1.code}`;
        } else if (t2) {
          matchStudentId = t2.id; matchTier = 'T2'; matchNote = `Same name, date of birth and contact as ${t2.code}`;
        } else {
          const t3 = (row.mobile && byMobile.find((s) => s.mobile === row.mobile)) || (row.email && byEmail.find((s) => s.email === row.email));
          if (t3) { matchTier = 'T3'; matchNote = `Shares mobile or email with ${t3.code} (informational only)`; }
        }
      }

      if (status !== ROW_STATUS.SKIPPED_UNCHANGED) {
        if (issues.length) status = ROW_STATUS.DATA_EXCEPTION;
        else if (matchStudentId) status = ROW_STATUS.POSSIBLE_DUPLICATE;
      }

      entities.push(this.rows().create({
        batchId: batch.id, rowNumber: r.rowNumber, status, checksum: r.checksum, sourceRecordId: row.sourceRecordId,
        data: rowData(row), aadhaarEnc: row.aadhaarEnc, aadhaarBidx: row.aadhaarBidx, aadhaarLast4: row.aadhaarLast4,
        issues, matchStudentId, matchRowNumber, matchTier, matchNote,
      }));
    }

    await AppDataSource.transaction(async (m) => {
      for (const part of chunk(entities)) await m.getRepository(ImportRow).save(part, { chunk: 200 });
      await this.refreshBatch(batch.id, m);
    });
  }

  /* Recomputes counts and the batch status from its rows. */
  async refreshBatch(batchId: string, m?: EntityManager): Promise<ImportBatch> {
    const batch = await this.getBatch(batchId, m);
    const rows: { status: string; n: string }[] = await (m ?? AppDataSource.manager).query(
      `SELECT "status", count(*)::int AS n FROM "import_rows" WHERE "batchId" = $1 AND "isDelete" = false GROUP BY "status"`, [batchId]);
    const n = (s: string) => Number(rows.find((r) => r.status === s)?.n ?? 0);
    const counts: ImportBatchCounts = {
      ...batch.counts,
      total: rows.reduce((a, r) => a + Number(r.n), 0),
      valid: n(ROW_STATUS.VALID), exceptions: n(ROW_STATUS.DATA_EXCEPTION), duplicates: n(ROW_STATUS.POSSIBLE_DUPLICATE),
      skipped: n(ROW_STATUS.SKIPPED_UNCHANGED), rejected: n(ROW_STATUS.ROW_REJECTED), reconciled: n(ROW_STATUS.RECONCILED),
    };
    batch.counts = counts;
    if (batch.status === BATCH_STATUS.VALIDATING || editable(batch)) {
      batch.status = counts.exceptions + counts.duplicates > 0 ? BATCH_STATUS.VALIDATED_WITH_EXCEPTIONS : BATCH_STATUS.READY_TO_FINALISE;
    }
    return this.batches(m).save(batch);
  }

  private async rowForUpdate(batchId: string, rowId: string, m: EntityManager) {
    const batch = await this.getBatch(batchId, m);
    if (!editable(batch)) throw AppError.conflict(`Rows cannot be changed while the batch is ${batch.status}`);
    const row = await m.getRepository(ImportRow).findOne({ where: { id: rowId, batchId, isDelete: false }, lock: { mode: 'pessimistic_write' } });
    if (!row) throw AppError.notFound('Row not found');
    return { batch, row };
  }

  /* After a change: VALID once no issue is open and no identity match is undecided or on hold. */
  private settle(row: ImportRow) {
    if (row.status === ROW_STATUS.ROW_REJECTED) return;
    const open = row.issues.some((i) => i.status === 'OPEN');
    const undecided = !!row.matchStudentId && (!row.decision || row.decision === 'HOLD');
    row.status = open ? ROW_STATUS.DATA_EXCEPTION : undecided ? ROW_STATUS.POSSIBLE_DUPLICATE : ROW_STATUS.VALID;
  }

  /* A-17: accept every open waivable issue with a reason. Non-waivable issues must be corrected at source (re-import) or the row rejected. */
  async acceptIssues(batchId: string, rowId: string, reason: string, actor: AuthUser, req?: Request) {
    const row = await AppDataSource.transaction(async (m) => {
      const { row } = await this.rowForUpdate(batchId, rowId, m);
      const open = row.issues.filter((i) => i.status === 'OPEN');
      if (!open.length) throw AppError.conflict('This row has no open issues');
      const blocked = open.filter((i) => !ISSUE_CODES[i.code as IssueCode]?.waivable);
      if (blocked.length) throw AppError.badRequest(`These issues cannot be waived: ${[...new Set(blocked.map((i) => i.code))].join(', ')}. Correct them at the source and re-import, or reject the row.`);
      const at = new Date().toISOString();
      row.issues = row.issues.map((i) => (i.status === 'OPEN' ? { ...i, status: 'ACCEPTED', reason, by: actor.id, at } : i));
      this.settle(row);
      await m.getRepository(ImportRow).save(row);
      await this.refreshBatch(batchId, m);
      return row;
    });
    await auditService.record(req, { action: 'exception.resolved', resource: 'import_row', resourceId: row.id, details: { batchId, rowNumber: row.rowNumber, resolution: 'ACCEPTED_WITH_REASON', codes: row.issues.map((i) => i.code), reason } });
    return publicRow(row);
  }

  async rejectRow(batchId: string, rowId: string, reason: string, req?: Request) {
    const row = await AppDataSource.transaction(async (m) => {
      const { row } = await this.rowForUpdate(batchId, rowId, m);
      if (row.status === ROW_STATUS.SKIPPED_UNCHANGED) throw AppError.conflict('Unchanged rows are skipped and cannot be rejected');
      row.status = ROW_STATUS.ROW_REJECTED;
      row.rejectReason = reason;
      await m.getRepository(ImportRow).save(row);
      await this.refreshBatch(batchId, m);
      return row;
    });
    await auditService.record(req, { action: 'exception.row_rejected', resource: 'import_row', resourceId: row.id, details: { batchId, rowNumber: row.rowNumber, reason } });
    return publicRow(row);
  }

  /* Reverses a rejection before finalisation (decisions are reversible until the batch is finalised). */
  async restoreRow(batchId: string, rowId: string, req?: Request) {
    const row = await AppDataSource.transaction(async (m) => {
      const { row } = await this.rowForUpdate(batchId, rowId, m);
      if (row.status !== ROW_STATUS.ROW_REJECTED) throw AppError.conflict('Only rejected rows can be restored');
      row.status = ROW_STATUS.DATA_VALIDATION_PENDING;
      row.rejectReason = null;
      this.settle(row);
      await m.getRepository(ImportRow).save(row);
      await this.refreshBatch(batchId, m);
      return row;
    });
    await auditService.record(req, { action: 'import.row.restored', resource: 'import_row', resourceId: row.id, details: { batchId, rowNumber: row.rowNumber } });
    return publicRow(row);
  }

  /* A-16: reviewer decides an identity match. */
  async decide(batchId: string, rowId: string, decision: MatchDecision, reason: string, actor: AuthUser, req?: Request) {
    const row = await AppDataSource.transaction(async (m) => {
      const { row } = await this.rowForUpdate(batchId, rowId, m);
      if (!row.matchStudentId) throw AppError.conflict('This row has no identity match to decide');
      if (row.status === ROW_STATUS.ROW_REJECTED) throw AppError.conflict('The row is rejected');
      Object.assign(row, { decision, decisionReason: reason, decidedById: actor.id, decidedAt: new Date() });
      this.settle(row);
      await m.getRepository(ImportRow).save(row);
      await this.refreshBatch(batchId, m);
      return row;
    });
    await auditService.record(req, { action: 'reconciliation.decided', resource: 'import_row', resourceId: row.id, details: { batchId, rowNumber: row.rowNumber, tier: row.matchTier, decision, reason } });
    return publicRow(row);
  }

  /* A-12: second person (SOD-01) types the batch code; one transaction writes every VALID row or none. */
  async finalise(batchId: string, confirmCode: string, actor: AuthUser, req?: Request) {
    const result = await AppDataSource.transaction(async (m) => {
      const batch = await this.batches(m).findOne({ where: { id: batchId, isDelete: false }, lock: { mode: 'pessimistic_write' } });
      if (!batch) throw AppError.notFound('Import batch not found');
      if (batch.status !== BATCH_STATUS.READY_TO_FINALISE) throw AppError.conflict(batch.status === BATCH_STATUS.VALIDATED_WITH_EXCEPTIONS
        ? 'Resolve or reject every exception and decide every possible duplicate first' : `A ${batch.status} batch cannot be finalised`);
      if (batch.createdById === actor.id) throw AppError.forbidden('A batch must be finalised by someone other than the person who uploaded it');
      if (confirmCode.trim().toUpperCase() !== batch.code) throw AppError.badRequest('Type the batch code exactly to confirm');

      const valid = await m.getRepository(ImportRow).find({ where: { batchId, status: ROW_STATUS.VALID, isDelete: false }, order: { rowNumber: 'ASC' } });
      let created = 0; let linked = 0;
      for (const row of valid) {
        if (row.matchStudentId && row.decision === 'SAME_PERSON') {
          /* Same person: linked to the existing student; protected identity fields are never overwritten by an import. */
          row.studentId = row.matchStudentId;
          linked++;
        } else {
          const d = row.data as unknown as NormalisedRow;
          const seq = await m.query(`SELECT nextval('students_code_seq') AS n`);
          const student = await m.getRepository(Student).save(m.getRepository(Student).create({
            code: 'STU-' + String(seq[0].n).padStart(6, '0'),
            sourceRecordId: row.decision === 'DIFFERENT_PERSON' && row.matchTier === 'T0' ? null : d.sourceRecordId,
            sourceChecksum: row.checksum,
            firstName: d.firstName, lastName: d.lastName, fatherName: d.fatherName, motherName: d.motherName,
            email: d.email, dateOfBirth: d.dateOfBirth, currentAddress: d.currentAddress,
            aadhaarEnc: row.aadhaarEnc, aadhaarBidx: row.aadhaarBidx, aadhaarLast4: row.aadhaarLast4,
            mobile: d.mobile, religion: d.religion, caste: d.caste, centreCode: d.centreCode,
            trackCode: d.trackCode, trackSourceValue: d.trackSourceValue, educationQualification: d.educationQualification,
            externalStatus: d.approvalStatus, approvedAt: new Date(d.approvedAt as string), evidenceRef: d.evidenceRef,
            declarationAccepted: d.declarationAccepted, documents: d.documents, importBatchId: batch.id,
          }));
          row.studentId = student.id;
          created++;
        }
        row.status = ROW_STATUS.RECONCILED;
      }
      if (valid.length) await m.getRepository(ImportRow).save(valid);
      batch.status = BATCH_STATUS.FINALISED;
      batch.finalisedById = actor.id;
      batch.finalisedAt = new Date();
      batch.counts = { ...batch.counts, created, linked };
      await this.batches(m).save(batch);
      return this.refreshBatch(batch.id, m);
    });
    await auditService.record(req, { action: 'import.batch.finalised', resource: 'import_batch', resourceId: batchId, details: { code: result.code, counts: result.counts } });
    return result;
  }

  async cancel(batchId: string, actor: AuthUser, req?: Request) {
    const batch = await this.getBatch(batchId);
    if (batch.status === BATCH_STATUS.FINALISED || batch.status === BATCH_STATUS.CANCELLED) throw AppError.conflict(`A ${batch.status} batch cannot be cancelled`);
    batch.status = BATCH_STATUS.CANCELLED;
    batch.cancelledById = actor.id;
    await this.batches().save(batch);
    await auditService.record(req, { action: 'import.batch.cancelled', resource: 'import_batch', resourceId: batch.id, details: { code: batch.code } });
    return batch;
  }

  async listBatches(q: { page: number; limit: number; status?: string; search?: string }) {
    const qb = this.batches().createQueryBuilder('b').where('b.isDelete = false');
    if (q.status) qb.andWhere('b.status = :status', { status: q.status });
    if (q.search) qb.andWhere('(b.code ILIKE :s OR b.fileName ILIKE :s OR b.sourceReference ILIKE :s)', { s: `%${q.search.replace(/[%_\\]/g, '\\$&')}%` });
    const [items, total] = await qb.orderBy('b.createdAt', 'DESC').skip((q.page - 1) * q.limit).take(q.limit).getManyAndCount();
    return { items, total };
  }

  async listRows(batchId: string, q: { page: number; limit: number; status?: string; search?: string; issue?: string }) {
    await this.getBatch(batchId);
    const qb = this.rows().createQueryBuilder('r').where('r.batchId = :batchId AND r.isDelete = false', { batchId });
    if (q.status) qb.andWhere('r.status = :status', { status: q.status });
    if (q.issue) qb.andWhere(`r.issues @> :issue::jsonb`, { issue: JSON.stringify([{ code: q.issue }]) });
    if (q.search) {
      const s = `%${q.search.replace(/[%_\\]/g, '\\$&')}%`;
      qb.andWhere(`(r.sourceRecordId ILIKE :s OR (r.data->>'firstName' || ' ' || (r.data->>'lastName')) ILIKE :s)`, { s });
    }
    const [items, total] = await qb.orderBy('r.rowNumber', 'ASC').skip((q.page - 1) * q.limit).take(q.limit).getManyAndCount();
    return { items: items.map(publicRow), total };
  }
}

export const importService = new ImportService();
