import { CONTACT_ENTITIES } from './contact/contact.entities';
import { FOOTER_ENTITIES } from './footer/footer.entities';
import { PROGRAMME_MODULE_ENTITIES } from './modules/modules.entities';
import { MASTER_ENTITIES } from './masters/masters.entities';

export { ContactOrganization, ContactPageSettings } from './contact/contact.entities';
export { District, State, Taluka } from './masters/masters.entities';
export { FooterLink, FooterSection, FooterSettings } from './footer/footer.entities';
export { ProgrammeElectiveDomain, ProgrammeModule, ProgrammeModuleSettings } from './modules/modules.entities';

/*
 * Every model the CMS contributes to the DataSource, picked up by src/entities/index.ts.
 *
 * Deliberately a leaf module — it reaches only the two *.entities.ts files below it, never a router
 * or middleware. The entity registry is evaluated while the DataSource is being constructed, so an
 * import of the HTTP layer from here would close a require cycle and leave this array undefined at
 * the moment ENTITIES reads it.
 */
export const CMS_ENTITIES = [...MASTER_ENTITIES, ...CONTACT_ENTITIES, ...FOOTER_ENTITIES, ...PROGRAMME_MODULE_ENTITIES];
