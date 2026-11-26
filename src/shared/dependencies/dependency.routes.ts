import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/authenticate.middleware';
import { authorizePermission } from '../../middleware/authorize-permission.middleware';
import { params, validateRequest } from '../../middleware/validate-request.middleware';
import { ApiResponse } from '../../utils/api-response';
import { AppError } from '../errors/app-error';
import { asyncHandler } from '../http/async-handler';
import { uuid } from '../validation/common.validation';
import { dependencyKind, dependencyMessage, findDependencies, type DependencyKind } from './dependencies';

/*
 * GET /api/v1/dependencies/:kind/:id — what still uses a record, asked by the admin panel's delete dialog before the user
 * confirms: { kind, id, deletable, message, dependencies: [{ label, count }] }. Only someone who may delete that kind of
 * record may ask (its delete permission); an unknown kind is a 404. The delete itself checks again (assertNoDependencies).
 */
export const dependencyRouter = Router();

dependencyRouter.use(authenticate);

const kindOf = (req: Request): DependencyKind => {
  const def = dependencyKind(String(req.params.kind));
  if (!def) throw AppError.notFound('Unknown kind of record');
  return def;
};

const mayDelete = (req: Request, res: Response, next: NextFunction) => {
  let def: DependencyKind;
  try {
    def = kindOf(req);
  } catch (err) {
    next(err);
    return;
  }
  authorizePermission(def.permission, { any: true })(req, res, next);
};

dependencyRouter.get(
  '/:kind/:id',
  mayDelete,
  validateRequest({ params: z.object({ kind: z.string().min(1).max(60), id: uuid }) }),
  asyncHandler(async (req: Request, res: Response) => {
    const def = kindOf(req);
    const { id } = params<{ id: string }>(req);
    const dependencies = await findDependencies(def, id);
    ApiResponse.ok(res, {
      kind: def.kind,
      id,
      deletable: dependencies.length === 0,
      message: dependencies.length ? dependencyMessage(def, dependencies) : null,
      dependencies,
    });
  }),
);
