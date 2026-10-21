import { InitialSchema1792000000000 } from './1792000000000-InitialSchema';
import { RoleMenuVisibility1792100000000 } from './1792100000000-RoleMenuVisibility';
import { StudentImport1792200000000 } from './1792200000000-StudentImport';
import { CmsGeography1792200000000 } from './1792200000000-CmsGeography';
import { IdempotencyKeys1792300000000 } from './1792300000000-IdempotencyKeys';
import { CmsMasters1792400000000 } from './1792400000000-CmsMasters';
import { TechnologyTracks1792500000000 } from './1792500000000-TechnologyTracks';
import { LmsEntities1792600000000 } from './1792600000000-LmsEntities';
import { LmsBranding1792700000000 } from './1792700000000-LmsBranding';
import { LmsAcademicCalendars1792710000000 } from './1792710000000-LmsAcademicCalendars';
import { LmsFormFields1792720000000 } from './1792720000000-LmsFormFields';
import { LmsCourses1792730000000 } from './1792730000000-LmsCourses';
import { LmsCourseModules1792740000000 } from './1792740000000-LmsCourseModules';
import { LmsTrackVariants1792750000000 } from './1792750000000-LmsTrackVariants';

/* Explicit, ordered migration registry used by the DataSource and the TypeORM CLI. Append new migrations here. */
export const MIGRATIONS = [
  InitialSchema1792000000000,
  RoleMenuVisibility1792100000000,
  StudentImport1792200000000,
  CmsGeography1792200000000,
  IdempotencyKeys1792300000000,
  CmsMasters1792400000000,
  TechnologyTracks1792500000000,
  LmsEntities1792600000000,
  LmsBranding1792700000000,
  LmsAcademicCalendars1792710000000,
  LmsFormFields1792720000000,
  LmsCourses1792730000000,
  LmsCourseModules1792740000000,
  LmsTrackVariants1792750000000,
];
