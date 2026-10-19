import { Router } from 'express';
import { cmsRouter, publicContactRouter, publicGeographyRouter } from '../cms';
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

/* CMS content and master data. Every route under /cms requires a session (see src/cms/index.ts). */
apiRouter.use('/cms', cmsRouter);

/* Read-only content for the public website. Unauthenticated by design — see the route files. */
apiRouter.use('/public/geography', publicGeographyRouter);
apiRouter.use('/public/contact', publicContactRouter);
