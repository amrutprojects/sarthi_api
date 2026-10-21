/*
 * Fixed value lists of the CMS masters. Each list is also a CHECK constraint in the CmsMasters migration,
 * so adding a value means a migration as well as a change here.
 */

/* Batch Master (F-ADM-30-06 / F-LMS-12-11). */
export const DELIVERY_MODES = ['OFFLINE', 'ONLINE', 'BLENDED'] as const;
export type DeliveryMode = (typeof DELIVERY_MODES)[number];

/* Batch lifecycle (F-ADM-30-07). Separate from isActive, which only controls whether the batch is offered. */
export const BATCH_STATUSES = ['PLANNED', 'OPEN', 'FULL', 'CLOSED', 'CANCELLED'] as const;
export type BatchStatus = (typeof BATCH_STATUSES)[number];

/* Assign Batch reason codes (F-ADM-31-03). */
export const ASSIGNMENT_REASONS = ['PREFERRED_CENTRE_FULL', 'CANDIDATE_REQUEST', 'PROGRAMME_DECISION', 'OTHER'] as const;
export type AssignmentReason = (typeof ASSIGNMENT_REASONS)[number];

/* Document Master categories (F-ADM-51-02). */
export const DOCUMENT_CATEGORIES = [
  'CENTRE_PROFILE', 'AGREEMENT', 'APPROVAL_LETTER', 'CERTIFICATE', 'REPORT', 'FINANCE', 'PHOTO_EVIDENCE', 'OTHER',
] as const;
export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];

export const VERIFICATION_STATUSES = ['PENDING', 'VERIFIED', 'REJECTED'] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

/* Location Information parking (F-ADM-CEN-21). */
export const PARKING_OPTIONS = ['YES', 'NO', 'LIMITED'] as const;
export type ParkingOption = (typeof PARKING_OPTIONS)[number];

/* Capacity & Infrastructure: the 20 facilities of F-ADM-CEN-15, each Yes / No / To be confirmed + remarks. */
export const FACILITY_CODES = [
  'TRAINING_CLASSROOMS', 'COMPUTER_LAB', 'INTERNET', 'WIFI', 'AIR_CONDITIONING', 'POWER_BACKUP_UPS', 'GENERATOR',
  'LIFT', 'WASHROOMS', 'DRINKING_WATER', 'RECEPTION', 'WAITING_AREA', 'PROJECTOR_DISPLAY', 'AUDIO_SYSTEM', 'SEATING',
  'COMPUTER_SYSTEMS', 'PRINTING_SCANNING', 'CCTV_SECURITY', 'FIRST_AID', 'ACCESSIBILITY',
] as const;
export type FacilityCode = (typeof FACILITY_CODES)[number];

export const FACILITY_AVAILABILITY = ['YES', 'NO', 'TBC'] as const;
export type FacilityAvailability = (typeof FACILITY_AVAILABILITY)[number];

export type FacilityMap = Partial<Record<FacilityCode, { availability: FacilityAvailability; remarks: string | null }>>;
