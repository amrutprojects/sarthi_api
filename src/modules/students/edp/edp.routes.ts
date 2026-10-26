import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { ERROR_CODES, HTTP_STATUS, RESPONSE_MESSAGES } from '../../../constants/api-response.constants';
import { appConfig } from '../../../config/app.config';
import { validateRequest } from '../../../middleware/validate-request.middleware';
import { ApiResponse } from '../../../utils/api-response';
import { receiveRegistrationUpload } from '../registration/registration-upload.middleware';
import { edpController as c } from './edp.controller';
import { requireEdpAdmin, requireEdpStudent } from './edp.security';
import {
  applicantParams,
  docTypeParams,
  emailBody,
  followUpBody,
  loginBody,
  manageListQuery,
  otpBody,
  resetPasswordBody,
  resetTokenBody,
  saveStepBody,
  signupBody,
  stepParams,
  submitBody,
} from './edp.validation';

/* Per-IP limit for sign-up, OTP and sign-in, on top of the global API limit. */
const edpLimiter = rateLimit({
  windowMs: appConfig.rateLimit.windowMs,
  limit: appConfig.edp.rateLimitMax,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (_req, res) => {
    ApiResponse.error(res, HTTP_STATUS.TOO_MANY_REQUESTS, RESPONSE_MESSAGES.TOO_MANY_REQUESTS, ERROR_CODES.RATE_LIMITED);
  },
});

/*
 * ENTREPRENEURSHIP DEVELOPMENT PROGRAM portal (edp.sumago.ai), mounted at /edp. Its own copies of the registration
 * endpoints, for students signed in with a portal account (EDP token), and the tracking panel's endpoints (/edp/manage,
 * EDP admin token). Neither token is accepted by the Amrut admin API, and no admin panel endpoint is reachable from here.
 */
export const edpRouter = Router();

edpRouter.post('/auth/register', edpLimiter, validateRequest({ body: signupBody }), c.register);
edpRouter.post('/auth/verify-otp', edpLimiter, validateRequest({ body: otpBody }), c.verifyOtp);
edpRouter.post('/auth/resend-otp', edpLimiter, validateRequest({ body: emailBody }), c.resendOtp);
edpRouter.post('/auth/otp-status', edpLimiter, validateRequest({ body: emailBody }), c.otpStatus);
edpRouter.post('/auth/login', edpLimiter, validateRequest({ body: loginBody }), c.login);
edpRouter.post('/auth/forgot-password', edpLimiter, validateRequest({ body: emailBody }), c.forgotPassword);
edpRouter.post('/auth/reset-password/check', edpLimiter, validateRequest({ body: resetTokenBody }), c.checkResetLink);
edpRouter.post('/auth/reset-password', edpLimiter, validateRequest({ body: resetPasswordBody }), c.resetPassword);
edpRouter.get('/options', c.options);
edpRouter.get('/me', requireEdpStudent, c.me);

edpRouter.get('/application', requireEdpStudent, c.application);
edpRouter.put('/application/steps/:step', requireEdpStudent, validateRequest({ params: stepParams, body: saveStepBody }), c.saveStep);
edpRouter.post('/application/documents', requireEdpStudent, receiveRegistrationUpload, c.uploadDocuments);
edpRouter.delete('/application/documents/:docType', requireEdpStudent, validateRequest({ params: docTypeParams }), c.removeDocument);
edpRouter.get('/application/documents/:docType/file', requireEdpStudent, validateRequest({ params: docTypeParams }), c.documentFile);
edpRouter.post('/application/submit', requireEdpStudent, validateRequest({ body: submitBody }), c.submit);

edpRouter.post('/manage/auth/login', edpLimiter, validateRequest({ body: loginBody }), c.manageLogin);
edpRouter.get('/manage/me', requireEdpAdmin, c.manageMe);
edpRouter.get('/manage/summary', requireEdpAdmin, c.manageSummary);
edpRouter.get('/manage/applicants', requireEdpAdmin, validateRequest({ query: manageListQuery }), c.manageList);
edpRouter.get('/manage/applicants/:id/follow-ups', requireEdpAdmin, validateRequest({ params: applicantParams }), c.manageFollowUps);
edpRouter.post(
  '/manage/applicants/:id/follow-ups',
  requireEdpAdmin,
  validateRequest({ params: applicantParams, body: followUpBody }),
  c.manageAddFollowUp,
);
