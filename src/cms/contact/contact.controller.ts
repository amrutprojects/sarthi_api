import type { Request, Response } from 'express';
import { body, params, query } from '../../middleware/validate-request.middleware';
import { ApiResponse } from '../../utils/api-response';
import { asyncHandler } from '../../shared/http/async-handler';
import { contactService } from './contact.service';
import type {
  ContactStatusBody,
  CreateCoordinatorBody,
  CreateDistrictOfficeBody,
  CreateTrainingCentreBody,
  DistrictOfficesSectionBody,
  ListCoordinatorsQuery,
  ListDistrictOfficesQuery,
  ListTrainingCentresQuery,
  TrainingCentresSectionBody,
  UpdateContactPageBody,
  UpdateCoordinatorBody,
  UpdateDistrictOfficeBody,
  UpdateTrainingCentreBody,
} from './contact.validator';

type IdParams = { id: string };

export const contactController = {
  /* Admin read: the whole configuration, including unpublished and inactive cards. */
  get: asyncHandler(async (_req: Request, res: Response) => {
    ApiResponse.ok(res, await contactService.getForAdmin(), 'Contact page settings retrieved successfully');
  }),

  update: asyncHandler(async (req: Request, res: Response) => {
    const data = await contactService.update(body<UpdateContactPageBody>(req), req);
    ApiResponse.ok(res, data, 'Contact page updated successfully');
  }),

  setPublished: asyncHandler(async (req: Request, res: Response) => {
    const { isPublished } = body<ContactStatusBody>(req);
    const data = await contactService.setPublished(isPublished, req);
    ApiResponse.ok(res, data, isPublished ? 'Contact page published' : 'Contact page unpublished');
  }),

  setDistrictOfficesSection: asyncHandler(async (req: Request, res: Response) => {
    const { show } = body<DistrictOfficesSectionBody>(req);
    const data = await contactService.setDistrictOfficesSection(show, req);
    ApiResponse.ok(res, data, show ? 'District offices shown on the website' : 'District offices hidden from the website');
  }),

  /* ---- District / cluster coordinators ---- */

  listCoordinators: asyncHandler(async (req: Request, res: Response) => {
    const page = await contactService.listCoordinators(query<ListCoordinatorsQuery>(req));
    ApiResponse.ok(res, page.items, 'Coordinators retrieved successfully', page.meta);
  }),

  getCoordinator: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await contactService.getCoordinator(params<IdParams>(req).id), 'Coordinator retrieved successfully');
  }),

  createCoordinator: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.created(
      res,
      await contactService.createCoordinator(body<CreateCoordinatorBody>(req), req),
      'Coordinator created successfully',
    );
  }),
  

  updateCoordinator: asyncHandler(async (req: Request, res: Response) => {
    const data = await contactService.updateCoordinator(params<IdParams>(req).id, body<UpdateCoordinatorBody>(req), req);
    ApiResponse.ok(res, data, 'Coordinator updated successfully');
  }),

  setCoordinatorStatus: asyncHandler(async (req: Request, res: Response) => {
    const { isActive } = body<{ isActive: boolean }>(req);
    const data = await contactService.setCoordinatorStatus(params<IdParams>(req).id, isActive, req);
    ApiResponse.ok(res, data, isActive ? 'Coordinator activated' : 'Coordinator deactivated');
  }),

  removeCoordinator: asyncHandler(async (req: Request, res: Response) => {
    await contactService.removeCoordinator(params<IdParams>(req).id, req);
    ApiResponse.ok(res, null, 'Coordinator deleted successfully');
  }),

  
  /* ---- District offices ---- */

  listDistrictOffices: asyncHandler(async (req: Request, res: Response) => {  
    const page = await contactService.listDistrictOffices(query<ListDistrictOfficesQuery>(req));
    ApiResponse.ok(res, page.items, 'District offices retrieved successfully', page.meta);
  }),

  getDistrictOffice: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await contactService.getDistrictOffice(params<IdParams>(req).id), 'District office retrieved successfully');
  }),

  createDistrictOffice: asyncHandler(async (req: Request, res: Response) => {
    const data = await contactService.createDistrictOffice(body<CreateDistrictOfficeBody>(req), req);
    ApiResponse.created(res, data, 'District office created successfully');
  }),

  updateDistrictOffice: asyncHandler(async (req: Request, res: Response) => {
    const data = await contactService.updateDistrictOffice(params<IdParams>(req).id, body<UpdateDistrictOfficeBody>(req), req);
    ApiResponse.ok(res, data, 'District office updated successfully');
  }),

  setDistrictOfficeStatus: asyncHandler(async (req: Request, res: Response) => {
    const { isActive } = body<{ isActive: boolean }>(req);
    const data = await contactService.setDistrictOfficeStatus(params<IdParams>(req).id, isActive, req);
    ApiResponse.ok(res, data, isActive ? 'District office activated' : 'District office deactivated');
  }),

  removeDistrictOffice: asyncHandler(async (req: Request, res: Response) => {
    await contactService.removeDistrictOffice(params<IdParams>(req).id, req);
    ApiResponse.ok(res, null, 'District office deleted successfully');
  }),

  /* ---- Approved training centres ---- */

  setTrainingCentresSection: asyncHandler(async (req: Request, res: Response) => {
    const { show } = body<TrainingCentresSectionBody>(req);
    const data = await contactService.setTrainingCentresSection(show, req);
    ApiResponse.ok(res, data, show ? 'Training centres shown on the website' : 'Training centres hidden from the website');
  }),

  listTrainingCentres: asyncHandler(async (req: Request, res: Response) => {
    const page = await contactService.listTrainingCentres(query<ListTrainingCentresQuery>(req));
    ApiResponse.ok(res, page.items, 'Training centres retrieved successfully', page.meta);
  }),

  getTrainingCentre: asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.ok(res, await contactService.getTrainingCentre(params<IdParams>(req).id), 'Training centre retrieved successfully');
  }),

  createTrainingCentre: asyncHandler(async (req: Request, res: Response) => {
    const data = await contactService.createTrainingCentre(body<CreateTrainingCentreBody>(req), req);
    ApiResponse.created(res, data, 'Training centre created successfully');
  }),

  updateTrainingCentre: asyncHandler(async (req: Request, res: Response) => {
    const data = await contactService.updateTrainingCentre(params<IdParams>(req).id, body<UpdateTrainingCentreBody>(req), req);
    ApiResponse.ok(res, data, 'Training centre updated successfully');
  }),

  setTrainingCentreStatus: asyncHandler(async (req: Request, res: Response) => {
    const { isActive } = body<{ isActive: boolean }>(req);
    const data = await contactService.setTrainingCentreStatus(params<IdParams>(req).id, isActive, req);
    ApiResponse.ok(res, data, isActive ? 'Training centre activated' : 'Training centre deactivated');
  }),

  removeTrainingCentre: asyncHandler(async (req: Request, res: Response) => {
    await contactService.removeTrainingCentre(params<IdParams>(req).id, req);
    ApiResponse.ok(res, null, 'Training centre deleted successfully');
  }),

  /*
   * Public read. `null` is a legitimate answer — the page is unpublished or not yet configured — so
   * it is a 200 with no data rather than a 404: the website treats it as "show the bundled copy",
   * which is not an error condition.
   */
  
  public: asyncHandler(async (_req: Request, res: Response) => {
    const data = await contactService.getPublic();
    ApiResponse.ok(res, data, data ? 'Contact page retrieved successfully' : 'Contact page is not published');
  }),
};

