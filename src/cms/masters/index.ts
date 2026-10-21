import { Router } from 'express';
<<<<<<< HEAD:src/masters/index.ts
import { authenticate } from '../middleware/authenticate.middleware';
import { batchRouter } from './batch/batch.routes';
import { batchAssignmentRouter } from './batch-assignment/batch-assignment.routes';
import { centreInfrastructureRouter } from './centre-infrastructure/centre-infrastructure.routes';
import { centreLocationRouter } from './centre-location/centre-location.routes';
import { centreTypeRouter } from './centre-type/centre-type.routes';
import { collegeRouter } from './college/college.routes';
import { departmentRouter } from './department/department.routes';
import { documentRouter } from './document/document.routes';
=======
>>>>>>> fcb39ee91d318983f70c58b173c27c13117a08ba:src/cms/masters/index.ts
import { districtRouter } from './district/district.routes';
import { stateRouter } from './state/state.routes';
import { talukaRouter } from './taluka/taluka.routes';
import { trainingCentreRouter } from './training-centre/training-centre.routes';

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
