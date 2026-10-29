import { BrandBarSettings } from './brandbar.model';

export { BrandBarSettings };

/*
 * The models this folder contributes to the DataSource, collected by src/cms/cms.entities.ts.
 * A leaf module, for the same reason as the other *.entities.ts files: the entity registry must
 * never reach the HTTP layer, or the DataSource and the router end up in a require cycle.
 */
export const BRANDBAR_ENTITIES = [BrandBarSettings];
