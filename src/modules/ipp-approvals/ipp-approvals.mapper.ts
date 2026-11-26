import type { IppAccess } from './ipp-access';
import { approveTo, isLevel, rejectTo, STAGE_LABELS, type IppEvent, type Stage } from './ipp-approvals.constants';
import type { ApplicationDetailRow, ApplicationListRow, BatchListRow, EventRow } from './ipp-approvals.repository';

/* The shapes of docs/ipp-approvals.md; nothing else leaves the module. */
export interface EventDto {
  event: IppEvent;
  from: Stage | null;
  to: Stage;
  reason: string | null;
  by: string;
  role: string | null;
  at: string;
}

export interface ApplicationRowDto {
  id: string;
  registrationId: string;
  registrationNumber: string | null;
  name: string;
  mobile: string;
  email: string;
  district: { id: string; name: string };
  category: string | null;
  centre: string | null;
  technology: string | null;
  stage: Stage;
  stageLabel: string;
  stageUpdatedAt: string;
  batch: { id: string; code: string; name: string };
  documents: { uploaded: number; verified: number };
  lastEvent: EventDto | null;
  canDecide: boolean;
  /* Mine to decide now, and decided at this level before: approving it again needs a reason. */
  reasonRequired: boolean;
}

export interface ApplicationDetailDto extends ApplicationRowDto {
  aadhaarMasked: string | null;
  formDistrict: string | null;
  submittedAt: string;
  /* The Auditor's approval in IPP, with its reason (null for one approved before reasons were asked). */
  auditor: { approvedAt: string | null; by: string | null; reason: string | null };
  fields: { key: string; step: 1 | 2; labelEn: string; labelMr: string; type: string; text: string }[];
  documentList: {
    code: string;
    name: string;
    nameMr: string | null;
    required: boolean;
    kind: 'DOCUMENT' | 'VIDEO';
    file: { name: string; mime: string; size: number; uploadedAt: string } | null;
    verified: boolean;
    verifiedAt: string | null;
    verifiedBy: string | null;
  }[];
  edits: { at: string; by: string | null; changes: { key: string; label: string; from: string; to: string }[] }[];
  history: EventDto[];
  approveTo: { stage: Stage; label: string } | null;
  rejectTo: { stage: Stage; label: string } | null;
}

export interface BatchRowDto {
  id: string;
  code: string;
  name: string;
  district: { id: string; name: string };
  centre: { code: string; name: string };
  size: number;
  startDate: string | null;
  endDate: string | null;
  deliveryMode: 'OFFLINE' | 'ONLINE' | 'BLENDED';
  technology: string | null;
  sentBy: string | null;
  receivedAt: string;
  students: number;
  stages: Record<Stage, number>;
  toDecide: number;
}

const iso = (v: Date | string): string => new Date(v).toISOString();
const isoOrNull = (v: Date | string | null): string | null => (v === null ? null : iso(v));
const target = (stage: Stage) => ({ stage, label: STAGE_LABELS[stage] });

export const toEventDto = (e: Omit<EventRow, 'at'> & { at: Date | string }): EventDto => ({
  event: e.event,
  from: e.from,
  to: e.to,
  reason: e.reason,
  by: e.by,
  role: e.role,
  at: iso(e.at),
});

export const toApplicationRowDto = (r: ApplicationListRow): ApplicationRowDto => ({
  id: r.id,
  registrationId: r.registrationId,
  registrationNumber: r.registrationNumber,
  name: r.name,
  mobile: r.mobile,
  email: r.email,
  district: { id: r.districtId, name: r.districtName },
  category: r.category,
  centre: r.centre,
  technology: r.technology,
  stage: r.stage,
  stageLabel: STAGE_LABELS[r.stage],
  stageUpdatedAt: iso(r.stageUpdatedAt),
  batch: { id: r.batchId, code: r.batchCode, name: r.batchName },
  documents: { uploaded: r.documents.filter((d) => d.file).length, verified: r.documents.filter((d) => d.verified).length },
  lastEvent: r.lastEvent ? toEventDto(r.lastEvent) : null,
  canDecide: r.canDecide,
  reasonRequired: r.canDecide && r.decidedHere,
});

export function toApplicationDetailDto(r: ApplicationDetailRow, history: EventRow[], headOffice: boolean): ApplicationDetailDto {
  const level = r.canDecide && isLevel(r.stage) ? r.stage : null;
  return {
    ...toApplicationRowDto(r),
    aadhaarMasked: r.aadhaarMasked,
    formDistrict: r.formDistrict,
    submittedAt: iso(r.submittedAt),
    auditor: { approvedAt: isoOrNull(r.auditorApprovedAt), by: r.auditorApprovedBy, reason: r.auditorApprovalReason },
    fields: r.fields.map((f) => ({ key: f.key, step: f.step, labelEn: f.label_en, labelMr: f.label_mr, type: f.type, text: f.text })),
    documentList: r.documents.map((d) => ({
      code: d.code,
      name: d.name,
      nameMr: d.name_mr,
      required: d.required,
      kind: d.kind,
      file: d.file ? { name: d.file.name, mime: d.file.mime, size: d.file.size, uploadedAt: d.file.uploaded_at } : null,
      verified: d.verified,
      verifiedAt: d.verified_at,
      verifiedBy: d.verified_by,
    })),
    edits: r.edits.map((e) => ({
      at: e.at,
      by: e.by,
      changes: e.changes.map((c) => ({ key: c.key, label: c.label, from: c.from, to: c.to })),
    })),
    history: history.map(toEventDto),
    approveTo: level ? target(approveTo(level, headOffice)) : null,
    rejectTo: level ? target(rejectTo(level)) : null,
  };
}

export const toBatchRowDto = (b: BatchListRow): BatchRowDto => ({
  id: b.id,
  code: b.code,
  name: b.name,
  district: { id: b.districtId, name: b.districtName },
  centre: { code: b.centreCode, name: b.centreName },
  size: b.size,
  startDate: b.startDate,
  endDate: b.endDate,
  deliveryMode: b.deliveryMode,
  technology: b.technologyName,
  sentBy: b.sentBy,
  receivedAt: iso(b.receivedAt),
  students: b.students,
  stages: b.stages,
  toDecide: b.toDecide,
});

/* The access a page is drawn with (GET /summary). */
export interface SummaryDto {
  stages: IppAccess['decides'];
  districts: { id: string; name: string }[] | null;
  headOfficeEnabled: boolean;
  toDecide: number;
  sentBack: number;
  counts: Record<Stage, number>;
}
