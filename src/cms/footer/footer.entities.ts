import { FooterLink, FooterSection, FooterSettings } from './footer.model';

export { FooterLink, FooterSection, FooterSettings };

/*
 * The models this folder contributes to the DataSource, collected by src/cms/cms.entities.ts.
 * A leaf module for the same reason as contact.entities.ts: the entity registry must never reach
 * the HTTP layer, or the DataSource and the router end up in a require cycle.
 */
export const FOOTER_ENTITIES = [FooterSettings, FooterSection, FooterLink];
