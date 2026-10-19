import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.middleware';
import { districtRouter } from './district/district.routes';
import { stateRouter } from './state/state.routes';
import { talukaRouter } from './taluka/taluka.routes';

export { District, MASTER_ENTITIES, State, Taluka } from './masters.entities';
export { publicGeographyRouter } from './geography/geography.routes';

/*
 * /api/v1/cms — the CMS master data modules (State, District, Taluka).
 *
 * authenticate() runs once here for every CMS route; each route then declares the permission it needs.
 * The public, unauthenticated read feed is a separate router (publicGeographyRouter), mounted
 * elsewhere, so nothing under /cms is ever reachable without a session.
 */
export const mastersRouter = Router();

mastersRouter.use(authenticate);
mastersRouter.use('/states', stateRouter);
mastersRouter.use('/districts', districtRouter);
mastersRouter.use('/talukas', talukaRouter);
