import { Router } from 'express';
import { authenticate } from '../middleware/authenticate.middleware';
import { contactRouter } from './contact/contact.routes';
import { footerRouter } from './footer/footer.routes';
import { modulesRouter } from './modules/modules.routes';
import { highlightRouter } from './highlight/highlight.routes';
import { programmeRouter } from './programme/programme.routes';
import { faqRouter } from './faq/faq.routes';
import { eligibilityRouter } from './eligibility/eligibility.routes';
import { applyRouter } from './apply/apply.routes';
import { mastersRouter } from './masters';
import { programmeMastersRouter } from '../masters';
import { heroRouter } from './hero/hero.routes';
import { boardRouter } from './board/board.routes';
import { advisoryRouter } from './advisory/advisory.routes';
import { ecosystemRouter } from './ecosystem/ecosystem.routes';
import { schemesRouter } from './schemes/schemes.routes';
import { aboutRouter } from './about/about.routes';
import { impactRouter } from './impact/impact.routes';
import { announcementsRouter } from './announcements/announcements.routes';
import { topBarRouter } from './topbar/topbar.routes';
import { brandBarRouter } from './brandbar/brandbar.routes';
import { navMenuRouter } from './navmenu/navmenu.routes';
import { quickActionsRouter } from './quickactions/quickactions.routes';
import { visibilityRouter } from './visibility/visibility.routes';
import { pageBannersRouter } from './pagebanners/pagebanners.routes';
import { liveDashboardRouter } from './livedashboard/livedashboard.routes';

export {
  ApplyPageItem,
  ApplyPageSettings,
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
export { publicHighlightRouter } from './highlight/highlight.public.routes';
export { publicProgrammeRouter } from './programme/programme.public.routes';
export { publicFaqRouter } from './faq/faq.public.routes';
export { publicEligibilityRouter } from './eligibility/eligibility.public.routes';
export { publicApplyRouter } from './apply/apply.public.routes';
export { publicHeroRouter } from './hero/hero.public.routes';
export { publicBoardRouter } from './board/board.public.routes';
export { publicAdvisoryRouter } from './advisory/advisory.public.routes';
export { publicEcosystemRouter } from './ecosystem/ecosystem.public.routes';
export { publicSchemesRouter } from './schemes/schemes.public.routes';
export { publicAboutRouter } from './about/about.public.routes';
export { publicImpactRouter } from './impact/impact.public.routes';
export { publicAnnouncementsRouter } from './announcements/announcements.public.routes';
export { publicTopBarRouter } from './topbar/topbar.public.routes';
export { publicBrandBarRouter } from './brandbar/brandbar.public.routes';
export { publicNavMenuRouter } from './navmenu/navmenu.public.routes';
export { publicQuickActionsRouter } from './quickactions/quickactions.public.routes';
export { publicPageBannersRouter } from './pagebanners/pagebanners.public.routes';
export { publicLiveDashboardRouter } from './livedashboard/livedashboard.public.routes';

/*
 * /api/v1/cms — the whole CMS: the geography masters, the Masters sidebar group (src/masters) and the
 * website content (contact, footer, programme modules, FAQs, eligibility, apply).
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
cmsRouter.use('/faqs', faqRouter);
cmsRouter.use('/eligibility', eligibilityRouter);
cmsRouter.use('/apply', applyRouter);
cmsRouter.use('/hero', heroRouter);
cmsRouter.use('/board-members', boardRouter);
cmsRouter.use('/advisory-committee', advisoryRouter);
cmsRouter.use('/ecosystem', ecosystemRouter);
cmsRouter.use('/schemes', schemesRouter);
cmsRouter.use('/about', aboutRouter);
cmsRouter.use('/impact', impactRouter);
cmsRouter.use('/announcements', announcementsRouter);
cmsRouter.use('/top-bar', topBarRouter);
cmsRouter.use('/brand-bar', brandBarRouter);
cmsRouter.use('/nav-menu', navMenuRouter);
cmsRouter.use('/quick-actions', quickActionsRouter);
cmsRouter.use('/section-visibility', visibilityRouter);
cmsRouter.use('/page-banners', pageBannersRouter);
cmsRouter.use('/live-dashboard', liveDashboardRouter);
/* Mounted at the root: the masters router carries its own /states, /districts and /talukas paths. */
cmsRouter.use('/', mastersRouter);
/* The Masters sidebar group (src/masters): /departments, /colleges, /training-centres, /batches, /documents … */
cmsRouter.use('/', programmeMastersRouter);
