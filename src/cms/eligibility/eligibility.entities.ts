import { EligibilityItem, EligibilityPageSettings } from './eligibility.model';

export { EligibilityItem, EligibilityPageSettings };

/*
 * The models this folder contributes to the DataSource, collected by src/cms/cms.entities.ts.
 * A leaf module for the same reason as contact.entities.ts and footer.entities.ts: the entity
 * registry must never reach the HTTP layer, or the DataSource and the router end up in a cycle.
 */
export const ELIGIBILITY_ENTITIES = [EligibilityPageSettings, EligibilityItem];
