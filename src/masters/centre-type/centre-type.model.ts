import { Column, Entity } from 'typeorm';
import { AppBaseEntity } from '../../database/base.entity';

/*
 * CMS master: a training centre type — the ownership relationship of a centre (F-ADM-CEN-03).
 * Seeded with Owned, Partner, Affiliated and Other; the list is maintained here.
 */
@Entity({ name: 'training_centre_types' })
export class CentreType extends AppBaseEntity {
  @Column({ type: 'varchar', length: 100 })
  name!: string;

  @Column({ type: 'varchar', length: 20 })
  code!: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  description!: string | null;
}
