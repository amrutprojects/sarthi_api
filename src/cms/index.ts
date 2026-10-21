import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.middleware';
import { contactRouter } from './contact/contact.routes';
import { footerRouter } from './footer/footer.routes';
import { modulesRouter } from './modules/modules.routes';
import { faqRouter } from './faq/faq.routes';
import { eligibilityRouter } from './eligibility/eligibility.routes';
import { mastersRouter } from './masters';
import { programmeMastersRouter } from '../masters';

export {
  CMS_ENTITIES,
  ContactOrganization,
  ContactPageSettings,
  District,
  EligibilityItem,
  EligibilityPageSettings,
  Faq,
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
export { publicFaqRouter } from './faq/faq.public.routes';
export { publicEligibilityRouter } from './eligibility/eligibility.public.routes';

/*
 * /api/v1/cms — the whole CMS: the geography masters, the Masters sidebar group (src/masters) and the
 * website content (contact, footer, programme modules, FAQs, eligibility).
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
cmsRouter.use('/faqs', faqRouter);
cmsRouter.use('/eligibility', eligibilityRouter);
/* Mounted at the root: the masters router carries its own /states, /districts and /talukas paths. */
cmsRouter.use('/', mastersRouter);
/* The Masters sidebar group (src/masters): /departments, /colleges, /training-centres, /batches, /documents … */
cmsRouter.use('/', programmeMastersRouter);
