import { CONTACT_ENTITIES } from './contact/contact.entities';
import { FOOTER_ENTITIES } from './footer/footer.entities';
import { PROGRAMME_MODULE_ENTITIES } from './modules/modules.entities';
import { HIGHLIGHT_ENTITIES } from './highlight/highlight.entities';
import { MASTER_ENTITIES } from './masters/masters.entities';
import { PROGRAMME_PAGE_ENTITIES } from './programme/programme.entities';
import { HERO_ENTITIES } from './hero/hero.entities';
import { IMPACT_ENTITIES } from './impact/impact.entities';

export { ContactOrganization, ContactPageSettings } from './contact/contact.entities';
export { District, State, Taluka } from './masters/masters.entities';
export { FooterLink, FooterSection, FooterSettings } from './footer/footer.entities';
export { ProgrammeElectiveDomain, ProgrammeModule, ProgrammeModuleSettings } from './modules/modules.entities';
export { ProgrammeHighlight, ProgrammeHighlightObjective } from './highlight/highlight.entities';
export { ProgrammePageSettings } from './programme/programme.entities';
export { HomeHero, HomeHeroSlide } from './hero/hero.entities';
export { ImpactSection, ImpactStat } from './impact/impact.entities';

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
  ...PROGRAMME_MODULE_ENTITIES, ...HIGHLIGHT_ENTITIES,
  ...PROGRAMME_PAGE_ENTITIES,
  ...HERO_ENTITIES,
  ...IMPACT_ENTITIES,
];
