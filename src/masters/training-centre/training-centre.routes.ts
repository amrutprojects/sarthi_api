import { Router } from 'express';
import { P } from '../../modules/roles-permissions';
import { authorizePermission } from '../../middleware/authorize-permission.middleware';
import { validateRequest } from '../../middleware/validate-request.middleware';
import { trainingCentreController } from './training-centre.controller';
import {
  createTrainingCentreSchema, listTrainingCentresSchema, trainingCentreIdSchema, trainingCentreStatusSchema, updateTrainingCentreSchema,
} from './training-centre.validator';

/* /api/v1/cms/training-centres — Training Centre Master. See state.routes.ts for the shared conventions. */
export const trainingCentreRouter = Router();

trainingCentreRouter.get(
  '/',
  authorizePermission(P.CMS_TRAINING_CENTRES_VIEW),
  validateRequest(listTrainingCentresSchema),
  trainingCentreController.list,
);
/*
 * Dropdown feed (active only), readable by every master that picks a centre. Registered before /:id so
 * "options" is never read as an id.
 */
trainingCentreRouter.get(
  '/options',
  authorizePermission(
    [
      P.CMS_TRAINING_CENTRES_VIEW,
      P.CMS_CENTRE_LOCATIONS_VIEW,
      P.CMS_CENTRE_INFRASTRUCTURE_VIEW,
      P.CMS_BATCHES_VIEW,
      P.CMS_BATCH_ASSIGNMENTS_VIEW,
      P.CMS_DOCUMENTS_VIEW,
    ],
    { any: true },
  ),
  trainingCentreController.options,
);
/*
 * Suggested centre codes for the Add / Edit form: the student-import course centres ([{ code, name }]),
 * because Assign Batch compares a student's preferred centre with the batch's centre code. Readable by
 * whoever may write a centre; registered before /:id so "code-suggestions" is never read as an id.
 */
trainingCentreRouter.get(
  '/code-suggestions',
  authorizePermission([P.CMS_TRAINING_CENTRES_CREATE, P.CMS_TRAINING_CENTRES_UPDATE], { any: true }),
  trainingCentreController.codeSuggestions,
);
trainingCentreRouter.post(
  '/',
  authorizePermission(P.CMS_TRAINING_CENTRES_CREATE),
  validateRequest(createTrainingCentreSchema),
  trainingCentreController.create,
);
trainingCentreRouter.get(
  '/:id',
  authorizePermission(P.CMS_TRAINING_CENTRES_VIEW),
  validateRequest(trainingCentreIdSchema),
  trainingCentreController.get,
);
trainingCentreRouter.put(
  '/:id',
  authorizePermission(P.CMS_TRAINING_CENTRES_UPDATE),
  validateRequest(updateTrainingCentreSchema),
  trainingCentreController.update,
);
trainingCentreRouter.patch(
  '/:id',
  authorizePermission(P.CMS_TRAINING_CENTRES_UPDATE),
  validateRequest(updateTrainingCentreSchema),
  trainingCentreController.update,
);
trainingCentreRouter.patch(
  '/:id/status',
  authorizePermission(P.CMS_TRAINING_CENTRES_UPDATE),
  validateRequest(trainingCentreStatusSchema),
  trainingCentreController.setStatus,
);
trainingCentreRouter.delete(
  '/:id',
  authorizePermission(P.CMS_TRAINING_CENTRES_DELETE),
  validateRequest(trainingCentreIdSchema),
  trainingCentreController.remove,
);
trainingCentreRouter.post(
  '/:id/restore',
  authorizePermission(P.CMS_TRAINING_CENTRES_DELETE),
  validateRequest(trainingCentreIdSchema),
  trainingCentreController.restore,
);
