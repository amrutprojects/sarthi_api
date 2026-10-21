import { Router } from 'express';
/* Composition root: the only place that mounts module routers (routers are not part of a module's public API). */
import { healthRouter } from './modules/health/health.routes';
import { auditLogRouter } from './modules/audit/audit-log.routes';
import { authRouter } from './modules/auth/auth.routes';
import { permissionRouter } from './modules/roles-permissions/permissions/permission.routes';
import { importRouter } from './modules/students/import/import.routes';
import { studentRouter } from './modules/students/register/student.routes';
import { menuVisibilityRouter } from './modules/roles-permissions/menu-visibility/menu-visibility.routes';
import { roleRouter } from './modules/roles-permissions/roles/role.routes';
import { userRouter } from './modules/users/user.routes';
import { mastersRouter, publicGeographyRouter } from './masters';
import { lmsRouter } from './lms';

/* All routes are mounted under /api/v1 by app.ts. New modules register their router here. */
export const apiRouter = Router();

apiRouter.use('/health', healthRouter);
apiRouter.use('/auth', authRouter);
apiRouter.use('/users', userRouter);
apiRouter.use('/roles', roleRouter);
apiRouter.use('/menu-visibility', menuVisibilityRouter);
apiRouter.use('/imports', importRouter);
apiRouter.use('/students', studentRouter);
apiRouter.use('/permissions', permissionRouter);
apiRouter.use('/audit-logs', auditLogRouter);

/* CMS master data. Every route under /cms requires a session (see src/masters/index.ts). */
apiRouter.use('/cms', mastersRouter);

/* LMS Admin masters. Every route under /lms requires a session (see src/lms/index.ts). */
apiRouter.use('/lms', lmsRouter);

/* Read-only geography for the public website. Unauthenticated by design — see geography.routes.ts. */
apiRouter.use('/public/geography', publicGeographyRouter);
