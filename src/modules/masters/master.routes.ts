import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.middleware';
import { authorizePermission } from '../../middleware/authorize-permission.middleware';
import { validateRequest } from '../../middleware/validate-request.middleware';
import { idempotent } from '../../shared/idempotency/idempotency.middleware';
import { masterController } from './master.controller';
import { masterPermission, type MasterAction, type MasterDefinition } from './master.definitions';
import { masterServices } from './master.service';
import { masterSchemas } from './master.validation';

/*
 * One router per master. GET /options is public (active, non-deleted id / code / name for the registration form and
 * dropdowns); every other route requires authentication and the master's own permission.
 */
export function masterRouter(d: MasterDefinition): Router {
  const c = masterController(masterServices[d.key]);
  const s = masterSchemas(d);
  const can = (a: MasterAction) => authorizePermission(masterPermission(d, a));
  const router = Router();
  router.get('/options', c.options);
  router.use(authenticate);
  router.get('/', can('view'), validateRequest(s.list), c.list);
  router.post('/', can('create'), validateRequest(s.create), idempotent, c.create);
  router.get('/:id', can('view'), validateRequest(s.id), c.get);
  router.patch('/:id', can('update'), validateRequest(s.update), c.update);
  router.patch('/:id/status', can('status'), validateRequest(s.status), c.setStatus);
  router.delete('/:id', can('delete'), validateRequest(s.id), c.remove);
  return router;
}
