import crypto from 'crypto';
import fs from 'fs/promises';
import type { Request } from 'express';
import { MESSAGES } from '../../../constants/api-response.constants';
import { AppDataSource } from '../../../config/database.config';
import { AppError } from '../../../shared/errors/app-error';
import { buildMeta, likePattern, toSkipTake, type Paginated } from '../../../shared/utils/pagination';
import { auditService } from '../../audit';
import { mastersService } from '../../masters';
import { detectFileType, extensionMatches } from '../documents/file-type';
import { StudentDocument } from '../documents/student-document.entity';
import { Student } from '../register/student.entity';
import { publicStudent } from '../register/student.service';
import { decryptAadhaar } from '../aadhaar';
import { DOCUMENTS, REGISTRATION_MASTER_FIELDS } from '../student.constants';
import type { EditRegistrationBody, ListRegistrationsQuery } from './registration-admin.validation';
import { registrationService, resolveMasters, type PreparedDocument } from './registration.service';
import { validateCandidate } from '../import/row-validator';
import { adminRegistrationData } from './registration-admin.validation';

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
        details: { codes: items.map((s) => s.code), fields: ['email', 'mobile'] },
      });
    }
    return {
      items: items.map((s) => ({
        ...publicStudent(s),
        source: s.source,
        isActive: s.isActive,
        registrationNumber: s.registrationNumber,
        ...(opts.unmask ? { unmasked: { email: s.email, mobile: s.mobile } } : {}),
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
    let unmasked: { email: string | null; mobile: string | null; currentAddress: string; aadhaar: string | null } | undefined;
    if (opts.unmask) {
      const digits = s.aadhaarEnc ? decryptAadhaar(s.aadhaarEnc) : null;
      unmasked = {
        email: s.email,
        mobile: s.mobile,
        currentAddress: s.currentAddress,
        aadhaar: digits ? digits.replace(/(\d{4})(?=\d)/g, '$1 ') : null,
      };
      await auditService.record(opts.req, {
        action: 'student.registration.unmasked_view',
        resource: 'student',
        resourceId: s.id,
        details: { code: s.code, fields: ['email', 'mobile', 'aadhaar', 'currentAddress'] },
      });
    }
    return {
      ...publicStudent(s, true),
      source: s.source,
      isActive: s.isActive,
      registrationNumber: s.registrationNumber,
      regionId: s.regionId,
      casteId: s.casteId,
      educationId: s.educationId,
      ...(unmasked ? { unmasked } : {}),
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

  /* Soft delete: the row (and its documents) stay for history; the student disappears from lists and lookups. */
  async remove(req: Request, id: string) {
    const s = await AppDataSource.getRepository(Student).findOne({ where: { id, isDelete: false } });
    if (!s) throw AppError.notFound(MESSAGES.notFound('Student'));
    await AppDataSource.transaction(async (m) => {
      await m.getRepository(Student).update({ id, isDelete: false }, { isDelete: true, isActive: false });
      await auditService.recordInTx(m, req, { action: 'student.delete', resource: 'student', resourceId: id, details: { code: s.code } });
    });
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
      const buf = await fs.readFile(f.path);
      const kind = detectFileType(buf);
      if (!kind || !extensionMatches(f.originalname, kind)) {
        errors.push({ field, message: `${type.name}: only PDF, JPG, JPEG or PNG files are accepted` });
        continue;
      }
      const barcode = barcodes[type.code]?.trim() || null;
      prepared.push({
        code: type.code,
        documentTypeId: type.id,
        data: buf,
        ext: kind.ext,
        mimeType: kind.mime,
        originalName: f.originalname,
        sha256: crypto.createHash('sha256').update(buf).digest('hex'),
        barcode,
      });
    }
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
