import { Router } from 'express';
import { ERROR_CODES, HTTP_STATUS, RESPONSE_MESSAGES } from '../../constants/api-response.constants';
import rateLimit from 'express-rate-limit';
import { appConfig } from '../../config/app.config';
import { authController } from './auth.controller';
import { authenticate } from '../../middleware/authenticate.middleware';
import { validateRequest } from '../../middleware/validate-request.middleware';
import { ApiResponse } from '../../utils/api-response';
import { loginSchema } from './auth.validation';

/* Brute-force protection: limited login attempts per IP per window. */
const loginLimiter = rateLimit({
  windowMs: appConfig.rateLimit.windowMs,
  limit: appConfig.rateLimit.loginMax,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (_req, res) => {
    ApiResponse.error(res, HTTP_STATUS.TOO_MANY_REQUESTS, RESPONSE_MESSAGES.TOO_MANY_LOGIN_ATTEMPTS, ERROR_CODES.RATE_LIMITED);
  },
});

export const authRouter = Router();

authRouter.post('/login', loginLimiter, validateRequest(loginSchema), authController.login);
authRouter.post('/logout', authenticate, authController.logout);
authRouter.get('/me', authenticate, authController.me);
authRouter.get('/permissions', authenticate, authController.permissions);
