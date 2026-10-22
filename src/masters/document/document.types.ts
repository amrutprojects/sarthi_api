import type { ListQuery } from '../../shared/utils/pagination';
import type { DocumentCategory, VerificationStatus } from '../shared/master.constants';

/* Columns a client may sort by (?sortBy=). Anything else is rejected by the validator. */
export type DocumentSortField = 'title' | 'category' | 'verificationStatus' | 'fileSize' | 'createdAt' | 'updatedAt';

export interface DocumentListQuery extends ListQuery<DocumentSortField> {
  category?: DocumentCategory;
  verificationStatus?: VerificationStatus;
  /* Optional parent filters; ?centreId= is also the deep link from a training centre. */
  /* State of the document's own district (the parent of the District filter); a centre-only document has none. */
  stateId?: string;
  districtId?: string;
  centreId?: string;
}

/* The file types a document may be: detected from the file content, never from the client's claim. */
export type DocumentMimeType = 'application/pdf' | 'image/png' | 'image/jpeg';

/*
 * API shape of a document. The entity itself is never serialised: the storage key (where the file lives on
 * disk) stays server-side, and the linked district, centre and users are resolved to their names so no
 * client has to display a raw id.
 */
export interface PublicDocumentDetail {
  id: string;
  title: string;
  category: DocumentCategory;
  description: string | null;
  districtId: string | null;
  districtName: string | null;
  districtCode: string | null;
  districtIsActive: boolean | null;
  /* State of the linked district, so an edit form can start its State -> District cascade on it. */
  stateId: string | null;
  stateName: string | null;
  stateCode: string | null;
  stateIsActive: boolean | null;
  centreId: string | null;
  centreName: string | null;
  centreCode: string | null;
  centreIsActive: boolean | null;
  fileName: string;
  mimeType: string;
  fileSize: number;
  sha256: string;
  uploadedById: string | null;
  uploadedByName: string | null;
  verificationStatus: VerificationStatus;
  verificationReason: string | null;
  verifiedById: string | null;
  verifiedByName: string | null;
  verifiedAt: Date | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/* The part of a multer file this module reads (memory storage). */
export interface UploadedFile {
  buffer: Buffer;
  originalname: string;
  size: number;
}

/* File metadata recorded on the row once the upload is checked and written to private storage. */
export interface StoredDocumentFile {
  fileName: string;
  mimeType: DocumentMimeType;
  fileSize: number;
  sha256: string;
  storageKey: string;
}

export interface CreateDocumentInput {
  title: string;
  category: DocumentCategory;
  description?: string | null;
  districtId?: string | null;
  centreId?: string | null;
  isActive?: boolean;
}

export interface UpdateDocumentInput {
  title?: string;
  category?: DocumentCategory;
  description?: string | null;
  districtId?: string | null;
  centreId?: string | null;
}

export interface VerifyDocumentInput {
  status: Exclude<VerificationStatus, 'PENDING'>;
  reason?: string | null;
  /* Hash of the file the approver reviewed; the decision is refused (409) when the current file differs. */
  sha256: string;
}
