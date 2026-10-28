import crypto from 'crypto';
import fs from 'fs/promises';
import { z } from 'zod';
import type { Request } from 'express';
import { In } from 'typeorm';
import { MESSAGES } from '../../../constants/api-response.constants';
import { AppDataSource } from '../../../config/database.config';
import { logger } from '../../../observability/logger';
import { AppError } from '../../../shared/errors/app-error';
import { buildMeta, likePattern, toSkipTake, type Paginated } from '../../../shared/utils/pagination';
import { auditService } from '../../audit';
import { mastersService, type MasterLookup } from '../../masters';
import { documentStorage } from '../documents/document-storage';
import { detectFileType, detectVideoType, documentFileRule, extensionMatches, isVideoDocumentType } from '../documents/file-type';
import { StudentDocument } from '../documents/student-document.entity';
import { Student } from '../register/student.entity';
import { publicStudent, unmaskedContact } from '../register/student.service';
import { decryptAadhaar, maskEmail, maskMobile } from '../aadhaar';
import { DOCUMENTS, REGISTRATION_MASTER_FIELDS } from '../student.constants';
import type { EditRegistrationBody, ListRegistrationsQuery } from './registration-admin.validation';
import { registrationService, resolveMasters, type PreparedDocument } from './registration.service';
import { validateCandidate } from '../import/row-validator';
import { adminRegistrationData, barcodeMap } from './registration-admin.validation';

/*
 * The detail page lists documents from DOCUMENTS (the import's list). Document types added to the master since (e.g.
 * Applicant Photograph with Aadhaar, Disability Certificate) and any uploaded file of another type are appended, so
 * every uploaded file can be viewed and verified.
 */
type DocumentRow = { key: string; label: string; required: boolean; supplied: boolean; barcode: string | null };
async function withMasterDocuments(listed: DocumentRow[], s: Student, files: StudentDocument[]): Promise<DocumentRow[]> {
  const masters = await mastersService.loadLookup();
  const known = new Set(listed.map((d) => d.key));
  const out = [...listed];
  for (const t of masters.list('documentType')) {
    if (known.has(t.code)) continue;
    known.add(t.code);
    out.push({ key: t.code, label: t.name, required: !!t.isMandatory, ...(s.documents[t.code] ?? { supplied: false, barcode: null }) });
  }
  for (const f of files) {
    if (known.has(f.docType)) continue;
    known.add(f.docType);
    out.push({ key: f.docType, label: f.docType, required: false, supplied: true, barcode: s.documents[f.docType]?.barcode ?? null });
  }
  return out;
}

/*
 * The EDP portal's details of a registration (null values for imported and admin-entered records), with names for its
 * references. Protected values (alternate contacts) are masked here; the full ones are in `unmasked`, audited.
 */
async function edpProfile(s: Student) {
  const [names]: { centreName: string | null; centreCode: string | null; districtName: string | null; talukaName: string | null }[] =
    await AppDataSource.query(
      `SELECT c."name" AS "centreName", c."code" AS "centreCode",
              d."name" AS "districtName", t."name" AS "talukaName"
       FROM (SELECT 1) x
       LEFT JOIN "edp_centres" c ON c."id" = $1
       LEFT JOIN "districts" d ON d."id" = $2 LEFT JOIN "talukas" t ON t."id" = $3`,
      [s.centreId, s.districtId, s.talukaId],
    );
  return {
    gender: s.gender,
    maritalStatus: s.maritalStatus,
    permanentAddress: s.permanentAddress ? 'On file' : null,
    landmark: s.landmark,
    districtName: names.districtName,
    talukaName: names.talukaName,
    pinCode: s.pinCode,
    alternateMobile: s.alternateMobile ? maskMobile(s.alternateMobile) : null,
    alternateEmail: s.alternateEmail ? maskEmail(s.alternateEmail) : null,
    disabilityStatus: s.disabilityStatus,
    disabilityType: s.disabilityType,
    disabilityCertificateNumber: s.disabilityCertificateNumber ? `••••${s.disabilityCertificateNumber.slice(-4)}` : null,
    centreName: names.centreName,
    centreCode: names.centreCode,
    qualificationName: s.qualificationName,
    qualificationStream: s.qualificationStream,
    qualificationBoard: s.qualificationBoard,
    qualificationCompletedOn: s.qualificationCompletedOn,
    gradingType: s.gradingType,
    cgpaScale: s.cgpaScale,
    score: s.score === null ? null : Number(s.score),
    qualificationClass: s.qualificationClass,
  };
}

/*
 * Checks uploaded document files (field name = document type code; type from the content; extension agrees) and
 * reads them for storage. Problems are appended to `errors` as field errors (files.<CODE>).
 */
export async function prepareFiles(
  files: Express.Multer.File[],
  masters: MasterLookup,
  barcodes: Record<string, string>,
  errors: { field: string; message: string }[],
): Promise<{ prepared: PreparedDocument[]; seen: Set<string> }> {
  const prepared: PreparedDocument[] = [];
  const seen = new Set<string>();
  for (const f of files) {
    const type = masters.find('documentType', f.fieldname);
    const field = `files.${f.fieldname}`;
    if (!type || type.code !== f.fieldname.toUpperCase()) {
      errors.push({ field, message: 'Unknown or inactive document type' });
      continue;
    }
    if (seen.has(type.code)) {
      errors.push({ field, message: `Only one ${type.name} file may be uploaded` });
      continue;
    }
    seen.add(type.code);
    /* Each type's own limit: 5 MB for documents, 50 MB for a video (the multipart limit is the larger one). */
    const rule = documentFileRule(type.code);
    if (f.size > rule.maxMb * 1024 * 1024) {
      errors.push({ field, message: `${type.name}: file is larger than ${rule.maxMb} MB` });
      continue;
    }
    const buf = await fs.readFile(f.path);
    const video = isVideoDocumentType(type.code);
    const kind = video ? detectVideoType(buf) : detectFileType(buf);
    if (!kind || !extensionMatches(f.originalname, kind)) {
      errors.push({
        field,
        message: video ? `${type.name}: only MP4 videos are accepted` : `${type.name}: only PDF, JPG, JPEG or PNG files are accepted`,
      });
      continue;
    }
    prepared.push({
      code: type.code,
      documentTypeId: type.id,
      data: buf,
      ext: kind.ext,
      mimeType: kind.mime,
      originalName: f.originalname,
      sha256: crypto.createHash('sha256').update(buf).digest('hex'),
      barcode: barcodes[type.code]?.trim() || null,
    });
  }
  return { prepared, seen };
}

const replaceDocumentsData = z.object({ barcodes: barcodeMap.optional() }).strict();

type ListItem = ReturnType<typeof publicStudent> & { unmasked?: { email: string | null; mobile: string | null } };
const BARCODE = new Map(DOCUMENTS.map((d) => [d.key, d.barcode]));

/* Registrations as the admin panel sees them (Student Registration menu): list, detail and admin entry with documents. */
export const registrationAdminService = {
  /*
   * With `unmask` (callers holding registrations.update), each row also carries the full email and mobile; one audit row
   * per list request records which registrations were shown unmasked. Others get masked values only.
   */
  async list(q: ListRegistrationsQuery, opts: { unmask?: boolean; req?: Request } = {}): Promise<Paginated<ListItem>> {
    const qb = AppDataSource.getRepository(Student).createQueryBuilder('s').where('s.isDelete = false');
    /* One table for both: imported students (IMPORT) and registrations (PUBLIC_REGISTRATION); optional source filter. */
    if (q.source) qb.andWhere('s.source = :source', { source: q.source });
    if (q.status) qb.andWhere('s.status = :status', { status: q.status });
    if (q.search) {
      const t = q.search.trim();
      /* Mobile is searchable by its last four digits only. */
      qb.andWhere(
        `(s.code ILIKE :s OR s.registrationNumber LIKE :s OR (s.firstName || ' ' || s.lastName) ILIKE :s OR s.email ILIKE :s ${/^\d{4}$/.test(t) ? 'OR right(s.mobile, 4) = :last4' : ''})`,
        { s: likePattern(t), last4: t },
      );
    }
    const { skip, take } = toSkipTake(q);
    const [items, total] = await qb.orderBy(`s.${q.sortBy}`, q.sortOrder).addOrderBy('s.id').skip(skip).take(take).getManyAndCount();
    if (opts.unmask && items.length) {
      await auditService.record(opts.req, {
        action: 'student.registration.unmasked_list',
        resource: 'student',
        resourceId: null,
        details: { codes: items.map((s) => s.code), fields: ['email', 'mobile', 'aadhaar'] },
      });
    }
    return {
      items: items.map((s) => ({
        ...publicStudent(s),
        source: s.source,
        isActive: s.isActive,
        registrationNumber: s.registrationNumber,
        ...(opts.unmask ? { unmasked: unmaskedContact(s) } : {}),
      })),
      meta: buildMeta(q, total),
    };
  },

  /*
   * With `unmask` (callers holding registrations.update), the response also carries the full email, mobile and
   * Aadhaar number, and the view is recorded in the audit log (who saw whose details). Others get masked values only.
   */
  async get(id: string, opts: { unmask?: boolean; req?: Request } = {}) {
    const s = await AppDataSource.getRepository(Student).findOne({
      where: { id, isDelete: false },
    });
    if (!s) throw AppError.notFound(MESSAGES.notFound('Registration'));
    const files = await AppDataSource.getRepository(StudentDocument).find({
      where: { studentId: id, isDelete: false },
      order: { docType: 'ASC' },
    });
    const verifierIds = [...new Set(files.map((f) => f.verifiedById).filter((x): x is string => !!x))];
    const verifiers = new Map<string, string>(
      verifierIds.length
        ? (await AppDataSource.query(`SELECT "id", "name" FROM "users" WHERE "id" = ANY($1)`, [verifierIds])).map(
            (u: { id: string; name: string }) => [u.id, u.name],
          )
        : [],
    );
    let unmasked:
      | {
          email: string | null;
          mobile: string | null;
          currentAddress: string;
          aadhaar: string | null;
          permanentAddress: string | null;
          alternateMobile: string | null;
          alternateEmail: string | null;
          disabilityCertificateNumber: string | null;
        }
      | undefined;
    if (opts.unmask) {
      const digits = s.aadhaarEnc ? decryptAadhaar(s.aadhaarEnc) : null;
      unmasked = {
        email: s.email,
        mobile: s.mobile,
        currentAddress: s.currentAddress,
        aadhaar: digits ? digits.replace(/(\d{4})(?=\d)/g, '$1 ') : null,
        permanentAddress: s.permanentAddress,
        alternateMobile: s.alternateMobile,
        alternateEmail: s.alternateEmail,
        disabilityCertificateNumber: s.disabilityCertificateNumber,
      };
      await auditService.record(opts.req, {
        action: 'student.registration.unmasked_view',
        resource: 'student',
        resourceId: s.id,
        details: {
          code: s.code,
          fields: ['email', 'mobile', 'aadhaar', 'currentAddress', 'permanentAddress', 'alternateMobile', 'alternateEmail', 'disabilityCertificateNumber'],
        },
      });
    }
    const base = publicStudent(s, true) as ReturnType<typeof publicStudent> & { documents: DocumentRow[] };
    return {
      ...base,
      documents: await withMasterDocuments(base.documents, s, files),
      source: s.source,
      isActive: s.isActive,
      registrationNumber: s.registrationNumber,
      regionId: s.regionId,
      casteId: s.casteId,
      educationId: s.educationId,
      ...(unmasked ? { unmasked } : {}),
      profile: await edpProfile(s),
      files: files.map((f) => ({
        id: f.id,
        docType: f.docType,
        originalName: f.originalName,
        mimeType: f.mimeType,
        sizeBytes: f.sizeBytes,
        uploadedAt: f.createdAt,
        verifiedAt: f.verifiedAt,
        verifiedBy: f.verifiedById ? (verifiers.get(f.verifiedById) ?? null) : null,
      })),
    };
  },

  /*
   * Edits a student's details (registration or imported): the same validation and normalisation as a new
   * registration. A changed Aadhaar must not belong to another student. Audited with the changed field names only.
   */
  async update(req: Request, id: string, body: EditRegistrationBody) {
    const s = await AppDataSource.getRepository(Student).findOne({ where: { id, isDelete: false } });
    if (!s) throw AppError.notFound(MESSAGES.notFound('Student'));
    const masters = await mastersService.loadLookup();
    const { region_id, caste_id, education_id, ...rest } = body;
    const refs = resolveMasters(masters, { region_id, caste_id, education_id }, []);
    const raw: Record<string, string> = {
      ...Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, String(v)])),
      course_centre: refs.region?.code ?? '',
      caste: refs.caste?.name ?? '',
      education_qualification: refs.education?.name ?? '',
      declaration_accepted: s.declarationAccepted ? 'Yes' : '',
    };
    const { fields, issues } = validateCandidate(raw, masters);
    const errors = [
      ...refs.errors,
      ...issues.filter((i) => !(i.field in REGISTRATION_MASTER_FIELDS)).map((i) => ({ field: `body.${i.field}`, message: i.message })),
    ];
    if (errors.length) throw AppError.validation(errors);
    const { nameKey: _nameKey, declarationAccepted: _decl, ...data } = fields;
    const changed = (Object.keys(data) as (keyof typeof data)[]).filter((k) => {
      const before = (s as unknown as Record<string, unknown>)[k];
      const after = data[k] as unknown;
      return Buffer.isBuffer(after)
        ? k === 'aadhaarEnc' && data.aadhaarBidx !== s.aadhaarBidx
        : String(before ?? '') !== String(after ?? '');
    });
    await AppDataSource.transaction(async (m) => {
      if (data.aadhaarBidx && data.aadhaarBidx !== s.aadhaarBidx) {
        await m.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [data.aadhaarBidx]);
        const other = await m.getRepository(Student).findOne({ where: { aadhaarBidx: data.aadhaarBidx, isDelete: false } });
        if (other && other.id !== id) throw AppError.conflict('Another student already has this Aadhaar number');
      }
      await m.getRepository(Student).update({ id, isDelete: false }, data);
      await auditService.recordInTx(m, req, {
        action: 'student.update',
        resource: 'student',
        resourceId: id,
        details: { code: s.code, fields: changed.filter((k) => k !== 'aadhaarBidx' && k !== 'aadhaarLast4') },
      });
    });
    return this.get(id, { unmask: true, req });
  },

  async setStatus(req: Request, id: string, isActive: boolean) {
    const repo = AppDataSource.getRepository(Student);
    const s = await repo.findOne({ where: { id, isDelete: false } });
    if (!s) throw AppError.notFound(MESSAGES.notFound('Student'));
    await AppDataSource.transaction(async (m) => {
      await m.getRepository(Student).update({ id, isDelete: false }, { isActive });
      await auditService.recordInTx(m, req, {
        action: 'student.status',
        resource: 'student',
        resourceId: id,
        details: { code: s.code, isActive },
      });
    });
    return this.get(id, { unmask: true, req });
  },

  /*
   * Soft delete: the row (and its documents) stay for history; the student disappears from lists and lookups.
   * Refused (409) while a non-deleted batch assignment references the student, so no live assignment is left
   * holding a seat for a deleted student. The student row is locked FOR UPDATE before the count: Assign Batch
   * reads the student FOR SHARE, so a concurrent assignment either commits first (and is counted here) or waits
   * and then finds the student deleted. Raw SQL on batch_assignments keeps this module free of the masters code.
   */
  async remove(req: Request, id: string) {
    await AppDataSource.transaction(async (m) => {
      const rows: { code: string }[] = await m.query(
        `SELECT "code" FROM "students" WHERE "id" = $1 AND "isDelete" = false FOR UPDATE`,
        [id],
      );
      if (!rows.length) throw AppError.notFound(MESSAGES.notFound('Student'));
      const [{ n }]: { n: number }[] = await m.query(
        `SELECT count(*)::int AS "n" FROM "batch_assignments" WHERE "studentId" = $1 AND "isDelete" = false`,
        [id],
      );
      if (n > 0) {
        throw AppError.conflict('This student cannot be deleted while a batch assignment references it. Remove the assignment first.');
      }
      await m.getRepository(Student).update({ id, isDelete: false }, { isDelete: true, isActive: false });
      await auditService.recordInTx(m, req, { action: 'student.delete', resource: 'student', resourceId: id, details: { code: rows[0].code } });
    });
  },

  /*
   * Replaces or adds a student's documents (edit form, step 3), and updates barcodes. Same file rules as a new
   * registration. A replaced document is deleted for good (its record and its file) and the new file, which starts
   * unverified, takes its place as students/<code>/<TYPE>.<ext>; other document types are untouched. Mandatory types
   * must still have a file and required barcodes stay required. Audited with the deleted documents' details.
   * New files are written under students/<code>/_staging/ first and only moved into place once the database change has
   * committed, so a request that fails (validation, storage or database) leaves the old documents as they were.
   */
  async replaceDocuments(req: Request, id: string, rawData: unknown, files: Express.Multer.File[]) {
    const s = await AppDataSource.getRepository(Student).findOne({ where: { id, isDelete: false } });
    if (!s) throw AppError.notFound(MESSAGES.notFound('Student'));
    let json: unknown = rawData ?? {};
    if (typeof rawData === 'string') {
      try {
        json = JSON.parse(rawData);
      } catch {
        throw AppError.validation([{ field: 'body.data', message: 'Document data must be valid JSON' }]);
      }
    }
    const parsed = replaceDocumentsData.safeParse(json);
    const errors: { field: string; message: string }[] = parsed.success
      ? []
      : parsed.error.issues.map((i) => ({ field: ['body', ...i.path].join('.'), message: i.message }));
    const barcodes = (parsed.success ? parsed.data.barcodes : undefined) ?? {};
    const masters = await mastersService.loadLookup();
    const { prepared } = await prepareFiles(files, masters, barcodes, errors);
    const current = await AppDataSource.getRepository(StudentDocument).find({ where: { studentId: id, isDelete: false } });
    const hasFile = (code: string) => prepared.some((p) => p.code === code) || current.some((d) => d.docType === code);
    const barcodeOf = (code: string) =>
      code in barcodes ? barcodes[code]?.trim() || null : ((s.documents[code]?.barcode as string | null | undefined) ?? null);
    for (const t of masters.list('documentType')) {
      if (t.isMandatory && !hasFile(t.code)) errors.push({ field: `files.${t.code}`, message: `${t.name} is required` });
      if (hasFile(t.code) && BARCODE.get(t.code) === 'required' && !barcodeOf(t.code))
        errors.push({ field: `body.barcodes.${t.code}`, message: `${t.name} barcode is required` });
    }
    for (const code of Object.keys(barcodes))
      if (!masters.find('documentType', code)) errors.push({ field: `body.barcodes.${code}`, message: 'Unknown document type' });
    if (errors.length) throw AppError.validation(errors);

    const pending = prepared.map((f) => ({
      file: f,
      stagedKey: documentStorage.studentStagingKey(s.code, `${f.code}.${f.ext}`),
      finalKey: documentStorage.studentKey(s.code, `${f.code}.${f.ext}`),
      documentId: '',
      oldKeys: [] as string[],
    }));
    const written: string[] = [];
    /*
     * One documents edit per student at a time, from its database change until its files are in place (a session
     * advisory lock on a connection of its own, which also runs the transaction). Without it a second replacement of the
     * same type could commit in between and have its new file deleted, or left stray, by the first one's file steps.
     */
    const runner = AppDataSource.createQueryRunner('master');
    const lockKey = `student-documents:${id}`;
    let lockHeld = false;
    try {
      try {
        for (const p of pending) {
          written.push(p.stagedKey); // before the write, so a partly written file is cleaned up too
          await documentStorage.write(p.stagedKey, p.file.data);
        }
        await runner.query(`SELECT pg_advisory_lock(hashtext($1))`, [lockKey]);
        lockHeld = true;
        await runner.manager.transaction(async (m) => {
          const docs = m.getRepository(StudentDocument);
          /* Concurrent edits of one student wait for each other, so the documents deleted below are the current ones. */
          const locked = await m.getRepository(Student).findOne({ where: { id, isDelete: false }, lock: { mode: 'pessimistic_write' } });
          if (!locked) throw AppError.notFound(MESSAGES.notFound('Student'));
          const documents = { ...locked.documents } as Student['documents'];
          const old = pending.length
            ? await docs.find({ where: { studentId: id, docType: In(pending.map((p) => p.file.code)), isDelete: false } })
            : [];
          if (old.length) await docs.delete(old.map((d) => d.id));
          for (const p of pending) {
            const f = p.file;
            p.oldKeys = old.filter((d) => d.docType === f.code).map((d) => d.storageKey);
            const inserted = await docs.insert({
              batchId: null,
              importRowId: null,
              studentId: id,
              docType: f.code,
              storageKey: p.finalKey,
              sourcePath: null,
              originalName: f.originalName.slice(0, 255),
              mimeType: f.mimeType,
              sizeBytes: f.data.length,
              sha256: f.sha256,
              uploadedById: req.auth!.id,
            });
            p.documentId = inserted.identifiers[0]!.id as string;
            documents[f.code] = { supplied: true, barcode: barcodeOf(f.code), documentTypeId: f.documentTypeId };
          }
          for (const code of Object.keys(barcodes)) {
            const type = masters.find('documentType', code)!;
            documents[type.code] = {
              supplied: documents[type.code]?.supplied ?? hasFile(type.code),
              barcode: barcodeOf(type.code),
              documentTypeId: type.id,
            };
          }
          await m.getRepository(Student).update({ id, isDelete: false }, { documents });
          await auditService.recordInTx(m, req, {
            action: 'student.documents.update',
            resource: 'student',
            resourceId: id,
            details: {
              code: s.code,
              uploaded: prepared.map((p) => p.code),
              /* The replaced documents were deleted for good (record and file), not archived. */
              replaced: old.map((d) => ({ docType: d.docType, originalName: d.originalName, sizeBytes: d.sizeBytes, sha256: d.sha256 })),
              deleted: old.length > 0,
              barcodes: Object.keys(barcodes),
            },
          });
        });
      } catch (err) {
        for (const key of written)
          await documentStorage
            .remove(key)
            .catch((e) => logger.error({ err: e, studentId: id, key }, 'could not remove a staged document file'));
        throw err;
      }

      /*
       * Committed: delete the replaced files, then move each new file into place (the old key may be the new one when
       * the extension is the same). The change cannot be undone here, so a failure is logged with the keys; a file that
       * could not be moved stays at its staging key and its record is pointed there, so it can still be downloaded.
       */
      for (const p of pending) {
        const ctx = { studentId: id, docType: p.file.code, documentId: p.documentId, stagedKey: p.stagedKey, finalKey: p.finalKey };
        for (const key of p.oldKeys)
          await documentStorage
            .remove(key)
            .catch((err) => logger.error({ err, ...ctx, oldKey: key }, 'could not delete a replaced document file'));
        try {
          await documentStorage.move(p.stagedKey, p.finalKey);
        } catch (err) {
          logger.error({ err, ...ctx }, 'could not move a new document file into place; it stays at its staging key');
          await runner.manager
            .getRepository(StudentDocument)
            .update(p.documentId, { storageKey: p.stagedKey })
            .catch((e) => logger.error({ err: e, ...ctx }, 'could not point the document record at its staging key'));
        }
      }
    } finally {
      if (lockHeld)
        await runner
          .query(`SELECT pg_advisory_unlock(hashtext($1))`, [lockKey])
          .catch((err) => logger.error({ err, studentId: id }, 'could not release the student documents lock'));
      await runner.release();
    }
    return this.get(id, { unmask: true, req });
  },

  /* Marks one uploaded document as checked. Verifying again is a no-op that keeps the first reviewer and time. */
  async verifyDocument(req: Request, id: string, documentId: string) {
    await this.get(id);
    const repo = AppDataSource.getRepository(StudentDocument);
    const doc = await repo.findOne({ where: { id: documentId, studentId: id, isDelete: false } });
    if (!doc) throw AppError.notFound(MESSAGES.notFound('Document'));
    if (!doc.verifiedAt) {
      await repo.update(doc.id, { verifiedAt: new Date(), verifiedById: req.auth!.id });
      await auditService.record(req, {
        action: 'student.document.verified',
        resource: 'student',
        resourceId: id,
        details: { documentId, docType: doc.docType },
      });
    }
    return (await this.get(id)).files.find((f) => f.id === documentId)!;
  },

  /*
   * Admin entry of a registration. Every document file is checked (type from its content, extension, size), mandatory
   * document types need a file, and a barcode is required where the document type demands one. The registration itself
   * goes through the same validation and duplicate rules as the public API; the files are stored in its transaction.
   */
  async create(req: Request, rawData: unknown, files: Express.Multer.File[]) {
    let json: unknown = rawData;
    if (typeof rawData === 'string') {
      try {
        json = JSON.parse(rawData);
      } catch {
        throw AppError.validation([{ field: 'body.data', message: 'Registration data must be valid JSON' }]);
      }
    }
    const parsed = adminRegistrationData.safeParse(json ?? {});
    const errors: { field: string; message: string }[] = parsed.success
      ? []
      : parsed.error.issues.map((i) => ({ field: ['body', ...i.path].join('.'), message: i.message }));
    const data = parsed.success ? parsed.data : null;
    const barcodes = data?.barcodes ?? {};

    const masters = await mastersService.loadLookup();
    const { prepared, seen } = await prepareFiles(files, masters, barcodes, errors);
    for (const t of masters.list('documentType')) {
      if (t.isMandatory && !seen.has(t.code) && !errors.some((e) => e.field === `files.${t.code}`))
        errors.push({ field: `files.${t.code}`, message: `${t.name} is required` });
      if (seen.has(t.code) && BARCODE.get(t.code) === 'required' && !barcodes[t.code]?.trim())
        errors.push({ field: `body.barcodes.${t.code}`, message: `${t.name} barcode is required` });
    }
    if (errors.length || !data) throw AppError.validation(errors);

    const { barcodes: _barcodes, ...body } = data;
    const result = await registrationService.register(req, body, { actorUserId: req.auth!.id, files: prepared });
    return {
      id: result.studentId,
      registration_id: result.registration_id,
      registration_number: result.registration_number,
      status: result.status,
    };
  },
};
