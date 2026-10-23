import { Router } from 'express';
/* Composition root: the only place that mounts module routers (routers are not part of a module's public API). */
import { healthRouter } from './modules/health/health.routes';
import { auditLogRouter } from './modules/audit/audit-log.routes';
import { authRouter } from './modules/auth/auth.routes';
import { permissionRouter } from './modules/roles-permissions/permissions/permission.routes';
import { importRouter } from './modules/students/import/import.routes';
import { studentRouter } from './modules/students/register/student.routes';
import { registrationRouter } from './modules/students/registration/registration.routes';
import { menuVisibilityRouter } from './modules/roles-permissions/menu-visibility/menu-visibility.routes';
import { roleRouter } from './modules/roles-permissions/roles/role.routes';
import { userRouter } from './modules/users/user.routes';
import { MASTERS } from './modules/masters';
import { masterRouter } from './modules/masters/master.routes';
import {
  cmsRouter,
  publicContactRouter,
  publicFooterRouter,
  publicGeographyRouter,
  publicHeroRouter,
  publicBoardRouter,
  publicEcosystemRouter,
  publicSchemesRouter,
  publicAboutRouter,
  publicImpactRouter,
  publicModulesRouter, publicHighlightRouter,
  publicProgrammeRouter,
} from './cms';

/* All routes are mounted under /api/v1 by app.ts. New modules register their router here. */
export const apiRouter = Router();

apiRouter.use('/health', healthRouter);
apiRouter.use('/auth', authRouter);
apiRouter.use('/users', userRouter);
apiRouter.use('/roles', roleRouter);
apiRouter.use('/menu-visibility', menuVisibilityRouter);
apiRouter.use('/imports', importRouter);
apiRouter.use('/students', studentRouter);
apiRouter.use('/student-registrations', registrationRouter);
apiRouter.use('/permissions', permissionRouter);
apiRouter.use('/audit-logs', auditLogRouter);
for (const d of Object.values(MASTERS)) apiRouter.use(`/${d.path}`, masterRouter(d));

/* CMS content and geography masters. Every route under /cms requires a session (see src/cms/index.ts). */
apiRouter.use('/cms', cmsRouter);

/* Read-only content for the public website. Unauthenticated by design — see the route files. */
apiRouter.use('/public/geography', publicGeographyRouter);
apiRouter.use('/public/contact', publicContactRouter);
apiRouter.use('/public/footer', publicFooterRouter);
apiRouter.use('/public/modules', publicModulesRouter);
apiRouter.use('/public/highlight', publicHighlightRouter);
apiRouter.use('/public/hero', publicHeroRouter);
apiRouter.use('/public/board-members', publicBoardRouter);
apiRouter.use('/public/ecosystem', publicEcosystemRouter);
apiRouter.use('/public/schemes', publicSchemesRouter);
apiRouter.use('/public/about', publicAboutRouter);
apiRouter.use('/public/impact', publicImpactRouter);
apiRouter.use('/public/programme', publicProgrammeRouter);
