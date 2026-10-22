/*
 * Public API of the lms-access module (LMS roles and Admin Panel sign-in for the LMS). Routers are mounted by the
 * composition root (src/routes.ts) and are not exported here (checked by `npm run check:boundaries`).
 */
export * from './lms-access.service';
export * from './lms-catalogue';
export * from './role-lms-permission.entity';
export { LMS_CLIENT_ID, sign as signLmsRequest } from './integration-signature';
