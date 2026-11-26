/*
 * Public API of the ipp-approvals module (approval of the student forms of IPP, docs/ipp-approvals.md). The routers are
 * mounted by the composition root (src/routes.ts) and are not exported here (`npm run check:boundaries`).
 */
export * from './ipp-approvals.entity';
export { ippApprovalsService } from './ipp-approvals.service';
export { ippHeadOfficeService, type HeadOfficeState } from './ipp-head-office.service';
export { kickIppLink, runIppLinkCycle, startIppLinkPoller, stopIppLinkPoller } from './ipp-outbox.runtime';
export type { ApplicationDetailDto, ApplicationRowDto, BatchRowDto } from './ipp-approvals.mapper';
export type { Stage } from './ipp-approvals.constants';
