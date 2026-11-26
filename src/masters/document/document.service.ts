import type { Request } from 'express';
import type { FileHandle } from 'fs/promises';
import type { EntityManager } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { AppDataSource } from '../../config/database.config';
import { AUDIT_ACTIONS } from '../../shared/constants/app.constants';
import { auditService } from '../../modules/audit';
import { AppError } from '../../shared/errors/app-error';
import type { Paginated } from '../../shared/utils/pagination';
import { District } from '../../cms/masters/district/district.model';
import { assertUsableRef, lockForUpdate } from '../shared/master-refs';
import { State } from '../../cms/masters/state/state.model';
import { TrainingCentre } from '../training-centre/training-centre.model';
import { MasterDocument } from './document.model';
import { documentRepository, type DocumentRow } from './document.repository';
import { discardStoredFile, displayFileName, fileError, isDocumentMimeType, openStoredFile, storeUpload } from './document.storage';
import type {
  CreateDocumentInput, DocumentListQuery, PublicDocumentDetail, StoredDocumentFile, UpdateDocumentInput, UploadedFile,
  VerifyDocumentInput,
} from './document.types';
import { assertNoDependencies } from '../../shared/dependencies/dependencies';
import { DOCUMENT_DEPENDENCIES } from '../masters.dependencies';

/* Requires the district / centre / user joins (every read path in DocumentRepository makes them). The storage key never leaves the server. */
const toPublic = (d: DocumentRow): PublicDocumentDetail => ({
  id: d.id,
  title: d.title,
  category: d.category,
  description: d.description,
  districtId: d.districtId,
  districtName: d.district?.name ?? null,
  districtCode: d.district?.code ?? null,
  districtIsActive: d.district ? d.district.isActive : null,
  stateId: d.district?.stateId ?? null,
  stateName: d.district?.state?.name ?? null,
  stateCode: d.district?.state?.code ?? null,
  stateIsActive: d.district?.state ? d.district.state.isActive : null,
  centreId: d.centreId,
  centreName: d.centre?.name ?? null,
  centreCode: d.centre?.code ?? null,
  centreIsActive: d.centre ? d.centre.isActive : null,
  fileName: displayFileName(d.fileName, d.mimeType),
  mimeType: d.mimeType,
  fileSize: d.fileSize,
  sha256: d.sha256,
  uploadedById: d.uploadedById,
  uploadedByName: d.uploadedBy?.name ?? null,
  verificationStatus: d.verificationStatus,
  verificationReason: d.verificationReason,
  verifiedById: d.verifiedById,
  verifiedByName: d.verifiedBy?.name ?? null,
  verifiedAt: d.verifiedAt,
  isActive: d.isActive,
  createdAt: d.createdAt,
  updatedAt: d.updatedAt,
});

/* Columns that put a document back to "not yet verified". */
const PENDING_AGAIN = { verificationStatus: 'PENDING', verificationReason: null, verifiedById: null, verifiedAt: null } as const;

/* File facts worth keeping in the audit log (the key identifies the exact bytes on disk). */
const fileAudit = (f: Pick<StoredDocumentFile, 'fileName' | 'fileSize' | 'sha256' | 'storageKey'>) => ({
  fileName: f.fileName,
  fileSize: f.fileSize,
  sha256: f.sha256,
  storageKey: f.storageKey,
});

/*
 * Document Master (AMRUT_KALASH_02 Table 56).
 *
 * The file is written to private storage before the database transaction (a large write must not hold a
 * transaction open) and removed again if the transaction fails, so a failed request leaves neither a row
 * without a file nor a stray file. Replacing a file keeps the previous one on disk: it is the evidence
 * behind the earlier verification, and the audit log records which key it was.
 *
 * Verification is a separate, permissioned step (cms-documents.approve) that the uploader may not take on
 * their own document. Replacing the file always resets it to PENDING.
 */
export class DocumentService {
  async list(q: DocumentListQuery): Promise<Paginated<PublicDocumentDetail>> {
    /* A filter naming an unknown parent is a client error, not an empty list that looks like real data. */
    if (q.stateId && !(await documentRepository.refExists(State, q.stateId))) {
      throw AppError.badRequest('The selected state does not exist', [{ field: 'stateId', message: 'Unknown state' }]);
    }
    if (q.districtId && !(await documentRepository.refExists(District, q.districtId))) {
      throw AppError.badRequest('The selected district does not exist', [{ field: 'districtId', message: 'Unknown district' }]);
    }
    if (q.centreId && !(await documentRepository.refExists(TrainingCentre, q.centreId))) {
      throw AppError.badRequest('The selected training centre does not exist', [{ field: 'centreId', message: 'Unknown training centre' }]);
    }
    const page = await documentRepository.list(q);
    return { items: page.items.map(toPublic), meta: page.meta };
  }

  async get(id: string): Promise<PublicDocumentDetail> {
    const document = await documentRepository.findByIdWithRefs(id);
    if (!document) throw AppError.notFound('Document not found');
    return toPublic(document);
  }

  /* The district and the centre are optional; when given they must exist, not be deleted, and be active. */
  private async assertRefs(m: EntityManager, refs: { districtId?: string | null; centreId?: string | null }): Promise<void> {
    if (refs.districtId) await assertUsableRef(m, District, refs.districtId, 'districtId', 'district');
    if (refs.centreId) await assertUsableRef(m, TrainingCentre, refs.centreId, 'centreId', 'training centre');
  }

  async create(input: CreateDocumentInput, file: UploadedFile | undefined, req?: Request): Promise<PublicDocumentDetail> {
    if (!file) throw fileError('Attach the document file (PDF, JPG or PNG)');
    const stored = await storeUpload(file);
    let id: string;
    try {
      id = await AppDataSource.transaction(async (m) => {
        await this.assertRefs(m, input);
        const document = await documentRepository.create(
          {
            title: input.title,
            category: input.category,
            description: input.description ?? null,
            districtId: input.districtId ?? null,
            centreId: input.centreId ?? null,
            ...stored,
            uploadedById: req?.auth?.id ?? null,
            ...PENDING_AGAIN,
            isActive: input.isActive ?? true,
          },
          m,
        );
        await auditService.recordInTx(m, req, {
          action: AUDIT_ACTIONS.DOCUMENT_CREATE,
          resource: 'document',
          resourceId: document.id,
          details: { title: document.title, category: document.category, ...fileAudit(stored), isActive: document.isActive },
        });
        return document.id;
      });
    } catch (err) {
      await discardStoredFile(stored.storageKey);
      throw err;
    }
    return this.get(id);
  }

  async update(id: string, input: UpdateDocumentInput, file: UploadedFile | undefined, req?: Request): Promise<PublicDocumentDetail> {
    const stored = file ? await storeUpload(file) : null;
    try {
      await AppDataSource.transaction(async (m) => {
        /* Locked, so a verification running at the same time lands either before this change or after it, never on a stale read. */
        const document = await lockForUpdate(m, MasterDocument, id);
        if (!document) throw AppError.notFound('Document not found');

        /* Re-checked only when the link changes: an unchanged link to a since-deactivated parent may stay. */
        await this.assertRefs(m, {
          districtId: input.districtId !== document.districtId ? input.districtId : undefined,
          centreId: input.centreId !== document.centreId ? input.centreId : undefined,
        });

        const patch: QueryDeepPartialEntity<MasterDocument> = { ...input };
        if (stored) Object.assign(patch, stored, { uploadedById: req?.auth?.id ?? null }, PENDING_AGAIN);
        await documentRepository.update(id, patch, m);
        await auditService.recordInTx(m, req, {
          action: AUDIT_ACTIONS.DOCUMENT_UPDATE,
          resource: 'document',
          resourceId: id,
          details: {
            fields: Object.keys(input),
            from: { title: document.title, category: document.category, districtId: document.districtId, centreId: document.centreId },
            fileReplaced: stored
              ? { previous: fileAudit(document), current: fileAudit(stored), previousVerification: document.verificationStatus }
              : undefined,
          },
        });
      });
    } catch (err) {
      if (stored) await discardStoredFile(stored.storageKey);
      throw err;
    }
    return this.get(id);
  }

  /* Deactivation is never blocked: an inactive document is kept but cannot be verified until reactivated. */
  async setStatus(id: string, isActive: boolean, req?: Request): Promise<PublicDocumentDetail> {
    await AppDataSource.transaction(async (m) => {
      const document = await documentRepository.findById(id, { manager: m });
      if (!document) throw AppError.notFound('Document not found');
      await documentRepository.update(id, { isActive }, m);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.DOCUMENT_STATUS,
        resource: 'document',
        resourceId: id,
        details: { isActive, title: document.title },
      });
    });
    return this.get(id);
  }

  /*
   * Verify or reject. Only an active, non-deleted document; only the exact file the approver reviewed (the
   * sha256 their page showed); never by the person who uploaded the current file (four-eyes). The decision,
   * who took it and when are recorded on the row and in the audit log.
   *
   * The row is read FOR UPDATE, so every check runs on the row the decision is written to: a file
   * replacement or a deactivation that commits first is seen here (the replaced file then fails the sha256
   * check, a new uploader the four-eyes check), and one that starts later waits and then resets to PENDING.
   */
  async verify(id: string, input: VerifyDocumentInput, req: Request): Promise<PublicDocumentDetail> {
    const actorId = req.auth?.id;
    if (!actorId) throw AppError.unauthorized();
    await AppDataSource.transaction(async (m) => {
      const document = await lockForUpdate(m, MasterDocument, id);
      if (!document) throw AppError.notFound('Document not found');
      if (document.sha256 !== input.sha256) {
        throw AppError.conflict('The file has changed since you opened it; reload and review it again');
      }
      if (!document.isActive) throw AppError.conflict('An inactive document cannot be verified. Activate it first.');
      if (document.uploadedById === actorId) throw AppError.forbidden('The uploader cannot verify this document');
      await documentRepository.update(
        id,
        { verificationStatus: input.status, verificationReason: input.reason ?? null, verifiedById: actorId, verifiedAt: new Date() },
        m,
      );
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.DOCUMENT_VERIFY,
        resource: 'document',
        resourceId: id,
        details: {
          status: input.status,
          from: document.verificationStatus,
          reason: input.reason ?? null,
          title: document.title,
          /* The locked row's hash: the exact file this decision covers. */
          sha256: document.sha256,
        },
      });
    });
    return this.get(id);
  }

  /* Soft-deletes the document (isDelete = true, isActive = false). The row and the file are kept for audit history. */
  async remove(id: string, req?: Request): Promise<void> {
    await AppDataSource.transaction(async (m) => {
      const document = await documentRepository.findById(id, { manager: m });
      if (!document) throw AppError.notFound('Document not found');
      await assertNoDependencies(DOCUMENT_DEPENDENCIES, id, m);
      await documentRepository.softDelete(id, m);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.DOCUMENT_DELETE,
        resource: 'document',
        resourceId: id,
        details: { title: document.title, category: document.category, ...fileAudit(document) },
      });
    });
  }

  /* Brings a soft-deleted document back, inactive. Refused when its district or centre is no longer usable. */
  async restore(id: string, req?: Request): Promise<PublicDocumentDetail> {
    await AppDataSource.transaction(async (m) => {
      const existing = await documentRepository.findByIdIncludingDeleted(id, m);
      if (!existing) throw AppError.notFound('Document not found');
      if (!existing.isDelete) throw AppError.conflict('Document is not deleted');
      /* The district or centre may have been deactivated or deleted while this row was gone. */
      await this.assertRefs(m, existing);
      await documentRepository.restore(id, m);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.DOCUMENT_RESTORE,
        resource: 'document',
        resourceId: id,
        details: { title: existing.title },
      });
    });
    return this.get(id);
  }

  /*
   * The stored file of a non-deleted document, opened for streaming. The path comes only from the stored key,
   * and the suggested name always ends in an extension of the stored type (displayFileName).
   */
  async openFile(id: string): Promise<{ handle: FileHandle; size: number; fileName: string; mimeType: string }> {
    const document = await documentRepository.findById(id);
    if (!document) throw AppError.notFound('Document not found');
    /* Only a type this module writes is served; anything else on the row is tampering, like a foreign storage key. */
    if (!isDocumentMimeType(document.mimeType)) throw AppError.notFound('The file of this document is missing');
    const { handle, size } = await openStoredFile(document.storageKey);
    return { handle, size, fileName: displayFileName(document.fileName, document.mimeType), mimeType: document.mimeType };
  }
}

export const documentService = new DocumentService();
