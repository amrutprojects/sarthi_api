import crypto from 'crypto';
import { MESSAGES } from '../../../constants/api-response.constants';
import type { Request } from 'express';
import { In, IsNull, type EntityManager } from 'typeorm';
import { AppDataSource } from '../../../config/database.config';
import { env } from '../../../config/env.config';
import { logger } from '../../../observability/logger';
import { AppError } from '../../../shared/errors/app-error';
import { auditService } from '../../audit';
import type { AuthUser } from '../../auth';
import { ImportBatch as ImportBatchEntity, type DocumentsReport, type ImportBatch } from '../import/import-batch.entity';
import type { ImportRow, StoredIssue } from '../import/import-row.entity';
import { ImportRow as ImportRowEntity } from '../import/import-row.entity';
import { importService } from '../import/import.service';
import { zipPathKey } from '../import/row-validator';
import { Student } from '../register/student.entity';
import { BATCH_STATUS, DOCUMENTS, ROW_STATUS } from '../student.constants';
import { documentStorage, safeSegment } from './document-storage';
import { detectFileType, extensionMatches } from './file-type';
import { StudentDocument } from './student-document.entity';
import { readDocumentsZip, ZipFormatError, type ZipDocument } from './zip-reader';

const MB = 1024 * 1024;
const LABEL = new Map(DOCUMENTS.map((d) => [d.key, d.label]));
const docField = (key: string) => `doc_${key.toLowerCase()}`;
const editable = (b: ImportBatch) => b.status === BATCH_STATUS.VALIDATED_WITH_EXCEPTIONS || b.status === BATCH_STATUS.READY_TO_FINALISE;

export interface StudentDocumentDto {
  id: string;
  docType: string;
  label: string;
  originalName: string;
  /* Path of the file inside the uploaded ZIP. */
  sourcePath: string | null;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: Date;
}
const toDto = (d: StudentDocument): StudentDocumentDto => ({
  id: d.id,
  docType: d.docType,
  label: LABEL.get(d.docType) ?? d.docType,
  originalName: d.originalName,
  sourcePath: d.sourcePath,
  mimeType: d.mimeType,
  sizeBytes: d.sizeBytes,
  uploadedAt: d.createdAt,
});

/* A file operation done during finalisation, undone if the database transaction rolls back. */
type FileOp = { kind: 'copy'; to: string } | { kind: 'move'; from: string; to: string };

export class DocumentService {
  private repo(m?: EntityManager) {
    return (m ?? AppDataSource.manager).getRepository(StudentDocument);
  }

  /*
   * Attach a documents ZIP to a batch under review. Each file is assigned to a row and document type by:
   *   1. the Excel: a document column (e.g. doc_photo) holding the file's path inside the ZIP — any folder or name;
   *   2. otherwise the folder convention: <source_record_id>/<TYPE>.<ext> (or <id>_<TYPE>.<ext>).
   * Every file is checked by content (PDF/JPG/PNG, ≤ DOCUMENT_MAX_FILE_MB), stored under
   * imports/<batch>/<sourceId>/<TYPE>.<ext>, and recorded in student_documents with its path in the ZIP.
   * A stored document clears the row's DOC_MISSING issue for that type; a bad file adds DOC_INVALID; a path named
   * in the Excel but absent from the ZIP stays DOC_MISSING and is listed in the report. Re-uploading replaces.
   */
  async attachZip(batchId: string, zip: { path: string; originalname: string }, actor: AuthUser, req?: Request): Promise<ImportBatch> {
    const batch = await importService.getBatch(batchId);
    if (!editable(batch)) throw AppError.conflict(`Documents can be added only while the batch is under review (it is ${batch.status})`);

    const rows = await AppDataSource.getRepository(ImportRowEntity).find({ where: { batchId, isDelete: false } });
    const usable = (r: ImportRow) =>
      r.status !== ROW_STATUS.ROW_REJECTED && r.status !== ROW_STATUS.SKIPPED_UNCHANGED && r.status !== ROW_STATUS.RECONCILED;
    const bySource = new Map(rows.filter((r) => r.sourceRecordId).map((r) => [safeSegment(r.sourceRecordId!).toUpperCase(), r]));

    /* Paths written in the Excel document columns: ZIP path (case-insensitive) → the row and document type expecting it. */
    const expected = new Map<string, { row: ImportRow; docType: string; path: string }>();
    for (const r of rows.filter(usable)) {
      const docs = (r.data.documents ?? {}) as Record<string, { path?: string }>;
      for (const [docType, d] of Object.entries(docs)) if (d.path) expected.set(zipPathKey(d.path), { row: r, docType, path: d.path });
    }

    const report: DocumentsReport = {
      zipName: zip.originalname.slice(0, 255),
      uploadedAt: new Date().toISOString(),
      stored: 0,
      matchedByPath: 0,
      replaced: 0,
      studentsWithFiles: 0,
      unmatchedFolders: [],
      rejected: [],
      missingReferenced: [],
    };
    const touched = new Map<string, ImportRow>();
    const unmatched = new Set<string>();
    const found = new Set<string>();

    const rejectFor = (row: ImportRow, docType: string, path: string, reason: string) => {
      report.rejected.push({ path, reason });
      row.issues = row.issues.filter((i) => !(i.code === 'DOC_INVALID' && i.field === docField(docType)));
      row.issues.push({
        field: docField(docType),
        code: 'DOC_INVALID',
        message: `${LABEL.get(docType)}: ${reason}`,
        status: 'OPEN',
      } as StoredIssue);
      touched.set(row.id, row);
    };

    /* Check, stage and record one file for a row and document type. */
    const store = async (row: ImportRow, docType: string, doc: ZipDocument) => {
      if (!usable(row)) {
        report.rejected.push({ path: doc.path, reason: `Row ${row.rowNumber} is ${row.status.toLowerCase().replace(/_/g, ' ')}` });
        return;
      }
      if (doc.tooLarge || !doc.data) return rejectFor(row, docType, doc.path, `larger than ${env.DOCUMENT_MAX_FILE_MB} MB`);
      const type = detectFileType(doc.data);
      if (!type) return rejectFor(row, docType, doc.path, 'not a PDF, JPG or PNG file');
      if (!extensionMatches(doc.fileName, type)) {
        return rejectFor(row, docType, doc.path, `file content is ${type.ext.toUpperCase()} but the name says otherwise`);
      }

      const key = documentStorage.stagingKey(batch.code, row.sourceRecordId ?? `row-${row.rowNumber}`, `${docType}.${type.ext}`);
      const previous = await this.repo().findOne({ where: { importRowId: row.id, docType, studentId: IsNull(), isDelete: false } });
      if (previous) {
        await this.repo().update(previous.id, { isDelete: true, isActive: false });
        if (previous.storageKey !== key) await documentStorage.remove(previous.storageKey);
        report.replaced++;
      }
      await documentStorage.write(key, doc.data);
      await this.repo().save(
        this.repo().create({
          batchId,
          importRowId: row.id,
          docType,
          storageKey: key,
          sourcePath: doc.path.slice(0, 300),
          originalName: doc.fileName.slice(0, 255),
          mimeType: type.mime,
          sizeBytes: doc.data.length,
          sha256: crypto.createHash('sha256').update(doc.data).digest('hex'),
          uploadedById: actor.id,
        }),
      );
      report.stored++;

      /* The row now has this document: record it and close the matching DOC_MISSING / DOC_INVALID issues. */
      const docs = (row.data.documents ?? {}) as Record<
        string,
        { supplied: boolean; barcode: string | null; path?: string; file?: unknown }
      >;
      docs[docType] = {
        ...(docs[docType] ?? { barcode: null }),
        supplied: true,
        file: { name: doc.fileName, sourcePath: doc.path, type: type.mime, size: doc.data.length },
      };
      row.data = { ...row.data, documents: docs };
      row.issues = row.issues.filter(
        (i) => !((i.code === 'DOC_MISSING' || i.code === 'DOC_INVALID') && i.field === docField(docType) && i.status === 'OPEN'),
      );
      touched.set(row.id, row);
    };

    try {
      await readDocumentsZip(
        zip.path,
        {
          maxFiles: env.DOCUMENTS_ZIP_MAX_FILES,
          maxFileBytes: env.DOCUMENT_MAX_FILE_MB * MB,
          maxTotalBytes: env.DOCUMENTS_ZIP_MAX_MB * 4 * MB,
        },
        async (doc) => {
          /* 1. The Excel names this exact file. */
          const relative = doc.studentFolder ? zipPathKey(`${doc.studentFolder}/${doc.fileName}`) : null;
          const ref = relative ? expected.get(relative) : undefined;
          if (ref && relative) {
            found.add(relative);
            report.matchedByPath++;
            return store(ref.row, ref.docType, doc);
          }
          /* 2. Folder convention. */
          if (!doc.studentFolder) {
            report.rejected.push({
              path: doc.path,
              reason: "Files must be inside a folder named after the student's source_record_id (e.g. MA-0001/photo.jpg)",
            });
            return;
          }
          const row = bySource.get(safeSegment(doc.studentFolder).toUpperCase());
          if (!row) return void unmatched.add(doc.studentFolder);
          if (!doc.docType) {
            report.rejected.push({
              path: doc.path,
              reason: `Unknown document type "${doc.fileName}": give its path in the Excel, or name it PHOTO, SIGNATURE, AADHAAR_CARD…`,
            });
            return;
          }
          return store(row, doc.docType, doc);
        },
      );
    } catch (e) {
      if (e instanceof ZipFormatError) throw AppError.badRequest(e.message);
      throw e;
    }

    /* Files the Excel names but the ZIP does not contain stay DOC_MISSING, with a message naming the path. */
    for (const [key, ref] of expected) {
      if (found.has(key)) continue;
      if (report.missingReferenced.length < 1000) {
        report.missingReferenced.push({
          rowNumber: ref.row.rowNumber,
          sourceRecordId: ref.row.sourceRecordId,
          docType: ref.docType,
          path: ref.path,
        });
      }
      const field = docField(ref.docType);
      ref.row.issues = ref.row.issues.map((i) =>
        i.code === 'DOC_MISSING' && i.field === field && i.status === 'OPEN'
          ? { ...i, message: `${LABEL.get(ref.docType)}: "${ref.path}" was not found in ${report.zipName}` }
          : i,
      );
      touched.set(ref.row.id, ref.row);
    }

    report.unmatchedFolders = [...unmatched].sort().slice(0, 500);
    const withFiles = await this.repo()
      .createQueryBuilder('d')
      .select('COUNT(DISTINCT d.importRowId)', 'n')
      .where('d.batchId = :batchId AND d.isDelete = false AND d.studentId IS NULL', { batchId })
      .getRawOne<{ n: string }>();
    report.studentsWithFiles = Number(withFiles?.n ?? 0);

    await AppDataSource.transaction(async (m) => {
      for (const row of touched.values()) {
        importService.settleRow(row);
        await m.getRepository(ImportRowEntity).save(row);
      }
      await m.getRepository(ImportBatchEntity).update(batch.id, { documentsReport: report as never });
      await importService.refreshBatch(batchId, m);
    });
    await auditService.record(req, {
      action: 'import.documents.uploaded',
      resource: 'import_batch',
      resourceId: batchId,
      details: {
        code: batch.code,
        zip: report.zipName,
        stored: report.stored,
        matchedByPath: report.matchedByPath,
        replaced: report.replaced,
        rejected: report.rejected.length,
        unmatched: report.unmatchedFolders.length,
        missingReferenced: report.missingReferenced.length,
      },
    });
    return importService.getBatch(batchId);
  }

  /*
   * Finalisation (inside the import transaction): every staged document of a finalised row moves to its
   * student's folder, students/<STU-code>/<TYPE>.<ext>. Files are copied, not moved, so a rollback leaves the
   * staging area intact; the returned undo() removes the copies, commit() clears the staging folder.
   */
  async promote(
    m: EntityManager,
    batch: ImportBatch,
    rows: ImportRow[],
  ): Promise<{ commit: () => Promise<void>; undo: () => Promise<void> }> {
    const ops: FileOp[] = [];
    const undo = async () => {
      for (const op of ops.reverse()) {
        try {
          if (op.kind === 'copy') await documentStorage.remove(op.to);
          else await documentStorage.move(op.to, op.from);
        } catch (err) {
          logger.error({ err, op }, 'could not undo a document file operation');
        }
      }
    };
    try {
      const studentByRow = new Map(rows.filter((r) => r.studentId).map((r) => [r.id, r.studentId!]));
      if (studentByRow.size) {
        const staged = await m
          .getRepository(StudentDocument)
          .find({ where: { importRowId: In([...studentByRow.keys()]), studentId: IsNull(), isDelete: false } });
        const students = await m.getRepository(Student).find({ where: { id: In([...new Set(studentByRow.values())]) } });
        const codeOf = new Map(students.map((s) => [s.id, s.code]));
        for (const doc of staged) {
          const studentId = studentByRow.get(doc.importRowId!)!;
          const code = codeOf.get(studentId)!;
          const target = documentStorage.studentKey(code, `${doc.docType}.${doc.storageKey.split('.').pop()}`);
          /* A linked (same person) student may already have this document: keep the earlier version under _replaced/. */
          const current = await m.getRepository(StudentDocument).findOne({ where: { studentId, docType: doc.docType, isDelete: false } });
          if (current) {
            const archived = documentStorage.replacedKey(code, current.storageKey.split('/').pop()!);
            if (await documentStorage.exists(current.storageKey)) {
              await documentStorage.move(current.storageKey, archived);
              ops.push({ kind: 'move', from: current.storageKey, to: archived });
            }
            await m.getRepository(StudentDocument).update(current.id, { isDelete: true, isActive: false, storageKey: archived });
          }
          await documentStorage.copy(doc.storageKey, target);
          ops.push({ kind: 'copy', to: target });
          await m.getRepository(StudentDocument).update(doc.id, { studentId, storageKey: target });
        }
      }
    } catch (err) {
      await undo();
      throw err;
    }
    return { undo, commit: () => this.discardStaging(batch.code) };
  }

  /* Removes a batch's staging folder (after finalisation, or when the batch is cancelled). */
  async discardStaging(batchCode: string): Promise<void> {
    await documentStorage
      .removeTree(`imports/${safeSegment(batchCode)}`)
      .catch((err) => logger.error({ err, batchCode }, 'could not remove staging folder'));
  }

  async listForStudent(studentId: string): Promise<StudentDocumentDto[]> {
    const docs = await this.repo().find({ where: { studentId, isDelete: false }, order: { docType: 'ASC' } });
    return docs.map(toDto);
  }

  async listForRow(batchId: string, importRowId: string): Promise<StudentDocumentDto[]> {
    const docs = await this.repo().find({
      where: { batchId, importRowId, studentId: IsNull(), isDelete: false },
      order: { docType: 'ASC' },
    });
    return docs.map(toDto);
  }

  /* A staged document, for reviewers checking a row before finalisation (audited like any download). */
  async openStaged(batchId: string, importRowId: string, documentId: string, req?: Request) {
    const doc = await this.repo().findOne({ where: { id: documentId, batchId, importRowId, studentId: IsNull(), isDelete: false } });
    if (!doc || !(await documentStorage.exists(doc.storageKey))) throw AppError.notFound(MESSAGES.notFound('Document'));
    await auditService.record(req, {
      action: 'import.document.downloaded',
      resource: 'import_row',
      resourceId: importRowId,
      details: { documentId, docType: doc.docType },
    });
    return {
      stream: await documentStorage.read(doc.storageKey),
      mimeType: doc.mimeType,
      fileName: `${doc.docType}.${doc.storageKey.split('.').pop()}`,
    };
  }

  /* Opens a student's document for download; every download is audited (spec candidate.document.downloaded). */
  async openForDownload(studentId: string, documentId: string, req?: Request) {
    const doc = await this.repo().findOne({ where: { id: documentId, studentId, isDelete: false } });
    if (!doc || !(await documentStorage.exists(doc.storageKey))) throw AppError.notFound(MESSAGES.notFound('Document'));
    await auditService.record(req, {
      action: 'student.document.downloaded',
      resource: 'student',
      resourceId: studentId,
      details: { documentId, docType: doc.docType },
    });
    const ext = doc.storageKey.split('.').pop();
    return { stream: await documentStorage.read(doc.storageKey), mimeType: doc.mimeType, fileName: `${doc.docType}.${ext}` };
  }
}

export const documentService = new DocumentService();
