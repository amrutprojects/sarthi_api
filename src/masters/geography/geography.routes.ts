import { Router } from 'express';
import { validateRequest } from '../../middleware/validate-request.middleware';
import { parentIdParams } from '../../validators/common.validator';
import { geographyController } from './geography.controller';

/*
 * /api/v1/public/geography — read-only geography for the public website.
 *
 * Deliberately NOT behind authenticate(): the public site has no session, and these three endpoints
 * are what let its forms use the same master data the admin panel manages instead of a hardcoded list.
 *
 * What makes that safe:
 * - GET only. There is no public write path to any master table.
 * - Only active, non-deleted rows, projected to { id, name, code } by GeographyService — no timestamps,
 *   no status flags, no row counts, nothing about the records an administrator sees.
 * - The global rate limiter in app.ts applies, as it does to every route.
 * - Route params are validated as UUIDs before they reach a query.
 */
export const publicGeographyRouter = Router();

publicGeographyRouter.get('/states', geographyController.states);

publicGeographyRouter.get(
  '/states/:stateId/districts',
  validateRequest({ params: parentIdParams('stateId') }),
  geographyController.districtsOfState,
);

publicGeographyRouter.get(
  '/districts/:districtId/talukas',
  validateRequest({ params: parentIdParams('districtId') }),
  geographyController.talukasOfDistrict,
);
