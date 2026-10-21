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
import { DOCUMENTS, STUDENT_SOURCE } from '../student.constants';
import type { ListRegistrationsQuery } from './registration-admin.validation';
import { registrationService, type PreparedDocument } from './registration.service';
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
    const qb = AppDataSource.getRepository(Student)
      .createQueryBuilder('s')
      .where('s.isDelete = false AND s.source = :source', { source: STUDENT_SOURCE.PUBLIC_REGISTRATION });
    if (q.status) qb.andWhere('s.status = :status', { status: q.status });
    if (q.search) {
      const t = q.search.trim();
      /* Mobile is searchable by its last four digits only. */
      qb.andWhere(
        `(s.code ILIKE :s OR (s.firstName || ' ' || s.lastName) ILIKE :s OR s.email ILIKE :s ${/^\d{4}$/.test(t) ? 'OR right(s.mobile, 4) = :last4' : ''})`,
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
      items: items.map((s) => ({ ...publicStudent(s), ...(opts.unmask ? { unmasked: { email: s.email, mobile: s.mobile } } : {}) })),
      meta: buildMeta(q, total),
    };
  },

  /*
   * With `unmask` (callers holding registrations.update), the response also carries the full email, mobile and
   * Aadhaar number, and the view is recorded in the audit log (who saw whose details). Others get masked values only.
   */
  async get(id: string, opts: { unmask?: boolean; req?: Request } = {}) {
    const s = await AppDataSource.getRepository(Student).findOne({
      where: { id, isDelete: false, source: STUDENT_SOURCE.PUBLIC_REGISTRATION },
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
    let unmasked: { email: string | null; mobile: string | null; aadhaar: string | null } | undefined;
    if (opts.unmask) {
      const digits = s.aadhaarEnc ? decryptAadhaar(s.aadhaarEnc) : null;
      unmasked = { email: s.email, mobile: s.mobile, aadhaar: digits ? digits.replace(/(\d{4})(?=\d)/g, '$1 ') : null };
      await auditService.record(opts.req, {
        action: 'student.registration.unmasked_view',
        resource: 'student',
        resourceId: s.id,
        details: { code: s.code, fields: ['email', 'mobile', 'aadhaar'] },
      });
    }
    return {
      ...publicStudent(s, true),
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
    return { id: result.studentId, registration_id: result.registration_id, status: result.status };
  },
};
