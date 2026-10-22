import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.middleware';
import { contactRouter } from './contact/contact.routes';
import { footerRouter } from './footer/footer.routes';
import { modulesRouter } from './modules/modules.routes';
import { highlightRouter } from './highlight/highlight.routes';
import { programmeRouter } from './programme/programme.routes';
import { mastersRouter } from './masters';
import { heroRouter } from './hero/hero.routes';
import { impactRouter } from './impact/impact.routes';

export {
  CMS_ENTITIES,
  ContactOrganization,
  ContactPageSettings,
  District,
  FooterLink,
  FooterSection,
  FooterSettings,
  State,
  Taluka,
} from './cms.entities';
export { publicGeographyRouter } from './masters';
export { publicContactRouter } from './contact/contact.public.routes';
export { publicFooterRouter } from './footer/footer.public.routes';
export { publicModulesRouter } from './modules/modules.public.routes';
export { publicHighlightRouter } from './highlight/highlight.public.routes';
export { publicProgrammeRouter } from './programme/programme.public.routes';
export { publicHeroRouter } from './hero/hero.public.routes';
export { publicImpactRouter } from './impact/impact.public.routes';

/*
 * /api/v1/cms — the whole CMS: the geography masters and the Contact page content.
 *
 * authenticate() runs once here for every CMS route; each route then declares the permission it
 * needs. The public, unauthenticated read feeds are separate routers (publicGeographyRouter,
 * publicContactRouter) mounted elsewhere, so nothing under /cms is reachable without a session.
 */
export const cmsRouter = Router();

cmsRouter.use(authenticate);
cmsRouter.use('/contact', contactRouter);
cmsRouter.use('/footer', footerRouter);
cmsRouter.use('/modules', modulesRouter);
cmsRouter.use('/highlight', highlightRouter);
cmsRouter.use('/programme', programmeRouter);
cmsRouter.use('/hero', heroRouter);
cmsRouter.use('/impact', impactRouter);
/* Mounted at the root: the masters router carries its own /states, /districts and /talukas paths. */
cmsRouter.use('/', mastersRouter);
