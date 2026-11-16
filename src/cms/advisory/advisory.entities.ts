import { AdvisoryGroup, AdvisoryMember, AdvisorySection } from './advisory.model';

export { AdvisoryGroup, AdvisoryMember, AdvisorySection };

/*
 * The models this folder contributes to the DataSource, collected by src/cms/cms.entities.ts.
 * A leaf module, for the same reason as the other *.entities.ts files: the entity registry must
 * never reach the HTTP layer, or the DataSource and the router end up in a require cycle.
 */
export const ADVISORY_ENTITIES = [AdvisorySection, AdvisoryMember, AdvisoryGroup];
