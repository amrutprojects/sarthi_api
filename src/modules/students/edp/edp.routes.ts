import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { ERROR_CODES, HTTP_STATUS, RESPONSE_MESSAGES } from '../../../constants/api-response.constants';
import { appConfig } from '../../../config/app.config';
import { validateRequest } from '../../../middleware/validate-request.middleware';
import { ApiResponse } from '../../../utils/api-response';
import { receiveRegistrationUpload } from '../registration/registration-upload.middleware';
import { edpController as c } from './edp.controller';
import { parentIdParams } from '../../../shared/validation/common.validation';
import { publicGeographyRouter } from '../../../cms/masters/geography/geography.routes';
import {
  centreIdSchema,
  centreStatusSchema,
  createCentreSchema,
  listCentresSchema,
  updateCentreSchema,
} from '../../../masters/centre/centre.validator';
import { requireEdpAdmin, requireEdpEditor, requireEdpStudent } from './edp.security';
import {
  applicantParams,
  docTypeParams,
  fileDownloadQuery,
  emailBody,
  followUpBody,
  helpBody,
  loginBody,
  manageListQuery,
  newUserBody,
  otpBody,
  resetPasswordBody,
  resetTokenBody,
  saveStepBody,
  signupBody,
  stepParams,
  submitBody,
  supportBody,
  userStatusBody,
  welcomeBody,
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
edpRouter.get('/manage/applicants/:id', requireEdpAdmin, validateRequest({ params: applicantParams }), c.manageApplicant);
edpRouter.get(
  '/manage/applicants/:id/documents/:docType/file',
  requireEdpAdmin,
  validateRequest({ params: applicantParams.merge(docTypeParams), query: fileDownloadQuery }),
  c.manageApplicantFile,
);
edpRouter.get('/manage/applicants/:id/documents.zip', requireEdpAdmin, validateRequest({ params: applicantParams }), c.manageApplicantZip);
edpRouter.get('/manage/applicants/:id/follow-ups', requireEdpAdmin, validateRequest({ params: applicantParams }), c.manageFollowUps);
edpRouter.post(
  '/manage/applicants/:id/follow-ups',
  requireEdpAdmin,
  requireEdpEditor,
  validateRequest({ params: applicantParams, body: followUpBody }),
  c.manageAddFollowUp,
);

/* Dependent dropdowns of the form (public, like /options): talukas of a district, technologies of a centre. */
edpRouter.get('/districts/:districtId/talukas', validateRequest({ params: parentIdParams('districtId') }), c.districtTalukas);
edpRouter.get('/centres/:centreId/technologies', validateRequest({ params: parentIdParams('centreId') }), c.centreTechnologies);
/* State → District → Taluka for the tracking panel's Center Master form: the public geography feed. */
edpRouter.use('/geography', publicGeographyRouter);

/* Center Master in the tracking panel: the same centres (and service) as the Amrut admin panel's Center Master. */
edpRouter.get('/manage/centres', requireEdpAdmin, validateRequest(listCentresSchema), c.manageCentres);
edpRouter.get('/manage/technology-options', requireEdpAdmin, c.manageTechnologyOptions);
edpRouter.post('/manage/centres', requireEdpAdmin, requireEdpEditor, validateRequest(createCentreSchema), c.manageCreateCentre);
edpRouter.get('/manage/centres/:id', requireEdpAdmin, validateRequest(centreIdSchema), c.manageCentre);
edpRouter.patch('/manage/centres/:id', requireEdpAdmin, requireEdpEditor, validateRequest(updateCentreSchema), c.manageUpdateCentre);
edpRouter.patch('/manage/centres/:id/status', requireEdpAdmin, requireEdpEditor, validateRequest(centreStatusSchema), c.manageCentreStatus);

/* Tracking panel users: ADMIN only (a VIEWER views and downloads, and cannot add or change users). */
edpRouter.get('/manage/users', requireEdpAdmin, requireEdpEditor, c.manageUsers);
edpRouter.post('/manage/users', requireEdpAdmin, requireEdpEditor, validateRequest({ body: newUserBody }), c.manageAddUser);
edpRouter.patch(
  '/manage/users/:id/status',
  requireEdpAdmin,
  requireEdpEditor,
  validateRequest({ params: applicantParams, body: userStatusBody }),
  c.manageUserStatus,
);

/*
 * The portal's editable content: the support contact line shown to students, the congratulations dialog shown once an
 * account is created, and the Help button's contact details. Every tracking panel user reads them, an ADMIN saves them.
 * Students receive all three with GET /edp/options.
 */
edpRouter.get('/manage/settings/support', requireEdpAdmin, c.manageSupport);
edpRouter.put('/manage/settings/support', requireEdpAdmin, requireEdpEditor, validateRequest({ body: supportBody }), c.manageSaveSupport);
edpRouter.get('/manage/settings/welcome', requireEdpAdmin, c.manageWelcome);
edpRouter.put('/manage/settings/welcome', requireEdpAdmin, requireEdpEditor, validateRequest({ body: welcomeBody }), c.manageSaveWelcome);
edpRouter.get('/manage/settings/help', requireEdpAdmin, c.manageHelp);
edpRouter.put('/manage/settings/help', requireEdpAdmin, requireEdpEditor, validateRequest({ body: helpBody }), c.manageSaveHelp);
