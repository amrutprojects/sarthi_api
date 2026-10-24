import { ContactCoordinator, ContactCoordinatorDistrict, ContactDistrictOffice, ContactOrganization, ContactPageSettings } from './contact.model';

export { ContactCoordinator, ContactCoordinatorDistrict, ContactDistrictOffice, ContactOrganization, ContactPageSettings };

/*
 * The models this folder contributes to the DataSource, collected by src/cms/cms.entities.ts.
 * A leaf module for the same reason as masters.entities.ts: the entity registry must never reach
 * the HTTP layer, or the DataSource and the router end up in a require cycle.
 */
export const CONTACT_ENTITIES = [ContactPageSettings, ContactOrganization, ContactCoordinator, ContactCoordinatorDistrict, ContactDistrictOffice];
