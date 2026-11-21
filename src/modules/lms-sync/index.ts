/*
 * Public API of the lms-sync module (M1 Amrut → LMS student sync). The router is mounted by src/routes.ts and the
 * entity registered by src/database/entities.ts directly (routers are not exported from module indexes).
 */
export * from './lms-sync.constants';
export * from './student-lms-link.entity';
export { startLmsSyncPoller, stopLmsSyncPoller, triggerLmsSync } from './lms-sync.runtime';
