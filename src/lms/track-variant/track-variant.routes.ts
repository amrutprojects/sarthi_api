import { Router } from 'express';
import { P } from '../../modules/roles-permissions';
import { authorizePermission } from '../../middleware/authorize-permission.middleware';
import { validateRequest, type RequestSchemas } from '../../middleware/validate-request.middleware';
import type { ItemKindName } from './track-variant-items.service';
import { itemController, lmsTrackVariantController } from './track-variant.controller';
import {
  createAssessmentComponentSchema, createComponentSchema, createOftCardSchema, createPhaseSchema, createReadinessGateSchema,
  createTrackModuleSchema, createTrackVariantSchema, itemListSchema, itemParamsSchema, listTrackVariantsSchema, trackVariantIdSchema,
  trackVariantOptionsSchema, trackVariantStatusSchema, updateAssessmentComponentSchema, updateComponentSchema, updateOftCardSchema,
  updatePhaseSchema, updateReadinessGateSchema, updateTrackModuleSchema, updateTrackVariantSchema,
} from './track-variant.validator';

/*
 * /api/v1/lms/track-variants — Track Variant Master (AMRUT_KALASH_03 L-07, UI-317; API-204 curriculum).
 * Spec permission → code: curriculum.view → lms-track-variants.view · curriculum.create →
 * lms-track-variants.create · curriculum.update → lms-track-variants.update · curriculum.archive →
 * lms-track-variants.delete. The nested curriculum items follow the same mapping (gate.create / update,
 * oft.create / update / archive are folded into this menu's permissions).
 */
export const lmsTrackVariantRouter = Router();

const c = lmsTrackVariantController;
const VIEW = authorizePermission(P.LMS_TRACK_VARIANTS_VIEW);
const CREATE = authorizePermission(P.LMS_TRACK_VARIANTS_CREATE);
const UPDATE = authorizePermission(P.LMS_TRACK_VARIANTS_UPDATE);
const DELETE = authorizePermission(P.LMS_TRACK_VARIANTS_DELETE);

lmsTrackVariantRouter.get('/', VIEW, validateRequest(listTrackVariantsSchema), c.list);
/* Dropdown feed and form values; registered before /:id so they are never read as an id. */
lmsTrackVariantRouter.get('/options', VIEW, validateRequest(trackVariantOptionsSchema), c.options);
lmsTrackVariantRouter.get(
  '/form-options',
  authorizePermission([P.LMS_TRACK_VARIANTS_VIEW, P.LMS_TRACK_VARIANTS_CREATE, P.LMS_TRACK_VARIANTS_UPDATE], { any: true }),
  c.formOptions,
);
lmsTrackVariantRouter.post('/', CREATE, validateRequest(createTrackVariantSchema), c.create);
lmsTrackVariantRouter.get('/:id', VIEW, validateRequest(trackVariantIdSchema), c.get);
lmsTrackVariantRouter.put('/:id', UPDATE, validateRequest(updateTrackVariantSchema), c.update);
lmsTrackVariantRouter.patch('/:id', UPDATE, validateRequest(updateTrackVariantSchema), c.update);
lmsTrackVariantRouter.patch('/:id/status', UPDATE, validateRequest(trackVariantStatusSchema), c.setStatus);
lmsTrackVariantRouter.post('/:id/publish', UPDATE, validateRequest(trackVariantIdSchema), c.publish);
lmsTrackVariantRouter.post('/:id/retire', DELETE, validateRequest(trackVariantIdSchema), c.retire);
lmsTrackVariantRouter.delete('/:id', DELETE, validateRequest(trackVariantIdSchema), c.remove);
lmsTrackVariantRouter.post('/:id/restore', DELETE, validateRequest(trackVariantIdSchema), c.restore);

/* Nested curriculum: /:id/<path> and /:id/<path>/:itemId. */
const ITEM_ROUTES: { path: string; kind: ItemKindName; label: string; create: RequestSchemas; update: RequestSchemas }[] = [
  { path: 'phases', kind: 'PHASES', label: 'Phase', create: createPhaseSchema, update: updatePhaseSchema },
  { path: 'track-modules', kind: 'TRACK_MODULES', label: 'Track module', create: createTrackModuleSchema, update: updateTrackModuleSchema },
  {
    path: 'learning-components',
    kind: 'LEARNING_COMPONENTS',
    label: 'Learning component',
    create: createComponentSchema,
    update: updateComponentSchema,
  },
  { path: 'oft-cards', kind: 'OFT_CARDS', label: 'OFT card', create: createOftCardSchema, update: updateOftCardSchema },
  {
    path: 'assessment-components',
    kind: 'ASSESSMENT_COMPONENTS',
    label: 'Assessment component',
    create: createAssessmentComponentSchema,
    update: updateAssessmentComponentSchema,
  },
  {
    path: 'readiness-gates',
    kind: 'READINESS_GATES',
    label: 'Readiness gate',
    create: createReadinessGateSchema,
    update: updateReadinessGateSchema,
  },
];

/* F-LMS-29-12 "Retire action" of a published OFT card (registered before the generic /:itemId routes). */
lmsTrackVariantRouter.post('/:id/oft-cards/:itemId/retire', DELETE, validateRequest(itemParamsSchema), c.retireOftCard);

for (const r of ITEM_ROUTES) {
  const ic = itemController(r.kind, r.label);
  const base = `/:id/${r.path}`;
  lmsTrackVariantRouter.get(base, VIEW, validateRequest(itemListSchema), ic.list);
  lmsTrackVariantRouter.post(base, CREATE, validateRequest(r.create), ic.create);
  lmsTrackVariantRouter.get(`${base}/:itemId`, VIEW, validateRequest(itemParamsSchema), ic.get);
  lmsTrackVariantRouter.put(`${base}/:itemId`, UPDATE, validateRequest(r.update), ic.update);
  lmsTrackVariantRouter.patch(`${base}/:itemId`, UPDATE, validateRequest(r.update), ic.update);
  lmsTrackVariantRouter.delete(`${base}/:itemId`, DELETE, validateRequest(itemParamsSchema), ic.remove);
}
