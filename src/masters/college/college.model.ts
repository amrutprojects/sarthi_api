import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { AppBaseEntity } from '../../database/base.entity';
import type { District } from '../district/district.model';
import type { Taluka } from '../taluka/taluka.model';

/*
 * CMS master: a college. Always located in one district (the state is the district's); the taluka is
 * optional and, when given, must belong to that district. Name is unique within the district, code is
 * unique overall (non-deleted rows).
 */
@Entity({ name: 'colleges' })
export class College extends AppBaseEntity {
  @Column({ type: 'varchar', length: 150 })
  name!: string;

  @Column({ type: 'varchar', length: 20 })
  code!: string;

  @Column({ type: 'uuid', name: 'districtId' })
  districtId!: string;

  @Column({ type: 'uuid', name: 'talukaId', nullable: true })
  talukaId!: string | null;

  @Column({ type: 'varchar', length: 300, nullable: true })
  address!: string | null;

  @Column({ type: 'char', length: 6, name: 'pinCode', nullable: true })
  pinCode!: string | null;

  @Column({ type: 'varchar', length: 15, name: 'contactNumber', nullable: true })
  contactNumber!: string | null;

  @Column({ type: 'varchar', length: 254, nullable: true })
  email!: string | null;

  @ManyToOne('District', { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'districtId' })
  district!: District;

  @ManyToOne('Taluka', { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({ name: 'talukaId' })
  taluka!: Taluka | null;
}
