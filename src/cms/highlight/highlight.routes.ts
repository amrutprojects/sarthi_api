import { Router } from 'express';
import { P } from '../../modules/roles-permissions/permission.constants';
import { authorizePermission } from '../../middleware/authorize-permission.middleware';
import { validateRequest } from '../../middleware/validate-request.middleware';
import { highlightController } from './highlight.controller';
import {
  highlightStatusSchema,
  updateHighlightRowSchema,
  updateHighlightSchema,
} from './highlight.validator';

/*
 * /api/v1/cms/highlight — the home page's programme section.
 *
 * authenticate() is applied once by the parent CMS router, and each route declares the permission
 * it needs. No POST and no DELETE: the section is a database-enforced singleton created by the
 * seed. PUT replaces it whole, which is what the admin screen submits; PATCH /status changes only
 * visibility; PATCH /rows/:key shows, hides or renames one fact table row (its own two-segment path,
 * so neither it nor /status can match the other).
 */
export const highlightRouter = Router();

highlightRouter.get('/', authorizePermission(P.CMS_HIGHLIGHT_VIEW), highlightController.get);
highlightRouter.put(
  '/',
  authorizePermission(P.CMS_HIGHLIGHT_UPDATE),
  validateRequest(updateHighlightSchema),
  highlightController.update,
);
highlightRouter.patch(
  '/status',
  authorizePermission(P.CMS_HIGHLIGHT_UPDATE),
  validateRequest(highlightStatusSchema),
  highlightController.setPublished,
);
highlightRouter.patch(
  '/rows/:key',
  authorizePermission(P.CMS_HIGHLIGHT_UPDATE),
  validateRequest(updateHighlightRowSchema),
  highlightController.setRow,
);
