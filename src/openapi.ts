import { OpenApiGeneratorV3 } from '@asteasolutions/zod-to-openapi';
import { registry } from './shared/openapi/registry';
/* Composition root for the API contract: each module documents its own endpoints. */
import './modules/health/health.openapi';
import './modules/auth/auth.openapi';
import './modules/users/user.openapi';
import './modules/roles-permissions/roles-permissions.openapi';
import './modules/audit/audit.openapi';
import './modules/students/students.openapi';
import './modules/students/edp/edp.openapi';
import './modules/masters/masters.openapi';
import './modules/lms-access/lms-access.openapi';
import './modules/lms-sync/lms-sync.openapi';
import './cms/cms.openapi';

export { documentedRoutes } from './shared/openapi/registry';

let cached: ReturnType<OpenApiGeneratorV3['generateDocument']> | null = null;

export function openApiDocument() {
  cached ??= new OpenApiGeneratorV3(registry.definitions).generateDocument({
    openapi: '3.0.3',
    info: {
      title: 'AMRUT × SUMAGO Admin API',
      version: '1.0.0',
      description:
        'REST API of the admin panel. Responses use the envelope { success, message, data, meta? } or { success: false, message, error: { code, details?, requestId } }.',
    },
    servers: [{ url: '/' }],
  });
  return cached;
}
