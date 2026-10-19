import 'reflect-metadata';
import cors from 'cors';
import express, { type Express } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { appConfig } from './config/app.config';
import { logger } from './observability/logger';
import { REQUEST_ID_HEADER } from './shared/constants/app.constants';
import { errorHandler } from './middleware/error-handler.middleware';
import { notFound } from './middleware/not-found.middleware';
import { requestId } from './middleware/request-id.middleware';
import { apiRouter } from './routes';
import { ApiResponse } from './shared/http/api-response';

/* Builds the Express app (no listening, no DB connection) so tests can drive it with Supertest. */
export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(requestId);
  app.use(pinoHttp({
    logger,
    genReqId: (req) => (req as express.Request).id,
    customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'),
    serializers: { req: (req: { id: string; method: string; url: string }) => ({ id: req.id, method: req.method, url: req.url }) },
  }));

  app.use(helmet());
  app.use(cors({
    /* Only the configured admin-panel origins; non-browser clients (no Origin header) are allowed. */
    origin: (origin, cb) => cb(null, !origin || appConfig.corsOrigins.includes(origin)),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', REQUEST_ID_HEADER],
    exposedHeaders: [REQUEST_ID_HEADER],
    maxAge: 600,
  }));
  app.use(rateLimit({
    windowMs: appConfig.rateLimit.windowMs,
    limit: appConfig.rateLimit.max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req, res) => {
      ApiResponse.error(res, 429, 'Too many requests, please try again later', 'RATE_LIMITED');
    },
  }));
  app.use(express.json({ limit: appConfig.bodyLimit }));

  app.use(appConfig.apiPrefix, apiRouter);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
