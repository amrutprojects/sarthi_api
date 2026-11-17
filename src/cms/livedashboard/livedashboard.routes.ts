import { Router } from 'express';
import { P } from '../../modules/roles-permissions/permission.constants';
import { authorizePermission } from '../../middleware/authorize-permission.middleware';
import { validateRequest } from '../../middleware/validate-request.middleware';
import { idempotent } from '../../shared/idempotency/idempotency.middleware';
import { liveDashboardController } from './livedashboard.controller';
import {
  createCardSchema,
  createStatSchema,
  reorderCardsSchema,
  reorderStatsSchema,
  rowIdSchema,
  rowStatusSchema,
  updateCardSchema,
  updateDistrictSchema,
  updateSettingsSchema,
  updateStatSchema,
} from './livedashboard.validator';

/*
 * /api/v1/cms/live-dashboard — "Live Dashboard" (the home page's "Programme Progress – Live
 * Dashboard": its settings, KPI cards, side figures and district figures).
 *
 * authenticate() is applied once by the parent CMS router, and each route declares the permission it
 * needs. Adding a card or a figure honours the Idempotency-Key header (ADR-0005), so a retried or
 * double-submitted form replays the first response instead of adding it twice.
 *
 * Whether the whole section is shown is the "Show on website" switch,
 * /cms/section-visibility/live-dashboard. The static paths (/order) are declared before /:id so they
 * are never taken for an id.
 */
export const liveDashboardRouter = Router();
const { cards, stats } = liveDashboardController;

liveDashboardRouter.get('/settings', authorizePermission(P.CMS_LIVEDASHBOARD_VIEW), liveDashboardController.getSettings);
liveDashboardRouter.put(
  '/settings',
  authorizePermission(P.CMS_LIVEDASHBOARD_UPDATE),
  validateRequest(updateSettingsSchema),
  liveDashboardController.updateSettings,
);

/* The same seven routes for each ordered list. */
for (const [path, h, createSchema, updateSchema, reorderSchema] of [
  ['/cards', cards, createCardSchema, updateCardSchema, reorderCardsSchema],
  ['/stats', stats, createStatSchema, updateStatSchema, reorderStatsSchema],
] as const) {
  liveDashboardRouter.get(path, authorizePermission(P.CMS_LIVEDASHBOARD_VIEW), h.list);
  liveDashboardRouter.post(path, authorizePermission(P.CMS_LIVEDASHBOARD_CREATE), validateRequest(createSchema), idempotent, h.create);
  liveDashboardRouter.put(`${path}/order`, authorizePermission(P.CMS_LIVEDASHBOARD_UPDATE), validateRequest(reorderSchema), h.reorder);
  liveDashboardRouter.get(`${path}/:id`, authorizePermission(P.CMS_LIVEDASHBOARD_VIEW), validateRequest(rowIdSchema), h.get);
  liveDashboardRouter.patch(`${path}/:id`, authorizePermission(P.CMS_LIVEDASHBOARD_UPDATE), validateRequest(updateSchema), h.update);
  liveDashboardRouter.patch(
    `${path}/:id/status`,
    authorizePermission(P.CMS_LIVEDASHBOARD_UPDATE),
    validateRequest(rowStatusSchema),
    h.setStatus,
  );
  liveDashboardRouter.delete(`${path}/:id`, authorizePermission(P.CMS_LIVEDASHBOARD_DELETE), validateRequest(rowIdSchema), h.remove);
}

/* The 36 districts are fixed rows: listed and edited, never added or deleted. */
liveDashboardRouter.get('/districts', authorizePermission(P.CMS_LIVEDASHBOARD_VIEW), liveDashboardController.listDistricts);
liveDashboardRouter.patch(
  '/districts/:code',
  authorizePermission(P.CMS_LIVEDASHBOARD_UPDATE),
  validateRequest(updateDistrictSchema),
  liveDashboardController.updateDistrict,
);
