import { Router } from 'express';
import { P } from '../../modules/roles-permissions';
import { authorizePermission } from '../../middleware/authorize-permission.middleware';
import { validateRequest } from '../../middleware/validate-request.middleware';
import { referenceController } from './reference.controller';
import {
  listReferenceCentresSchema, listReferenceDistrictsSchema, listReferenceTracksSchema, referenceOptionsSchema,
} from './reference.validator';

/*
 * /api/v1/lms/reference — Reference Data (UI-314), read-only.
 *
 * authenticate() runs once in the parent lmsRouter. Only GET routes are registered: the Admin Panel owns these
 * records (BRL-309), so a POST / PUT / PATCH / DELETE on any of these paths matches nothing and answers 404.
 * The spec's reference.sync permission ("synchronise now") has no route: the LMS reads the Admin Panel's
 * tables live from the shared database, so there is no pull to trigger.
 */
export const referenceRouter = Router();

referenceRouter.get('/summary', authorizePermission(P.LMS_REFERENCE_VIEW), referenceController.summary);
referenceRouter.get('/districts', authorizePermission(P.LMS_REFERENCE_VIEW), validateRequest(listReferenceDistrictsSchema), referenceController.districts);
referenceRouter.get('/centres', authorizePermission(P.LMS_REFERENCE_VIEW), validateRequest(listReferenceCentresSchema), referenceController.centres);
referenceRouter.get('/tracks', authorizePermission(P.LMS_REFERENCE_VIEW), validateRequest(listReferenceTracksSchema), referenceController.tracks);

/*
 * R1 dropdown feeds (active rows only) for every LMS master that picks a centre or a track: Entity Master
 * (enabled centres / tracks), Academic Calendar (centre exceptions), Module Master and Track Variant Master.
 */
const OPTION_READERS = [
  P.LMS_REFERENCE_VIEW,
  P.LMS_ENTITIES_VIEW,
  P.LMS_CALENDARS_VIEW,
  P.LMS_COURSE_MODULES_VIEW,
  P.LMS_TRACK_VARIANTS_VIEW,
];
referenceRouter.get(
  '/options/centres',
  authorizePermission(OPTION_READERS, { any: true }),
  validateRequest(referenceOptionsSchema),
  referenceController.centreOptions,
);
referenceRouter.get(
  '/options/tracks',
  authorizePermission(OPTION_READERS, { any: true }),
  validateRequest(referenceOptionsSchema),
  referenceController.trackOptions,
);
