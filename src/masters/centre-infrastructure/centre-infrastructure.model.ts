import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { AppBaseEntity } from '../../database/base.entity';
import type { FacilityMap } from '../shared/master.constants';
import type { TrainingCentre } from '../training-centre/training-centre.model';

/*
 * CMS master: capacity and infrastructure of a training centre (Table 32 sections C–D: facilities,
 * infrastructure counts, connectivity, amenities, power backup). At most one non-deleted record per centre.
 *
 * Amenity flags are three-valued: true / false, or null when not recorded (F-ADM-CEN-18).
 */
@Entity({ name: 'centre_infrastructure' })
export class CentreInfrastructure extends AppBaseEntity {
  @Column({ type: 'uuid', name: 'centreId' })
  centreId!: string;

  @Column({ type: 'integer', name: 'maxSeatingCapacity' })
  maxSeatingCapacity!: number;

  @Column({ type: 'integer', name: 'numberOfFloors', nullable: true })
  numberOfFloors!: number | null;

  @Column({ type: 'integer', name: 'trainingRooms', nullable: true })
  trainingRooms!: number | null;

  @Column({ type: 'integer', name: 'computerSystems', nullable: true })
  computerSystems!: number | null;

  @Column({ type: 'varchar', length: 60, name: 'internetType', nullable: true })
  internetType!: string | null;

  @Column({ type: 'varchar', length: 60, name: 'internetSpeed', nullable: true })
  internetSpeed!: string | null;

  @Column({ type: 'boolean', name: 'hasLift', nullable: true })
  hasLift!: boolean | null;

  @Column({ type: 'boolean', name: 'hasAc', nullable: true })
  hasAc!: boolean | null;

  @Column({ type: 'boolean', name: 'hasWashroom', nullable: true })
  hasWashroom!: boolean | null;

  @Column({ type: 'boolean', name: 'hasDrinkingWater', nullable: true })
  hasDrinkingWater!: boolean | null;

  @Column({ type: 'varchar', length: 200, name: 'powerBackup', nullable: true })
  powerBackup!: string | null;

  @Column({ type: 'jsonb', default: () => `'{}'::jsonb` })
  facilities!: FacilityMap;

  @ManyToOne('TrainingCentre', { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'centreId' })
  centre!: TrainingCentre;
}
