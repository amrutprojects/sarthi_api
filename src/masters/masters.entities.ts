import { District } from './district/district.model';
import { State } from './state/state.model';
import { Taluka } from './taluka/taluka.model';

export { District, State, Taluka };

/*
 * The models this folder contributes to the DataSource, picked up by src/entities/index.ts.
 *
 * Deliberately a leaf module: it imports models only, never a router or middleware. The entity
 * registry is loaded while the DataSource is being built, so pulling the HTTP layer in from here
 * would create a require cycle (entities -> masters -> authenticate -> auth.service -> database
 * config -> entities) and MASTER_ENTITIES would still be undefined when ENTITIES is evaluated.
 */
export const MASTER_ENTITIES = [State, District, Taluka];
