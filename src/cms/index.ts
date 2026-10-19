import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.middleware';
import { contactRouter } from './contact/contact.routes';
import { footerRouter } from './footer/footer.routes';
import { modulesRouter } from './modules/modules.routes';
import { mastersRouter } from './masters';

export { CMS_ENTITIES, ContactOrganization, ContactPageSettings, District, FooterLink, FooterSection, FooterSettings, State, Taluka } from './cms.entities';
export { publicGeographyRouter } from './masters';
export { publicContactRouter } from './contact/contact.public.routes';
export { publicFooterRouter } from './footer/footer.public.routes';
export { publicModulesRouter } from './modules/modules.public.routes';

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
/* Mounted at the root: the masters router carries its own /states, /districts and /talukas paths. */
cmsRouter.use('/', mastersRouter);
