import { CONTACT_ENTITIES } from './contact/contact.entities';
import { FOOTER_ENTITIES } from './footer/footer.entities';
import { PROGRAMME_MODULE_ENTITIES } from './modules/modules.entities';
import { HIGHLIGHT_ENTITIES } from './highlight/highlight.entities';
import { FAQ_ENTITIES } from './faq/faq.entities';
import { ELIGIBILITY_ENTITIES } from './eligibility/eligibility.entities';
import { APPLY_ENTITIES } from './apply/apply.entities';
import { MASTER_ENTITIES } from './masters/masters.entities';
import { PROGRAMME_PAGE_ENTITIES } from './programme/programme.entities';
import { HERO_ENTITIES } from './hero/hero.entities';
import { BOARD_ENTITIES } from './board/board.entities';
import { ADVISORY_ENTITIES } from './advisory/advisory.entities';
import { ECOSYSTEM_ENTITIES } from './ecosystem/ecosystem.entities';
import { SCHEMES_ENTITIES } from './schemes/schemes.entities';
import { ABOUT_ENTITIES } from './about/about.entities';
import { IMPACT_ENTITIES } from './impact/impact.entities';
import { ANNOUNCEMENT_ENTITIES } from './announcements/announcements.entities';
import { TOPBAR_ENTITIES } from './topbar/topbar.entities';
import { BRANDBAR_ENTITIES } from './brandbar/brandbar.entities';

export { ContactOrganization, ContactPageSettings } from './contact/contact.entities';
export { District, State, Taluka } from './masters/masters.entities';
export { FooterLink, FooterSection, FooterSettings } from './footer/footer.entities';
export { ProgrammeElectiveDomain, ProgrammeModule, ProgrammeModuleSettings } from './modules/modules.entities';
export { ProgrammeHighlight, ProgrammeHighlightObjective } from './highlight/highlight.entities';
export { ProgrammePageSettings } from './programme/programme.entities';
export { Faq } from './faq/faq.entities';
export { EligibilityItem, EligibilityPageSettings } from './eligibility/eligibility.entities';
export { ApplyPageItem, ApplyPageSettings } from './apply/apply.entities';
export { HomeHero, HomeHeroSlide } from './hero/hero.entities';
export { BoardMember, BoardSection } from './board/board.entities';
export { AdvisoryGroup, AdvisoryMember, AdvisorySection } from './advisory/advisory.entities';
export { EcosystemProgramme, EcosystemSection } from './ecosystem/ecosystem.entities';
export { AmrutScheme, AmrutSchemesSection } from './schemes/schemes.entities';
export { AboutCard, AboutFact, AboutSection } from './about/about.entities';
export { ImpactSection, ImpactStat } from './impact/impact.entities';
export { Announcement, AnnouncementSettings } from './announcements/announcements.entities';
export { TopBarLink, TopBarSettings } from './topbar/topbar.entities';
export { BrandBarSettings } from './brandbar/brandbar.entities';

/*
 * Every model the CMS contributes to the DataSource, picked up by src/entities/index.ts.
 *
 * Deliberately a leaf module — it reaches only the two *.entities.ts files below it, never a router
 * or middleware. The entity registry is evaluated while the DataSource is being constructed, so an
 * import of the HTTP layer from here would close a require cycle and leave this array undefined at
 * the moment ENTITIES reads it.
 */
export const CMS_ENTITIES = [
  ...MASTER_ENTITIES,
  ...CONTACT_ENTITIES,
  ...FOOTER_ENTITIES,
  ...PROGRAMME_MODULE_ENTITIES,
  ...HIGHLIGHT_ENTITIES,
  ...PROGRAMME_PAGE_ENTITIES,
  ...FAQ_ENTITIES,
  ...ELIGIBILITY_ENTITIES,
  ...APPLY_ENTITIES,
  ...HERO_ENTITIES,
  ...BOARD_ENTITIES,
  ...ADVISORY_ENTITIES,
  ...ECOSYSTEM_ENTITIES,
  ...SCHEMES_ENTITIES,
  ...ABOUT_ENTITIES,
  ...IMPACT_ENTITIES,
  ...ANNOUNCEMENT_ENTITIES,
  ...TOPBAR_ENTITIES,
  ...BRANDBAR_ENTITIES,
];
