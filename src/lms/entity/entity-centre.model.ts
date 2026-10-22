import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { AppBaseEntity } from '../../database/base.entity';
import type { TrainingCentre } from '../../masters/training-centre/training-centre.model';
import type { LmsEntity } from './entity.model';

/*
 * A training centre enabled for an LMS entity (F-LMS-03-04 "Enabled centres": centres at which the entity
 * delivers). The centre itself is the Admin Panel's record (training_centres), read-only from the LMS: only
 * the selection is owned here.
 *
 * One non-deleted row per (entity, centre). Removing a centre from the selection soft-deletes its row;
 * enabling it again inserts a new one, so the history stays in the table and the audit log.
 */
@Entity({ name: 'lms_entity_centres' })
export class LmsEntityCentre extends AppBaseEntity {
  @Column({ type: 'uuid', name: 'entityId' })
  entityId!: string;

  @Column({ type: 'uuid', name: 'centreId' })
  centreId!: string;

  @ManyToOne('LmsEntity', { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'entityId' })
  entity!: LmsEntity;

  @ManyToOne('TrainingCentre', { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'centreId' })
  centre!: TrainingCentre;
}
