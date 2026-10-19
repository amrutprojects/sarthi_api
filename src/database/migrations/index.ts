import { InitialSchema1792000000000 } from './1792000000000-InitialSchema';
import { RoleMenuVisibility1792100000000 } from './1792100000000-RoleMenuVisibility';
import { StudentImport1792200000000 } from './1792200000000-StudentImport';
import { IdempotencyKeys1792300000000 } from './1792300000000-IdempotencyKeys';
import { StudentDocuments1792400000000 } from './1792400000000-StudentDocuments';
import { StudentDocumentSourcePath1792500000000 } from './1792500000000-StudentDocumentSourcePath';
import { StudentRegistration1792600000000 } from './1792600000000-StudentRegistration';
import { Masters1792700000000 } from './1792700000000-Masters';

/* Explicit, ordered migration registry used by the DataSource and the TypeORM CLI. Append new migrations here. */
export const MIGRATIONS = [
  InitialSchema1792000000000,
  RoleMenuVisibility1792100000000,
  StudentImport1792200000000,
  IdempotencyKeys1792300000000,
  StudentDocuments1792400000000,
  StudentDocumentSourcePath1792500000000,
  StudentRegistration1792600000000,
  Masters1792700000000,
];
