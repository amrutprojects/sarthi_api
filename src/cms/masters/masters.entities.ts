import { Batch } from './batch/batch.model';
import { BatchAssignment } from './batch-assignment/batch-assignment.model';
import { CentreInfrastructure } from './centre-infrastructure/centre-infrastructure.model';
import { CentreLocation } from './centre-location/centre-location.model';
import { CentreType } from './centre-type/centre-type.model';
import { College } from './college/college.model';
import { Department } from './department/department.model';
import { District } from './district/district.model';
import { MasterDocument } from './document/document.model';
import { State } from './state/state.model';
import { Taluka } from './taluka/taluka.model';
import { TechnologyTrack } from './technology-track/technology-track.model';
import { TrainingCentre } from './training-centre/training-centre.model';

export {
  Batch, BatchAssignment, CentreInfrastructure, CentreLocation, CentreType, College, Department, District, MasterDocument,
  State, Taluka, TechnologyTrack, TrainingCentre,
};

/*
<<<<<<< HEAD:src/masters/masters.entities.ts
 * The models this folder contributes to the DataSource, picked up by src/database/entities.ts.
=======
 * The models this folder contributes to the DataSource, collected by src/cms/cms.entities.ts.
>>>>>>> fcb39ee91d318983f70c58b173c27c13117a08ba:src/cms/masters/masters.entities.ts
 *
 * Deliberately a leaf module: it imports models only, never a router or middleware. The entity
 * registry is loaded while the DataSource is being built, so pulling the HTTP layer in from here
 * would create a require cycle (entities -> cms -> authenticate -> auth.service -> database config
 * -> entities) and the list would still be undefined when ENTITIES is evaluated.
 */
export const MASTER_ENTITIES = [
  State, District, Taluka,
  Department, College, CentreType, TrainingCentre, CentreLocation, CentreInfrastructure, Batch, BatchAssignment, MasterDocument, TechnologyTrack,
];
