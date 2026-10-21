import { InitialSchema1792000000000 } from './1792000000000-InitialSchema';
import { RoleMenuVisibility1792100000000 } from './1792100000000-RoleMenuVisibility';
import { StudentImport1792200000000 } from './1792200000000-StudentImport';
import { IdempotencyKeys1792300000000 } from './1792300000000-IdempotencyKeys';
import { StudentDocuments1792400000000 } from './1792400000000-StudentDocuments';
import { StudentDocumentSourcePath1792500000000 } from './1792500000000-StudentDocumentSourcePath';
import { StudentRegistration1792600000000 } from './1792600000000-StudentRegistration';
import { Masters1792700000000 } from './1792700000000-Masters';
import { RegistrationDocuments1792800000000 } from './1792800000000-RegistrationDocuments';
import { CmsGeography1792200000000 } from './1792200000000-CmsGeography';
import { CmsContactPage1792300000000 } from './1792300000000-CmsContactPage';
import { CmsFooter1792800000000 } from './1792800000000-CmsFooter';
import { CmsModulesPage1792900000000 } from './1792900000000-CmsModulesPage';
import { ElectiveDomainsPerModule1793000000000 } from './1793000000000-ElectiveDomainsPerModule';
import { DomainsForAllModules1793100000000 } from './1793100000000-DomainsForAllModules';

import { DocumentVerification1793200000000 } from './1793200000000-DocumentVerification';
import { RegistrationNumber1793300000000 } from './1793300000000-RegistrationNumber';
import { RegistrationNumberShort1793400000000 } from './1793400000000-RegistrationNumberShort';
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
  RegistrationDocuments1792800000000,
  /*
   * The CMS migrations carry the timestamps they were applied under (1792200000000 /
   * 1792300000000), which collide with StudentImport and IdempotencyKeys above. They are listed
   * last so the array order — TypeORM's tie-break for equal timestamps — is deterministic. The
   * tables are disjoint, so the order between them has no effect. Renumbering is NOT safe here:
   * these two are already recorded under these names in live databases, so a rename would make
   * TypeORM re-run them and the CREATE TABLE would fail.
   */
  CmsGeography1792200000000,
  CmsContactPage1792300000000,
  /* Footer: a fresh timestamp, so it sorts after the migrations above with no tie to break. */
  CmsFooter1792800000000,
  CmsModulesPage1792900000000,
  ElectiveDomainsPerModule1793000000000,
  DomainsForAllModules1793100000000,
  DocumentVerification1793200000000,
  RegistrationNumber1793300000000,
  RegistrationNumberShort1793400000000,
];
