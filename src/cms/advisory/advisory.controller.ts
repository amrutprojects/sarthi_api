import type { Request, Response } from 'express';
import { body, params } from '../../middleware/validate-request.middleware';
import { ApiResponse } from '../../utils/api-response';
import { asyncHandler } from '../../shared/http/async-handler';
import { inspectPhoto, uploadedPhoto } from './advisory.photo';
import { advisoryService } from './advisory.service';
import type {
  CreateGroupBody,
  CreateMemberBody,
  GroupOrderBody,
  PhotoFileParams,
  ReorderBody,
  UpdateGroupBody,
  UpdateMemberBody,
  UpdateSectionBody,
} from './advisory.validator';

type IdParams = { id: string };

export const advisoryController = {
  list: asyncHandler(async (_req: Request, res: Response) => {
    ApiResponse.ok(res, await advisoryService.listForAdmin(), 'Advisory committee members retrieved successfully');
  }),

  get: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await advisoryService.getForAdmin(params<IdParams>(req).id), 'Advisory committee member retrieved successfully');
  }),

  create: asyncHandler(async (req: Request, res: Response) => {
    const data = await advisoryService.create(body<CreateMemberBody>(req), inspectPhoto(uploadedPhoto(req)), req);
    ApiResponse.created(res, data, 'Advisory committee member created successfully');
  }),

  update: asyncHandler(async (req: Request, res: Response) => {
    const data = await advisoryService.update(params<IdParams>(req).id, body<UpdateMemberBody>(req), inspectPhoto(uploadedPhoto(req)), req);
    ApiResponse.ok(res, data, 'Advisory committee member updated successfully');
  }),

  setStatus: asyncHandler(async (req: Request, res: Response) => {
    const { isActive } = body<{ isActive: boolean }>(req);
    const data = await advisoryService.setActive(params<IdParams>(req).id, isActive, req);
    ApiResponse.ok(
      res,
      data,
      isActive ? 'Advisory committee member shown on the website' : 'Advisory committee member hidden from the website',
    );
  }),

  remove: asyncHandler(async (req: Request, res: Response) => {
    await advisoryService.remove(params<IdParams>(req).id, req);
    ApiResponse.ok(res, null, 'Advisory committee member deleted successfully');
  }),

  reorder: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await advisoryService.reorder(body<ReorderBody>(req).ids, req), 'Display order updated successfully');
  }),

  listGroups: asyncHandler(async (_req: Request, res: Response) => {
    ApiResponse.ok(res, await advisoryService.listGroups(), 'Advisory committee groups retrieved successfully');
  }),

  getGroup: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await advisoryService.getGroup(params<IdParams>(req).id), 'Advisory committee group retrieved successfully');
  }),

  createGroup: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.created(
      res,
      await advisoryService.createGroup(body<CreateGroupBody>(req), req),
      'Advisory committee group created successfully',
    );
  }),

  updateGroup: asyncHandler(async (req: Request, res: Response) => {
    const data = await advisoryService.updateGroup(params<IdParams>(req).id, body<UpdateGroupBody>(req), req);
    ApiResponse.ok(res, data, 'Advisory committee group updated successfully');
  }),

  setGroupStatus: asyncHandler(async (req: Request, res: Response) => {
    const { isActive } = body<{ isActive: boolean }>(req);
    const data = await advisoryService.setGroupActive(params<IdParams>(req).id, isActive, req);
    ApiResponse.ok(
      res,
      data,
      isActive ? 'Advisory committee group shown on the website' : 'Advisory committee group hidden from the website',
    );
  }),

  removeGroup: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await advisoryService.removeGroup(params<IdParams>(req).id, req), 'Advisory committee group deleted successfully');
  }),

  reorderGroups: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await advisoryService.reorderGroups(body<GroupOrderBody>(req).ids, req), 'Group order updated successfully');
  }),

  getSection: asyncHandler(async (_req: Request, res: Response) => {
    ApiResponse.ok(res, await advisoryService.getSection(), 'Section settings retrieved successfully');
  }),

  updateSection: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await advisoryService.updateSection(body<UpdateSectionBody>(req), req), 'Section settings updated successfully');
  }),

  adminPhoto: asyncHandler(async (req: Request, res: Response) => {
    await advisoryService.sendPhoto(res, params<PhotoFileParams>(req).file, 'admin');
  }),

  /*
   * Public read. `null` is a legitimate answer — the section has not been configured — so it is a
   * 200 with no data rather than a 404.
   */
  public: asyncHandler(async (_req: Request, res: Response) => {
    const data = await advisoryService.getPublic();
    ApiResponse.ok(res, data, data ? 'Advisory committee retrieved successfully' : 'The advisory committee section is not configured');
  }),

  publicPhoto: asyncHandler(async (req: Request, res: Response) => {
    await advisoryService.sendPhoto(res, params<PhotoFileParams>(req).file, 'public');
  }),
};
