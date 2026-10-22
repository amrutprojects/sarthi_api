import { Batch } from './batch/batch.model';
import { BatchAssignment } from './batch-assignment/batch-assignment.model';
import { CentreInfrastructure } from './centre-infrastructure/centre-infrastructure.model';
import { CentreLocation } from './centre-location/centre-location.model';
import { CentreType } from './centre-type/centre-type.model';
import { College } from './college/college.model';
import { Department } from './department/department.model';
import { MasterDocument } from './document/document.model';
import { TechnologyTrack } from './technology-track/technology-track.model';
import { TrainingCentre } from './training-centre/training-centre.model';

export {
  Batch, BatchAssignment, CentreInfrastructure, CentreLocation, CentreType, College, Department, MasterDocument, TechnologyTrack,
  TrainingCentre,
};

/*
 * The models of the Masters sidebar group (the geography masters State / District / Taluka live in
 * src/cms/masters and are registered by src/cms/cms.entities.ts), picked up by src/database/entities.ts.
 *
 * Deliberately a leaf module: it imports models only, never a router or middleware. The entity
 * registry is loaded while the DataSource is being built, so pulling the HTTP layer in from here
 * would create a require cycle (entities -> masters -> authenticate -> auth.service -> database
 * config -> entities) and MASTER_ENTITIES would still be undefined when ENTITIES is evaluated.
 */
export const MASTER_ENTITIES = [
  Department, College, CentreType, TrainingCentre, CentreLocation, CentreInfrastructure, Batch, BatchAssignment, MasterDocument, TechnologyTrack,
];
