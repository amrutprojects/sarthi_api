import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.middleware';
import { batchRouter } from './batch/batch.routes';
import { batchAssignmentRouter } from './batch-assignment/batch-assignment.routes';
import { centreInfrastructureRouter } from './centre-infrastructure/centre-infrastructure.routes';
import { centreLocationRouter } from './centre-location/centre-location.routes';
import { centreTypeRouter } from './centre-type/centre-type.routes';
import { collegeRouter } from './college/college.routes';
import { departmentRouter } from './department/department.routes';
import { documentRouter } from './document/document.routes';
import { districtRouter } from './district/district.routes';
import { stateRouter } from './state/state.routes';
import { talukaRouter } from './taluka/taluka.routes';
import { trainingCentreRouter } from './training-centre/training-centre.routes';

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

/* Masters sidebar group. */
mastersRouter.use('/departments', departmentRouter);
mastersRouter.use('/colleges', collegeRouter);
mastersRouter.use('/centre-types', centreTypeRouter);
mastersRouter.use('/training-centres', trainingCentreRouter);
mastersRouter.use('/centre-locations', centreLocationRouter);
mastersRouter.use('/centre-infrastructure', centreInfrastructureRouter);
mastersRouter.use('/batches', batchRouter);
mastersRouter.use('/batch-assignments', batchAssignmentRouter);
mastersRouter.use('/documents', documentRouter);
