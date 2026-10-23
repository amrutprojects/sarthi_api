import type { Request, Response } from 'express';
import { body, params } from '../../middleware/validate-request.middleware';
import { ApiResponse } from '../../utils/api-response';
import { asyncHandler } from '../../shared/http/async-handler';
import { aboutCards, aboutFacts, aboutService } from './about.service';
import type { CreateCardBody, CreateFactBody, ReorderBody, UpdateCardBody, UpdateFactBody, UpdateSectionBody } from './about.validator';

type IdParams = { id: string };

/* Request bodies name the two texts after the record (label/value, heading/description); the shared list service calls them first/second. */
const factInput = ({ label, value, ...rest }: UpdateFactBody) => ({ first: label, second: value, ...rest });
const cardInput = ({ heading, description, ...rest }: UpdateCardBody) => ({ first: heading, second: description, ...rest });


export const aboutController = {
  get: asyncHandler(async (_req: Request, res: Response) => {
    ApiResponse.ok(res, await aboutService.getAdmin(), 'About AMRUT retrieved successfully');
  }),

  updateSection: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await aboutService.updateSection(body<UpdateSectionBody>(req), req), 'About AMRUT section updated successfully');
  }),

  /* Information rows */
  getFact: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await aboutFacts.get(params<IdParams>(req).id), 'Information row retrieved successfully');
  }),
  createFact: asyncHandler(async (req: Request, res: Response) => {
    const b = body<CreateFactBody>(req);
    ApiResponse.created(res, await aboutFacts.create({ ...factInput(b), first: b.label, second: b.value }, req), 'Information row created successfully');
  }),
  updateFact: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await aboutFacts.update(params<IdParams>(req).id, factInput(body<UpdateFactBody>(req)), req), 'Information row updated successfully');
  }),
  setFactStatus: asyncHandler(async (req: Request, res: Response) => {
    const { isActive } = body<{ isActive: boolean }>(req);
    const data = await aboutFacts.setActive(params<IdParams>(req).id, isActive, req);
    ApiResponse.ok(res, data, isActive ? 'Information row shown on the website' : 'Information row hidden from the website');
  }),
  removeFact: asyncHandler(async (req: Request, res: Response) => {
    await aboutFacts.remove(params<IdParams>(req).id, req);
    ApiResponse.ok(res, null, 'Information row deleted successfully');
  }),
  reorderFacts: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await aboutFacts.reorder(body<ReorderBody>(req).ids, req), 'Display order updated successfully');
  }),

  /* About cards */
  getCard: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await aboutCards.get(params<IdParams>(req).id), 'About card retrieved successfully');
  }),
  createCard: asyncHandler(async (req: Request, res: Response) => {
    const b = body<CreateCardBody>(req);
    ApiResponse.created(res, await aboutCards.create({ ...cardInput(b), first: b.heading, second: b.description }, req), 'About card created successfully');
  }),
  updateCard: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await aboutCards.update(params<IdParams>(req).id, cardInput(body<UpdateCardBody>(req)), req), 'About card updated successfully');
  }),
  setCardStatus: asyncHandler(async (req: Request, res: Response) => {
    const { isActive } = body<{ isActive: boolean }>(req);
    const data = await aboutCards.setActive(params<IdParams>(req).id, isActive, req);
    ApiResponse.ok(res, data, isActive ? 'About card shown on the website' : 'About card hidden from the website');
  }),
  removeCard: asyncHandler(async (req: Request, res: Response) => {
    await aboutCards.remove(params<IdParams>(req).id, req);
    ApiResponse.ok(res, null, 'About card deleted successfully');
  }),
  reorderCards: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await aboutCards.reorder(body<ReorderBody>(req).ids, req), 'Display order updated successfully');
  }),

  /*
   * Public read. `null` is a legitimate answer — the section has not been configured — so it is a
   * 200 with no data rather than a 404.
   */
  public: asyncHandler(async (_req: Request, res: Response) => {
    const data = await aboutService.getPublic();
    ApiResponse.ok(res, data, data ? 'About AMRUT retrieved successfully' : 'The About AMRUT section is not configured');
  }),
};
