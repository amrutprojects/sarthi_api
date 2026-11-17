import { Router } from 'express';
import { P } from '../../modules/roles-permissions/permission.constants';
import { authorizePermission } from '../../middleware/authorize-permission.middleware';
import { validateRequest } from '../../middleware/validate-request.middleware';
import { programmeController } from './programme.controller';
import { programmeFactVisibilitySchema, programmeStatusSchema, updateProgrammePageSchema } from './programme.validator';

/*
 * /api/v1/cms/programme — Programme Page Management.
 *
 * authenticate() is applied once by the parent CMS router; each route declares its permission. No POST and no
 * DELETE: the page is a database-enforced singleton created by the seed. PUT replaces the whole page; PATCH /status
 * changes only visibility; PATCH /facts/:key shows or hides one fact sheet row (its own two-segment path, so neither
 * it nor /status can match the other).
 */
export const programmeRouter = Router();

programmeRouter.get('/', authorizePermission(P.CMS_PROGRAMME_VIEW), programmeController.get);
programmeRouter.put(
  '/',
  authorizePermission(P.CMS_PROGRAMME_UPDATE),
  validateRequest(updateProgrammePageSchema),
  programmeController.update,
);
programmeRouter.patch(
  '/status',
  authorizePermission(P.CMS_PROGRAMME_UPDATE),
  validateRequest(programmeStatusSchema),
  programmeController.setPublished,
);
programmeRouter.patch(
  '/facts/:key',
  authorizePermission(P.CMS_PROGRAMME_UPDATE),
  validateRequest(programmeFactVisibilitySchema),
  programmeController.setFactVisibility,
);
