/*
 * Public API of the masters module (Region, Caste, Document type, Education). Other modules import only from here;
 * the routers are mounted by src/routes.ts.
 */
export * from './master.entity';
export * from './master.definitions';
export * from './master.lookup';
export { mastersService, type MasterDto } from './master.service';
