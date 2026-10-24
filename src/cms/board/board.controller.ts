import type { Request, Response } from 'express';
import { body, params } from '../../middleware/validate-request.middleware';
import { ApiResponse } from '../../utils/api-response';
import { asyncHandler } from '../../shared/http/async-handler';
import { inspectPhoto, uploadedPhoto } from './board.photo';
import { boardService } from './board.service';
import type { CreateMemberBody, PhotoFileParams, ReorderBody, UpdateMemberBody, UpdateSectionBody } from './board.validator';

type IdParams = { id: string };

export const boardController = {
  list: asyncHandler(async (_req: Request, res: Response) => {
    ApiResponse.ok(res, await boardService.listForAdmin(), 'Board members retrieved successfully');
  }),

  get: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await boardService.getForAdmin(params<IdParams>(req).id), 'Board member retrieved successfully');
  }),

  create: asyncHandler(async (req: Request, res: Response) => {
    const data = await boardService.create(body<CreateMemberBody>(req), inspectPhoto(uploadedPhoto(req)), req);
    ApiResponse.created(res, data, 'Board member created successfully');
  }),

  update: asyncHandler(async (req: Request, res: Response) => {
    const data = await boardService.update(params<IdParams>(req).id, body<UpdateMemberBody>(req), inspectPhoto(uploadedPhoto(req)), req);
    ApiResponse.ok(res, data, 'Board member updated successfully');
  }),

  setStatus: asyncHandler(async (req: Request, res: Response) => {
    const { isActive } = body<{ isActive: boolean }>(req);
    const data = await boardService.setActive(params<IdParams>(req).id, isActive, req);
    ApiResponse.ok(res, data, isActive ? 'Board member shown on the website' : 'Board member hidden from the website');
  }),

  remove: asyncHandler(async (req: Request, res: Response) => {
    await boardService.remove(params<IdParams>(req).id, req);
    ApiResponse.ok(res, null, 'Board member deleted successfully');
  }),

  reorder: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await boardService.reorder(body<ReorderBody>(req).ids, req), 'Display order updated successfully');
  }),

  getSection: asyncHandler(async (_req: Request, res: Response) => {
    ApiResponse.ok(res, await boardService.getSection(), 'Section settings retrieved successfully');
  }),

  updateSection: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await boardService.updateSection(body<UpdateSectionBody>(req), req), 'Section settings updated successfully');
  }),

  adminPhoto: asyncHandler(async (req: Request, res: Response) => {
    await boardService.sendPhoto(res, params<PhotoFileParams>(req).file, 'admin');
  }),

  /*
   * Public read. `null` is a legitimate answer — the section has not been configured — so it is a
   * 200 with no data rather than a 404.
   */
  public: asyncHandler(async (_req: Request, res: Response) => {
    const data = await boardService.getPublic();
    ApiResponse.ok(res, data, data ? 'Board members retrieved successfully' : 'The board members section is not configured');
  }),

  publicPhoto: asyncHandler(async (req: Request, res: Response) => {
    await boardService.sendPhoto(res, params<PhotoFileParams>(req).file, 'public');
  }),
};
