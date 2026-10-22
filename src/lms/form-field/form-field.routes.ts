import { Router } from 'express';
import { P } from '../../modules/roles-permissions';
import { authorizePermission } from '../../middleware/authorize-permission.middleware';
import { validateRequest } from '../../middleware/validate-request.middleware';
import { lmsFormFieldController } from './form-field.controller';
import {
  createLmsFormFieldSchema, listLmsFormFieldsSchema, lmsFormCodeSchema, lmsFormFieldIdSchema, lmsFormFieldStatusSchema, updateLmsFormFieldSchema,
} from './form-field.validator';

/*
 * /api/v1/lms/form-fields — Form Field Configuration (AMRUT_KALASH_03 L-38 / FR-338, F-LMS-FFC; API-224
 * /config/forms/{form_code}/fields). Same conventions as the Entity Master. Spec permission → code:
 * config.form.view → lms-form-fields.view · config.form.update ('Change a field rule, add or archive a custom
 * field') → lms-form-fields.create (add) / lms-form-fields.update (rules, archive) · delete / restore of a
 * custom field without values → lms-form-fields.delete.
 */
export const lmsFormFieldRouter = Router();

/* ?deleted=true lists only the soft-deleted fields (still the view permission; restoring needs delete). */
lmsFormFieldRouter.get('/', authorizePermission(P.LMS_FORM_FIELDS_VIEW), validateRequest(listLmsFormFieldsSchema), lmsFormFieldController.list);
/* Forms, sections, custom data types (with their rules), stages, sensitivities, languages. Before /:id. */
lmsFormFieldRouter.get(
  '/form-options',
  authorizePermission([P.LMS_FORM_FIELDS_VIEW, P.LMS_FORM_FIELDS_CREATE, P.LMS_FORM_FIELDS_UPDATE], { any: true }),
  lmsFormFieldController.formOptions,
);
/* The effective configuration of one form (AD-12): what the form renders and the server enforces; also the UI-361 preview. */
lmsFormFieldRouter.get(
  '/forms/:formCode/effective',
  authorizePermission(P.LMS_FORM_FIELDS_VIEW),
  validateRequest(lmsFormCodeSchema),
  lmsFormFieldController.effective,
);
/*
 * Every section of one form (standard ones, then each custom section a non-deleted field uses, hidden and
 * archived fields included) with its field count: the listing's section filter and the form's section picker.
 */
lmsFormFieldRouter.get(
  '/forms/:formCode/sections',
  authorizePermission([P.LMS_FORM_FIELDS_VIEW, P.LMS_FORM_FIELDS_CREATE, P.LMS_FORM_FIELDS_UPDATE], { any: true }),
  validateRequest(lmsFormCodeSchema),
  lmsFormFieldController.sections,
);
lmsFormFieldRouter.post('/', authorizePermission(P.LMS_FORM_FIELDS_CREATE), validateRequest(createLmsFormFieldSchema), lmsFormFieldController.create);
lmsFormFieldRouter.get('/:id', authorizePermission(P.LMS_FORM_FIELDS_VIEW), validateRequest(lmsFormFieldIdSchema), lmsFormFieldController.get);
lmsFormFieldRouter.put('/:id', authorizePermission(P.LMS_FORM_FIELDS_UPDATE), validateRequest(updateLmsFormFieldSchema), lmsFormFieldController.update);
lmsFormFieldRouter.patch('/:id', authorizePermission(P.LMS_FORM_FIELDS_UPDATE), validateRequest(updateLmsFormFieldSchema), lmsFormFieldController.update);
lmsFormFieldRouter.patch(
  '/:id/status',
  authorizePermission(P.LMS_FORM_FIELDS_UPDATE),
  validateRequest(lmsFormFieldStatusSchema),
  lmsFormFieldController.setStatus,
);
lmsFormFieldRouter.delete('/:id', authorizePermission(P.LMS_FORM_FIELDS_DELETE), validateRequest(lmsFormFieldIdSchema), lmsFormFieldController.remove);
lmsFormFieldRouter.post(
  '/:id/restore',
  authorizePermission(P.LMS_FORM_FIELDS_DELETE),
  validateRequest(lmsFormFieldIdSchema),
  lmsFormFieldController.restore,
);
