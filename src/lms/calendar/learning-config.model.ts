import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { AppBaseEntity } from '../../database/base.entity';
import type { LmsEntity } from '../entity/entity.model';
import type { LearningConfigMode, LearningConfigValue } from './learning-config.constants';

/*
 * One saved value of a learning-configuration key for an entity (F-LMS-05-07; entity_setting of DB-302,
 * edited in L-05). The keys, their types and their syllabus values are LEARNING_CONFIG_KEYS.
 *
 * mode is set only for the mode-specific keys (OFFLINE / ONLINE, OQ-042). value null = cleared back to
 * 'To Be Confirmed' (prescribed keys only). Every change needs a reason. The current value is the
 * non-deleted row; a change soft-deletes it and inserts the new one, so the history stays in the table.
 */
@Entity({ name: 'lms_learning_config' })
export class LmsLearningConfig extends AppBaseEntity {
  @Column({ type: 'uuid', name: 'entityId' })
  entityId!: string;

  @Column({ type: 'varchar', length: 60 })
  key!: string;

  @Column({ type: 'varchar', length: 10, nullable: true })
  mode!: LearningConfigMode | null;

  @Column({ type: 'jsonb', nullable: true })
  value!: LearningConfigValue | null;

  @Column({ type: 'varchar', length: 500 })
  reason!: string;

  @ManyToOne('LmsEntity', { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'entityId' })
  entity!: LmsEntity;
}
