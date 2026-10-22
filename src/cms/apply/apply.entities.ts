import { ApplyPageItem, ApplyPageSettings } from './apply.model';

export { ApplyPageItem, ApplyPageSettings };

/*
 * The models this folder contributes to the DataSource, collected by src/cms/cms.entities.ts.
 * A leaf module for the same reason as contact.entities.ts and eligibility.entities.ts: the entity
 * registry must never reach the HTTP layer, or the DataSource and the router end up in a cycle.
 */
export const APPLY_ENTITIES = [ApplyPageSettings, ApplyPageItem];
