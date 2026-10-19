import { Router } from 'express';
import { districtRouter } from './district/district.routes';
import { stateRouter } from './state/state.routes';
import { talukaRouter } from './taluka/taluka.routes';

export { District, MASTER_ENTITIES, State, Taluka } from './masters.entities';
export { publicGeographyRouter } from './geography/geography.routes';

/*
 * The geography masters (State -> District -> Taluka).
 *
 * Mounted by src/cms/index.ts, which is where authenticate() is applied once for the whole CMS —
 * so this router carries no authentication of its own and must never be mounted directly.
 * Each route still declares the permission it needs.
 */
export const mastersRouter = Router();

mastersRouter.use('/states', stateRouter);
mastersRouter.use('/districts', districtRouter);
mastersRouter.use('/talukas', talukaRouter);
