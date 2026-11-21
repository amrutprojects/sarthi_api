/*
 * Public API of the lms-reads module (M1: the Panel reads its LMS data through the LMS tenant API /tenant/v1). The
 * router is mounted by the composition root (src/routes.ts) and is not exported here (`npm run check:boundaries`).
 */
export { lmsReadsService, LmsReadsService, type LmsReadsSettings, type LmsReadsStatus } from './lms-reads.service';
export { createTenantReadClient, LmsReadError, type TenantReadClient, type TenantRead } from './tenant-read-client';
export { LMS_READ_PERMISSIONS, LMS_TENANT_READS } from './lms-reads.constants';
/* M3 attendance reports (src/modules/attendance-reports) read through this service. */
export type { LmsReadResult } from './lms-reads.service';
export type { LmsAttendance, LmsAttendanceRow, LmsBatch } from './lms-reads.mappers';
