import type { EntityManager } from 'typeorm';
import { TechnologyTrack } from '../../masters/technology-track/technology-track.model';
import { TrainingCentre } from '../../masters/training-centre/training-centre.model';
import { assertUsableRef } from '../../masters/shared/master-refs';
import { AppError } from '../../shared/errors/app-error';
import { LmsEntityCentre } from './entity-centre.model';
import { LmsEntityTrack } from './entity-track.model';

/*
 * Server checks the other LMS masters run on a centre or track they store next to an entityId
 * (calendar centre exceptions, track variants…): the centre / track must be enabled for that entity
 * (F-LMS-03-04 / -05) and still usable in the Admin Panel (active, not deleted). Import this file and the
 * models, never the entity service.
 *
 * The caller checks the entity itself first (assertUsableRef(m, LmsEntity, entityId, …)) and runs inside a
 * transaction: the selection row and the centre / track are read FOR SHARE, so an entity update removing
 * the centre from the selection waits for the caller's transaction (and vice versa).
 *
 * Both answer 400 with a field detail, like assertUsableRef.
 */
export async function assertCentreEnabled(m: EntityManager, entityId: string, centreId: string, field: string): Promise<TrainingCentre> {
  const link = await m.getRepository(LmsEntityCentre).findOne({
    where: { entityId, centreId, isDelete: false },
    lock: { mode: 'pessimistic_read' },
  });
  if (!link) {
    throw AppError.badRequest('The selected training centre is not enabled for this entity', [
      { field, message: 'Choose a centre enabled for the entity' },
    ]);
  }
  return assertUsableRef(m, TrainingCentre, centreId, field, 'training centre');
}

export async function assertTrackEnabled(m: EntityManager, entityId: string, trackId: string, field: string): Promise<TechnologyTrack> {
  const link = await m.getRepository(LmsEntityTrack).findOne({
    where: { entityId, trackId, isDelete: false },
    lock: { mode: 'pessimistic_read' },
  });
  if (!link) {
    throw AppError.badRequest('The selected technology track is not enabled for this entity', [
      { field, message: 'Choose a track enabled for the entity' },
    ]);
  }
  return assertUsableRef(m, TechnologyTrack, trackId, field, 'technology track');
}
