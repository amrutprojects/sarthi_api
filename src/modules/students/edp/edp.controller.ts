import type { Request, Response } from 'express';
import { body, params, query } from '../../../middleware/validate-request.middleware';
import { asyncHandler } from '../../../shared/http/async-handler';
import { ApiResponse } from '../../../utils/api-response';
import { uploadedFiles } from '../registration/registration-upload.middleware';
import { EDP_MESSAGES, EDP_RESET_LINK_MINUTES, EDP_RESET_RESEND_SECONDS } from './edp.constants';
import { accountDto, edpAccountService } from './edp-account.service';
import { edpApplicationService } from './edp-application.service';
import { edpManageService } from './edp-manage.service';
import { edpAccountOf, edpAdminOf } from './edp.security';
import type { FollowUpBody, ManageListQuery, ResetPasswordBody, SaveStepBody, SignupBody, SubmitBody } from './edp.validation';

type Email = { email: string };

export const edpController = {
  register: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.created(res, await edpAccountService.register(req, body<SignupBody>(req)), EDP_MESSAGES.OTP_SENT);
  }),
  verifyOtp: asyncHandler(async (req: Request, res: Response) => {
    const b = body<Email & { otp: string; password: string }>(req);
    ApiResponse.ok(res, await edpAccountService.verifyOtp(req, b.email, b.otp, b.password), EDP_MESSAGES.ACCOUNT_CREATED);
  }),
  resendOtp: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await edpAccountService.resendOtp(body<Email>(req).email), EDP_MESSAGES.OTP_SENT);
  }),
  otpStatus: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await edpAccountService.otpStatus(body<Email>(req).email));
  }),
  login: asyncHandler(async (req: Request, res: Response) => {
    const b = body<Email & { password: string }>(req);
    ApiResponse.ok(res, await edpAccountService.login(b.email, b.password), 'Logged in');
  }),
  forgotPassword: asyncHandler(async (req: Request, res: Response) => {
    const { email } = body<Email>(req);
    await edpAccountService.forgotPassword(req, email);
    ApiResponse.ok(
      res,
      { email, link_valid_minutes: EDP_RESET_LINK_MINUTES, resend_after: EDP_RESET_RESEND_SECONDS },
      EDP_MESSAGES.RESET_LINK_SENT,
    );
  }),
  checkResetLink: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await edpAccountService.checkResetToken(body<{ token: string }>(req).token));
  }),
  resetPassword: asyncHandler(async (req: Request, res: Response) => {
    const b = body<ResetPasswordBody>(req);
    ApiResponse.ok(res, await edpAccountService.resetPassword(req, b.token, b.password), EDP_MESSAGES.PASSWORD_CHANGED);
  }),
  options: asyncHandler(async (_req: Request, res: Response) => {
    ApiResponse.ok(res, await edpApplicationService.options());
  }),
  me: asyncHandler(async (_req: Request, res: Response) => {
    ApiResponse.ok(res, accountDto(edpAccountOf(res)));
  }),

  application: asyncHandler(async (_req: Request, res: Response) => {
    ApiResponse.ok(res, await edpApplicationService.get(edpAccountOf(res)));
  }),
  saveStep: asyncHandler(async (req: Request, res: Response) => {
    const { step } = params<{ step: number }>(req);
    ApiResponse.ok(res, await edpApplicationService.saveStep(edpAccountOf(res), step, body<SaveStepBody>(req)), 'Saved');
  }),
  uploadDocuments: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await edpApplicationService.uploadDocuments(edpAccountOf(res), uploadedFiles(req)), 'Uploaded');
  }),
  removeDocument: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await edpApplicationService.removeDocument(edpAccountOf(res), params<{ docType: string }>(req).docType), 'Removed');
  }),
  documentFile: asyncHandler(async (req: Request, res: Response) => {
    const f = await edpApplicationService.documentFile(edpAccountOf(res), params<{ docType: string }>(req).docType);
    res.setHeader('Content-Type', f.mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(f.name)}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    f.stream.on('error', (err) => res.destroy(err));
    f.stream.pipe(res);
  }),
  submit: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.created(res, await edpApplicationService.submit(req, edpAccountOf(res), body<SubmitBody>(req)), EDP_MESSAGES.SUBMITTED);
  }),

  manageLogin: asyncHandler(async (req: Request, res: Response) => {
    const b = body<Email & { password: string }>(req);
    ApiResponse.ok(res, await edpManageService.login(b.email, b.password), 'Logged in');
  }),
  manageMe: asyncHandler(async (_req: Request, res: Response) => {
    const a = edpAdminOf(res);
    ApiResponse.ok(res, { id: a.id, name: a.name, email: a.email });
  }),
  manageSummary: asyncHandler(async (_req: Request, res: Response) => {
    ApiResponse.ok(res, await edpManageService.summary());
  }),
  manageList: asyncHandler(async (req: Request, res: Response) => {
    const { items, meta } = await edpManageService.list(query<ManageListQuery>(req));
    ApiResponse.ok(res, items, undefined, meta);
  }),
  manageFollowUps: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await edpManageService.followUps(params<{ id: string }>(req).id));
  }),
  manageAddFollowUp: asyncHandler(async (req: Request, res: Response) => {
    const history = await edpManageService.addFollowUp(req, edpAdminOf(res), params<{ id: string }>(req).id, body<FollowUpBody>(req));
    ApiResponse.created(res, history, 'Follow-up saved');
  }),
};
