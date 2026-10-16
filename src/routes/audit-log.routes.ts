import { Router } from 'express';
import { P } from '../constants/permission.constants';
import { auditLogController } from '../controllers/audit-log.controller';
import { authenticate } from '../middleware/authenticate.middleware';
import { authorizePermission } from '../middleware/authorize-permission.middleware';
import { validateRequest } from '../middleware/validate-request.middleware';
import { listAuditLogsSchema } from '../validators/audit-log.validator';

export const auditLogRouter = Router();

auditLogRouter.get('/', authenticate, authorizePermission(P.AUDIT_VIEW), validateRequest(listAuditLogsSchema), auditLogController.list);
