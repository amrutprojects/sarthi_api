import type { Request, Response } from 'express';
import { MESSAGES } from '../../constants/api-response.constants';
import { body, params, query } from '../../middleware/validate-request.middleware';
import { asyncHandler } from '../../shared/http/async-handler';
import { ApiResponse } from '../../utils/api-response';
import { ippApprovalsService as service, type DecidedMany } from './ipp-approvals.service';
import type { ListApplicationsQuery, ListBatchesQuery } from './ipp-approvals.validation';
import { ippDocumentService } from './ipp-document.service';
import { ippHeadOfficeService } from './ipp-head-office.service';
import { ippLinkService } from './ipp-link.service';
import { ippOfficersService } from './ipp-officers.service';

type Id = { id: string };
const decided = (r: DecidedMany) =>
  `${r.approved} ${r.approved === 1 ? 'form' : 'forms'} approved${r.skipped ? `, ${r.skipped} skipped (not yours to decide now)` : ''}`;

export const ippApprovalsController = {
  summary: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await service.summary(req.auth!), MESSAGES.retrieved('Summary'));
  }),
  dashboard: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await service.dashboard(req.auth!), MESSAGES.retrieved('Dashboard'));
  }),

  listApplications: asyncHandler(async (req: Request, res: Response) => {
    const { items, meta } = await service.listApplications(req.auth!, query<ListApplicationsQuery>(req));
    ApiResponse.ok(res, items, MESSAGES.retrieved('Applications'), meta);
  }),
  application: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await service.application(req.auth!, params<Id>(req).id), MESSAGES.retrieved('Application'));
  }),
  document: asyncHandler(async (req: Request, res: Response) => {
    const { id, code } = params<Id & { code: string }>(req);
    await ippDocumentService.send(req, res, id, code);
  }),

  approveMany: asyncHandler(async (req: Request, res: Response) => {
    const { ids, reason } = body<{ ids: string[]; reason?: string }>(req);
    const result = await service.approveMany(req, ids, reason ?? null);
    ApiResponse.ok(res, result, decided(result));
  }),
  approveBatch: asyncHandler(async (req: Request, res: Response) => {
    const result = await service.approveBatch(req, params<Id>(req).id, body<{ reason?: string }>(req).reason ?? null);
    ApiResponse.ok(res, result, decided(result));
  }),
  approve: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await service.approve(req, params<Id>(req).id, body<{ reason?: string }>(req).reason ?? null), 'Form approved');
  }),
  reject: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await service.reject(req, params<Id>(req).id, body<{ reason: string }>(req).reason), 'Form sent back');
  }),

  listBatches: asyncHandler(async (req: Request, res: Response) => {
    const { items, meta } = await service.listBatches(req.auth!, query<ListBatchesQuery>(req));
    ApiResponse.ok(res, items, MESSAGES.retrieved('Batches'), meta);
  }),
  batch: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await service.batch(req.auth!, params<Id>(req).id), MESSAGES.retrieved('Batch'));
  }),
  districts: asyncHandler(async (_req: Request, res: Response) => {
    ApiResponse.ok(res, await service.districts(), MESSAGES.retrieved('Districts'));
  }),

  headOffice: asyncHandler(async (_req: Request, res: Response) => {
    ApiResponse.ok(res, await ippHeadOfficeService.state(), MESSAGES.retrieved('Head Office approval'));
  }),
  setHeadOffice: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(
      res,
      await ippHeadOfficeService.set(req, body<{ enabled: boolean }>(req).enabled),
      MESSAGES.updated('Head Office approval'),
    );
  }),

  officers: asyncHandler(async (_req: Request, res: Response) => {
    ApiResponse.ok(res, await ippOfficersService.list(), MESSAGES.retrieved('Divisional Officers'));
  }),
  setOfficerDistricts: asyncHandler(async (req: Request, res: Response) => {
    const officer = await ippOfficersService.setDistricts(
      req,
      params<{ userId: string }>(req).userId,
      body<{ districtIds: string[] }>(req).districtIds,
    );
    ApiResponse.ok(res, officer, MESSAGES.updated('Districts of the officer'));
  }),

  link: asyncHandler(async (_req: Request, res: Response) => {
    ApiResponse.ok(res, await ippLinkService.status(), MESSAGES.retrieved('Link with IPP'));
  }),
  retryLink: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await ippLinkService.retry(req, body<{ ids?: string[] }>(req).ids), 'Decisions queued again');
  }),
  testLink: asyncHandler(async (_req: Request, res: Response) => {
    const result = await ippLinkService.test();
    ApiResponse.ok(res, result, result.message);
  }),
};
