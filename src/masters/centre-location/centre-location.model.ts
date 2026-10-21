import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { AppBaseEntity } from '../../database/base.entity';
import type { ParkingOption } from '../shared/master.constants';
import type { TrainingCentre } from '../training-centre/training-centre.model';

/*
 * CMS master: location information of a training centre (Table 32: address, PIN, map link, and section E
 * location and accessibility). At most one non-deleted record per centre.
 */
@Entity({ name: 'centre_locations' })
export class CentreLocation extends AppBaseEntity {
  @Column({ type: 'uuid', name: 'centreId' })
  centreId!: string;

  @Column({ type: 'varchar', length: 300 })
  address!: string;

  @Column({ type: 'char', length: 6, name: 'pinCode', nullable: true })
  pinCode!: string | null;

  @Column({ type: 'varchar', length: 500, name: 'locationUrl', nullable: true })
  locationUrl!: string | null;

  @Column({ type: 'varchar', length: 200, name: 'nearestLandmark', nullable: true })
  nearestLandmark!: string | null;

  /* Nearest railway station / bus stand. */
  @Column({ type: 'varchar', length: 200, name: 'nearestStation', nullable: true })
  nearestStation!: string | null;

  @Column({ type: 'varchar', length: 200, name: 'publicTransport', nullable: true })
  publicTransport!: string | null;

  @Column({ type: 'varchar', length: 10, nullable: true })
  parking!: ParkingOption | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  remarks!: string | null;

  @ManyToOne('TrainingCentre', { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'centreId' })
  centre!: TrainingCentre;
}
