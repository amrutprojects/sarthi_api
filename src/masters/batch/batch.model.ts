import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { AppBaseEntity } from '../../database/base.entity';
import type { BatchStatus, DeliveryMode } from '../shared/master.constants';
import type { TrainingCentre } from '../training-centre/training-centre.model';

/*
 * CMS master: a programme batch at a training centre (AMRUT_KALASH_02 Table 40).
 *
 * batchStatus is the lifecycle (PLANNED → OPEN → FULL / CLOSED, or CANCELLED); isActive only controls
 * whether the batch is offered in dropdowns. The code is generated (AMK-B-{centre}-{NNN}) when left
 * blank and is immutable once students are assigned.
 */
@Entity({ name: 'batches' })
export class Batch extends AppBaseEntity {
  @Column({ type: 'uuid', name: 'centreId' })
  centreId!: string;

  @Column({ type: 'varchar', length: 100 })
  name!: string;

  @Column({ type: 'varchar', length: 30 })
  code!: string;

  /* Technology track, free text until a track master exists. */
  @Column({ type: 'varchar', length: 100, name: 'trackName', nullable: true })
  trackName!: string | null;

  @Column({ type: 'integer' })
  capacity!: number;

  /* DATE columns come back as 'YYYY-MM-DD' strings (no time zone shift). */
  @Column({ type: 'date', name: 'startDate' })
  startDate!: string;

  @Column({ type: 'date', name: 'endDate', nullable: true })
  endDate!: string | null;

  @Column({ type: 'varchar', length: 10, name: 'deliveryMode' })
  deliveryMode!: DeliveryMode;

  @Column({ type: 'varchar', length: 12, name: 'batchStatus', default: 'PLANNED' })
  batchStatus!: BatchStatus;

  @ManyToOne('TrainingCentre', { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'centreId' })
  centre!: TrainingCentre;
}
