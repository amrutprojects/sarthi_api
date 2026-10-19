import { CONTACT_ENTITIES } from './contact/contact.entities';
import { MASTER_ENTITIES } from './masters/masters.entities';

export { ContactOrganization, ContactPageSettings } from './contact/contact.entities';
export { District, State, Taluka } from './masters/masters.entities';

/*
 * Every model the CMS contributes to the DataSource, picked up by src/entities/index.ts.
 *
 * Deliberately a leaf module — it reaches only the two *.entities.ts files below it, never a router
 * or middleware. The entity registry is evaluated while the DataSource is being constructed, so an
 * import of the HTTP layer from here would close a require cycle and leave this array undefined at
 * the moment ENTITIES reads it.
 */
export const CMS_ENTITIES = [...MASTER_ENTITIES, ...CONTACT_ENTITIES];
