import type { Request, Response } from 'express';
import { body, params } from '../../middleware/validate-request.middleware';
import { ApiResponse } from '../../utils/api-response';
import { asyncHandler } from '../../shared/http/async-handler';
import { highlightService } from './highlight.service';
import type {
  HighlightRowParams,
  HighlightStatusBody,
  UpdateHighlightBody,
  UpdateHighlightRowBody,
} from './highlight.validator';

export const highlightController = {
  get: asyncHandler(async (_req: Request, res: Response) => {
    ApiResponse.ok(
      res,
      await highlightService.getForAdmin(),
      'Programme section retrieved successfully',
    );
  }),

  update: asyncHandler(async (req: Request, res: Response) => {
    const data = await highlightService.update(body<UpdateHighlightBody>(req), req);
    ApiResponse.ok(res, data, 'Programme section updated successfully');
  }),

  setPublished: asyncHandler(async (req: Request, res: Response) => {
    const { isPublished } = body<HighlightStatusBody>(req);
    const data = await highlightService.setPublished(isPublished, req);
    ApiResponse.ok(
      res,
      data,
      isPublished ? 'Programme section published' : 'Programme section unpublished',
    );
  }),

  /* One fact table row's switch and/or name. Returns the whole admin section, so the screen refreshes from the response. */
  setRow: asyncHandler(async (req: Request, res: Response) => {
    const { show, label } = body<UpdateHighlightRowBody>(req);
    const { key } = params<HighlightRowParams>(req);
    const data = await highlightService.setRow(key, { show, label }, req);
    const message =
      label === undefined
        ? show
          ? 'Row shown on the home page'
          : 'Row hidden from the home page'
        : show === undefined
          ? data.rowLabels[key]
            ? 'Row name saved'
            : 'Row name reset to the default'
          : 'Row updated';
    ApiResponse.ok(res, data, message);
  }),

  /*
   * Public read. `null` is a legitimate answer — not yet configured — so it is a 200 with no data
   * rather than a 404: the website treats it as "show the bundled copy". An unpublished section is
   * data with `showSection: false`, not null.
   */
  public: asyncHandler(async (_req: Request, res: Response) => {
    const data = await highlightService.getPublic();
    ApiResponse.ok(
      res,
      data,
      data ? 'Programme section retrieved successfully' : 'Programme section is not configured',
    );
  }),
};
