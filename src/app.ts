import 'reflect-metadata';
import { ERROR_CODES, HTTP_STATUS, RESPONSE_MESSAGES } from './constants/api-response.constants';
import cors from 'cors';
import express, { type Express } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { appConfig } from './config/app.config';
import { logger } from './observability/logger';
import { REQUEST_ID_HEADER } from './shared/constants/app.constants';
import { errorHandler, notFoundHandler } from './middleware/error-handler.middleware';
import { requestId } from './middleware/request-id.middleware';
import swaggerUi from 'swagger-ui-express';
import { openApiDocument } from './openapi';
import { apiRouter, integrationRouter, ippIntegrationRouter } from './routes';
import { ApiResponse } from './utils/api-response';

/* Builds the Express app (no listening, no DB connection) so tests can drive it with Supertest. */
export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(requestId);
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => (req as express.Request).id,
      customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'),
      serializers: { req: (req: { id: string; method: string; url: string }) => ({ id: req.id, method: req.method, url: req.url }) },
    }),
  );

  app.use(helmet());
  app.use(
    cors({
      /* Only the configured admin-panel origins; non-browser clients (no Origin header) are allowed. */
      origin: (origin, cb) => cb(null, !origin || appConfig.corsOrigins.includes(origin)),
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', REQUEST_ID_HEADER, 'X-CSRF-Token', 'X-Auth-Mode', 'Idempotency-Key'],
      exposedHeaders: [REQUEST_ID_HEADER],
      maxAge: 600,
    }),
  );
  app.use(
    rateLimit({
      windowMs: appConfig.rateLimit.windowMs,
      limit: appConfig.rateLimit.max,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      handler: (_req, res) => {
        ApiResponse.error(res, HTTP_STATUS.TOO_MANY_REQUESTS, RESPONSE_MESSAGES.TOO_MANY_REQUESTS, ERROR_CODES.RATE_LIMITED);
      },
    }),
  );
  /* IPP's messages (up to 5 MB): before the 10 kb parser below; the router checks the signature before it parses the body. */
  app.use('/integration/v1/ipp', ippIntegrationRouter);
  /* Before the general JSON parser: integration calls keep their exact body bytes for the signature check. */
  app.use(
    '/integration/v1',
    express.json({
      limit: '10kb',
      verify: (req, _res, buf) => {
        (req as express.Request).rawBody = buf;
      },
    }),
    integrationRouter,
  );
  /*
   * Also before the general parser, whose limit is far below what the validator allows here: a full
   * Advisory Committee profile is a few hundred KB (see DATA_FIELD_MAX_BYTES in advisory.photo.ts, the
   * same limit for multipart). A body parsed here is skipped by the general parser.
   */
  app.use(`${appConfig.apiPrefix}/cms/advisory-committee`, express.json({ limit: '512kb' }));
  app.use(express.json({ limit: appConfig.bodyLimit }));

  /* API contract (ADR-0004): machine-readable JSON plus Swagger UI, off in production unless enabled. */
  if (appConfig.apiDocsEnabled) {
    app.get(`${appConfig.apiPrefix}/openapi.json`, (_req, res) => {
      res.json(openApiDocument());
    });
    app.use(
      '/api/docs',
      helmet({ contentSecurityPolicy: false }),
      swaggerUi.serve,
      swaggerUi.setup(openApiDocument(), { customSiteTitle: 'Admin API docs' }),
    );
  }

  app.use(appConfig.apiPrefix, apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
