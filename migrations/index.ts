import { InitialSchema1792000000000 } from './1792000000000-InitialSchema';
import { RoleMenuVisibility1792100000000 } from './1792100000000-RoleMenuVisibility';
import { CmsGeography1792200000000 } from './1792200000000-CmsGeography';
import { CmsContactPage1792300000000 } from './1792300000000-CmsContactPage';

/* Explicit, ordered migration registry used by the DataSource and the TypeORM CLI. Append new migrations here. */
export const MIGRATIONS = [
  InitialSchema1792000000000,
  RoleMenuVisibility1792100000000,
  CmsGeography1792200000000,
  CmsContactPage1792300000000,
];
