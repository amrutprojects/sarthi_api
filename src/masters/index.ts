import { Router } from 'express';
import { batchRouter } from './batch/batch.routes';
import { batchAssignmentRouter } from './batch-assignment/batch-assignment.routes';
import { centreInfrastructureRouter } from './centre-infrastructure/centre-infrastructure.routes';
import { centreLocationRouter } from './centre-location/centre-location.routes';
import { centreTypeRouter } from './centre-type/centre-type.routes';
import { centreRouter } from './centre/centre.routes';
import { collegeRouter } from './college/college.routes';
import { departmentRouter } from './department/department.routes';
import { documentRouter } from './document/document.routes';
import { trainingCentreRouter } from './training-centre/training-centre.routes';

export { MASTER_ENTITIES } from './masters.entities';

/*
 * The Masters sidebar group (departments, colleges, centres, batches, documents), served under /api/v1/cms
 * next to the geography masters.
 *
 * Mounted by src/cms/index.ts, which is where authenticate() is applied once for the whole CMS — so this
 * router carries no authentication of its own and must never be mounted directly. Each route still
 * declares the permission it needs.
 */
export const programmeMastersRouter = Router();

programmeMastersRouter.use('/departments', departmentRouter);
programmeMastersRouter.use('/colleges', collegeRouter);
programmeMastersRouter.use('/centres', centreRouter);
programmeMastersRouter.use('/centre-types', centreTypeRouter);
programmeMastersRouter.use('/training-centres', trainingCentreRouter);
programmeMastersRouter.use('/centre-locations', centreLocationRouter);
programmeMastersRouter.use('/centre-infrastructure', centreInfrastructureRouter);
programmeMastersRouter.use('/batches', batchRouter);
programmeMastersRouter.use('/batch-assignments', batchAssignmentRouter);
programmeMastersRouter.use('/documents', documentRouter);
