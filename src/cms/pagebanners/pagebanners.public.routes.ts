import { Router } from 'express';
import { pageBannerController } from './pagebanners.controller';

/*
 * /api/v1/public/page-banners — the custom title and subtitle of the banner of each page that has one
 * managed. Every page comes back, in order; the site uses its default words where a value is null.
 *
 * Unauthenticated for the same reasons as the other public feeds: the site has no session. GET only;
 * the payload is just each key and its words; the global rate limiter applies.
 */
export const publicPageBannersRouter = Router();

publicPageBannersRouter.get('/', pageBannerController.public);
