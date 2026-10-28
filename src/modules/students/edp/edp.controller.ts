import type { Request, Response } from 'express';
import { body, params, query } from '../../../middleware/validate-request.middleware';
import { asyncHandler } from '../../../shared/http/async-handler';
import { ApiResponse } from '../../../utils/api-response';
import { uploadedFiles } from '../registration/registration-upload.middleware';
import { EDP_MESSAGES, EDP_RESET_LINK_MINUTES, EDP_RESET_RESEND_SECONDS } from './edp.constants';
import { accountDto, edpAccountService } from './edp-account.service';
import { edpApplicationService } from './edp-application.service';
import { edpManageService } from './edp-manage.service';
import { edpSettingsService } from './edp-settings.service';
import { edpAccountOf, edpAdminOf } from './edp.security';
import { ZipFile } from 'yazl';

/* A download's Content-Disposition: an ASCII fallback name and the exact name (RFC 6266 / 5987). */
const attachment = (name: string) =>
  `attachment; filename="${name.replace(/[^A-Za-z0-9._-]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`;
import { geographyService } from '../../../cms/masters/geography/geography.service';
import { centreService } from '../../../masters/centre/centre.service';
import type { CreateCentreBody, ListCentresQuery, UpdateCentreBody } from '../../../masters/centre/centre.validator';
import type {
  FollowUpBody,
  ManageListQuery,
  NewUserBody,
  ResetPasswordBody,
  SupportBody,
  SaveStepBody,
  SignupBody,
  SubmitBody,
} from './edp.validation';

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
    ApiResponse.ok(res, { id: a.id, name: a.name, email: a.email, role: a.role });
  }),
  manageSummary: asyncHandler(async (_req: Request, res: Response) => {
    ApiResponse.ok(res, await edpManageService.summary());
  }),
  manageList: asyncHandler(async (req: Request, res: Response) => {
    const { items, meta } = await edpManageService.list(query<ManageListQuery>(req));
    ApiResponse.ok(res, items, undefined, meta);
  }),
  /* One candidate in full (View), and a document of theirs. */
  manageApplicant: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await edpApplicationService.adminView(params<{ id: string }>(req).id));
  }),
  manageApplicantFile: asyncHandler(async (req: Request, res: Response) => {
    const { id, docType } = params<{ id: string; docType: string }>(req);
    const file = await edpApplicationService.adminDocumentFile(id, docType);
    /* ?download=1 saves it under the candidate's name (EDP-000001_Kavya_Jadhav_Photo.pdf); otherwise it opens inline. */
    const download = query<{ download?: '0' | '1' }>(req).download === '1';
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Disposition', download ? attachment(file.downloadName) : `inline; filename="${encodeURIComponent(file.name)}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    file.stream.on('error', (err) => res.destroy(err));
    file.stream.pipe(res);
  }),
  /* All of a candidate's documents as one ZIP holding one folder (EDP-000001_Kavya_Jadhav/01_Photo.pdf, …). */
  manageApplicantZip: asyncHandler(async (req: Request, res: Response) => {
    const { folder, entries } = await edpApplicationService.adminDocumentsFolder(params<{ id: string }>(req).id);
    const zip = new ZipFile();
    for (const e of entries) {
      const stream = await e.open();
      stream.on('error', (err) => res.destroy(err));
      zip.addReadStream(stream, e.path);
    }
    zip.end();
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', attachment(`${folder}.zip`));
    res.setHeader('Cache-Control', 'private, no-store');
    zip.outputStream.on('error', (err) => res.destroy(err));
    zip.outputStream.pipe(res);
  }),
  /* The support contact line: any tracking panel user reads it, an ADMIN saves it. */
  manageSupport: asyncHandler(async (_req: Request, res: Response) => {
    ApiResponse.ok(res, await edpSettingsService.supportForAdmin());
  }),
  manageSaveSupport: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await edpSettingsService.saveSupport(req, edpAdminOf(res), body<SupportBody>(req)), 'Support contact saved');
  }),
  /* Tracking panel users (ADMIN only). */
  manageUsers: asyncHandler(async (_req: Request, res: Response) => {
    ApiResponse.ok(res, await edpManageService.users());
  }),
  manageAddUser: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.created(res, await edpManageService.addUser(req, edpAdminOf(res), body<NewUserBody>(req)), 'User added');
  }),
  manageUserStatus: asyncHandler(async (req: Request, res: Response) => {
    const { is_active } = body<{ is_active: boolean }>(req);
    const user = await edpManageService.setUserStatus(req, edpAdminOf(res), params<{ id: string }>(req).id, is_active);
    ApiResponse.ok(res, user, is_active ? 'User activated' : 'User deactivated');
  }),
  manageFollowUps: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await edpManageService.followUps(params<{ id: string }>(req).id));
  }),
  manageAddFollowUp: asyncHandler(async (req: Request, res: Response) => {
    const history = await edpManageService.addFollowUp(req, edpAdminOf(res), params<{ id: string }>(req).id, body<FollowUpBody>(req));
    ApiResponse.created(res, history, 'Follow-up saved');
  }),

  /* Step 1's dependent Taluka dropdown and step 2's Technology dropdown (the centre's technologies). */
  districtTalukas: asyncHandler(async (req: Request, res: Response) => {
    const rows = await geographyService.talukasOfDistrict(params<{ districtId: string }>(req).districtId);
    ApiResponse.ok(
      res,
      rows.map(({ id, name, code }) => ({ id, name, code })),
    );
  }),
  centreTechnologies: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await edpApplicationService.centreTechnologies(params<{ centreId: string }>(req).centreId));
  }),

  /* Center Master in the tracking panel: the Amrut admin panel's Center Master service, as an EDP admin. */
  manageCentres: asyncHandler(async (req: Request, res: Response) => {
    const page = await centreService.list(query<ListCentresQuery>(req));
    ApiResponse.ok(res, page.items, 'Centers retrieved successfully', page.meta);
  }),
  manageCentre: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await centreService.get(params<{ id: string }>(req).id));
  }),
  manageCreateCentre: asyncHandler(async (req: Request, res: Response) => {
    const created = await centreService.create(body<CreateCentreBody>(req), req, { edpAdminId: edpAdminOf(res).id });
    ApiResponse.created(res, created, 'Center created successfully');
  }),
  manageUpdateCentre: asyncHandler(async (req: Request, res: Response) => {
    const updated = await centreService.update(params<{ id: string }>(req).id, body<UpdateCentreBody>(req), req, {
      edpAdminId: edpAdminOf(res).id,
    });
    ApiResponse.ok(res, updated, 'Center updated successfully');
  }),
  manageCentreStatus: asyncHandler(async (req: Request, res: Response) => {
    const { isActive } = body<{ isActive: boolean }>(req);
    const updated = await centreService.setStatus(params<{ id: string }>(req).id, isActive, req, { edpAdminId: edpAdminOf(res).id });
    ApiResponse.ok(res, updated, isActive ? 'Center activated' : 'Center deactivated');
  }),
  manageTechnologyOptions: asyncHandler(async (_req: Request, res: Response) => {
    ApiResponse.ok(res, await centreService.technologyOptions());
  }),
};
