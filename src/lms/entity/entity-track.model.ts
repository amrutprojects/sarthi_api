import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { AppBaseEntity } from '../../database/base.entity';
import type { TechnologyTrack } from '../../masters/technology-track/technology-track.model';
import type { LmsEntity } from './entity.model';

/*
 * A technology track enabled for an LMS entity (F-LMS-03-05 "Enabled tracks": tracks offered by the
 * entity). The track is the Admin Panel's record (technology_tracks, T01–T12), read-only from the LMS:
 * only the selection is owned here.
 *
 * One non-deleted row per (entity, track); removal soft-deletes the row, as for lms_entity_centres.
 */
@Entity({ name: 'lms_entity_tracks' })
export class LmsEntityTrack extends AppBaseEntity {
  @Column({ type: 'uuid', name: 'entityId' })
  entityId!: string;

  @Column({ type: 'uuid', name: 'trackId' })
  trackId!: string;

  @ManyToOne('LmsEntity', { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'entityId' })
  entity!: LmsEntity;

  @ManyToOne('TechnologyTrack', { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'trackId' })
  track!: TechnologyTrack;
}
