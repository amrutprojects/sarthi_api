import { Router, type RequestHandler } from 'express';
import { authorizePermission } from '../../middleware/authorize-permission.middleware';
import { params, validateRequest } from '../../middleware/validate-request.middleware';
import { visibilityController } from './visibility.controller';
import { SECTIONS } from './visibility.registry';
import type { SectionKey } from './visibility.types';
import { sectionKeySchema, updateVisibilitySchema, type SectionKeyParams } from './visibility.validator';

/*
 * The permission a switch needs is that of the section's own menu (`cms-hero.update` for the hero),
 * so it is chosen per request from the key. Each is the ordinary authorizePermission guard, built
 * once: the same deny-by-default check and the same audited 403 as every other route.
 */
const UPDATE_GUARDS = new Map<SectionKey, RequestHandler>(SECTIONS.map((s) => [s.key, authorizePermission(`${s.menu}.update`)]));
const authorizeSectionUpdate: RequestHandler = (req, res, next) => UPDATE_GUARDS.get(params<SectionKeyParams>(req).key)!(req, res, next);

/*
 * /api/v1/cms/section-visibility — the "Show on website" switch on every Home Page Management tab.
 *
 * authenticate() is applied once by the parent CMS router. The list needs no permission of its own:
 * it returns only the switches whose `<menu>.view` the user holds. A change needs that section's
 * `<menu>.update`, so the key is validated first (an unknown key has no menu to check), then the
 * permission, then the body.
 */
export const visibilityRouter = Router();

visibilityRouter.get('/', visibilityController.list);
visibilityRouter.put(
  '/:key',
  validateRequest(sectionKeySchema),
  authorizeSectionUpdate,
  validateRequest(updateVisibilitySchema),
  visibilityController.update,
);
