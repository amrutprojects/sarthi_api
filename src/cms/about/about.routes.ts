import { Router } from 'express';
import { P } from '../../modules/roles-permissions/permission.constants';
import { authorizePermission } from '../../middleware/authorize-permission.middleware';
import { validateRequest } from '../../middleware/validate-request.middleware';
import { idempotent } from '../../shared/idempotency/idempotency.middleware';
import { aboutController as c } from './about.controller';
import {
  createCardSchema,
  createFactSchema,
  itemIdSchema,
  itemStatusSchema,
  reorderSchema,
  updateCardSchema,
  updateFactSchema,
  updateSectionSchema,
} from './about.validator';

/*
 * /api/v1/cms/about — About AMRUT Management.
 *
 *   GET    /                    the section, its information rows and its cards (the dashboard)
 *   PATCH  /settings            heading, subtitle, description, visibility (partial)
 *   /facts and /cards           add, view, edit, show/hide, delete and reorder rows and cards
 *
 * authenticate() is applied once by the parent CMS router, and each route declares the permission it
 * needs. Adding a row or a card honours the Idempotency-Key header (ADR-0005), so a retried or
 * double-submitted form is answered with the first result instead of adding the record twice. The
 * static /order paths are declared before /:id so they are never taken for an id.
 */
export const aboutRouter = Router();

const view = authorizePermission(P.CMS_ABOUT_VIEW);
const create = authorizePermission(P.CMS_ABOUT_CREATE);
const update = authorizePermission(P.CMS_ABOUT_UPDATE);
const remove = authorizePermission(P.CMS_ABOUT_DELETE);

aboutRouter.get('/', view, c.get);
aboutRouter.patch('/settings', update, validateRequest(updateSectionSchema), c.updateSection);

aboutRouter.post('/facts', create, validateRequest(createFactSchema), idempotent, c.createFact);
aboutRouter.put('/facts/order', update, validateRequest(reorderSchema), c.reorderFacts);
aboutRouter.get('/facts/:id', view, validateRequest(itemIdSchema), c.getFact);
aboutRouter.patch('/facts/:id', update, validateRequest(updateFactSchema), c.updateFact);
aboutRouter.patch('/facts/:id/status', update, validateRequest(itemStatusSchema), c.setFactStatus);
aboutRouter.delete('/facts/:id', remove, validateRequest(itemIdSchema), c.removeFact);

aboutRouter.post('/cards', create, validateRequest(createCardSchema), idempotent, c.createCard);
aboutRouter.put('/cards/order', update, validateRequest(reorderSchema), c.reorderCards);
aboutRouter.get('/cards/:id', view, validateRequest(itemIdSchema), c.getCard);
aboutRouter.patch('/cards/:id', update, validateRequest(updateCardSchema), c.updateCard);
aboutRouter.patch('/cards/:id/status', update, validateRequest(itemStatusSchema), c.setCardStatus);
aboutRouter.delete('/cards/:id', remove, validateRequest(itemIdSchema), c.removeCard);
