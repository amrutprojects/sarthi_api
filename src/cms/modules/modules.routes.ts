import { Router } from 'express';
import { P } from '../../modules/roles-permissions/permission.constants';
import { authorizePermission } from '../../middleware/authorize-permission.middleware';
import { validateRequest } from '../../middleware/validate-request.middleware';
import { modulesController } from './modules.controller';
import { updateModulesPageSchema } from './modules.validator';

/*
 * /api/v1/cms/modules — Modules Page Management.
 *
 * authenticate() is applied once by the parent CMS router, and each route declares the permission
 * it needs, so a signed-in user without the CMS codes gets a 403 that authorizePermission also
 * writes to the audit log.
 *
 * No POST and no DELETE: the page is a database-enforced singleton created by the seed. PUT
 * replaces the whole page (hours, module cards and elective domains) in one transaction, which is
 * what the admin screen submits.
 *
 * No PATCH /status either: unlike the other CMS pages, the Modules page has no publish switch.
 * The website always shows what is saved here.
 */
export const modulesRouter = Router();

modulesRouter.get('/', authorizePermission(P.CMS_MODULES_VIEW), modulesController.get);
modulesRouter.put('/', authorizePermission(P.CMS_MODULES_UPDATE), validateRequest(updateModulesPageSchema), modulesController.update);
