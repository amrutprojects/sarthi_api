import { Router } from 'express';
import { mastersRouter, publicGeographyRouter } from '../masters';
import { healthRouter } from '../modules/health/health.routes';
import { auditLogRouter } from './audit-log.routes';
import { authRouter } from './auth.routes';
import { permissionRouter } from './permission.routes';
import { menuVisibilityRouter } from './menu-visibility.routes';
import { roleRouter } from './role.routes';
import { userRouter } from './user.routes';

/* All routes are mounted under /api/v1 by app.ts. New modules register their router here. */
export const apiRouter = Router();

apiRouter.use('/health', healthRouter);
apiRouter.use('/auth', authRouter);
apiRouter.use('/users', userRouter);
apiRouter.use('/roles', roleRouter);
apiRouter.use('/menu-visibility', menuVisibilityRouter);
apiRouter.use('/permissions', permissionRouter);
apiRouter.use('/audit-logs', auditLogRouter);

/* CMS master data. Every route under /cms requires a session (see src/masters/index.ts). */
apiRouter.use('/cms', mastersRouter);

/* Read-only geography for the public website. Unauthenticated by design — see geography.routes.ts. */
apiRouter.use('/public/geography', publicGeographyRouter);
