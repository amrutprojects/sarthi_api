import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { AppBaseEntity } from '../../database/base.entity';
import type { CentreType } from '../centre-type/centre-type.model';
import type { District } from '../district/district.model';
import type { Taluka } from '../taluka/taluka.model';

/*
 * CMS master: a training centre — Training Centre Profile sections A (basic information) and B (centre
 * management), AMRUT_KALASH_02 Table 32. Location information and capacity & infrastructure are kept in
 * their own masters, one record per centre.
 *
 * Only the name and the district are compulsory (F-ADM-CEN-01 / -06). The code is generated (TC0001…)
 * when left blank and cannot change once a batch uses the centre.
 */
@Entity({ name: 'training_centres' })
export class TrainingCentre extends AppBaseEntity {
  @Column({ type: 'varchar', length: 150 })
  name!: string;

  @Column({ type: 'varchar', length: 10 })
  code!: string;

  @Column({ type: 'uuid', name: 'centreTypeId', nullable: true })
  centreTypeId!: string | null;

  @Column({ type: 'uuid', name: 'districtId' })
  districtId!: string;

  @Column({ type: 'uuid', name: 'talukaId', nullable: true })
  talukaId!: string | null;

  @Column({ type: 'varchar', length: 15, name: 'contactNumber', nullable: true })
  contactNumber!: string | null;

  @Column({ type: 'varchar', length: 254, nullable: true })
  email!: string | null;

  @Column({ type: 'varchar', length: 120, name: 'pocName', nullable: true })
  pocName!: string | null;

  @Column({ type: 'varchar', length: 10, name: 'pocMobile', nullable: true })
  pocMobile!: string | null;

  @Column({ type: 'varchar', length: 120, name: 'centreHead', nullable: true })
  centreHead!: string | null;

  @Column({ type: 'varchar', length: 160, name: 'alternativeContact', nullable: true })
  alternativeContact!: string | null;

  @Column({ type: 'varchar', length: 160, nullable: true })
  coordinator1!: string | null;

  @Column({ type: 'varchar', length: 160, nullable: true })
  coordinator2!: string | null;

  @ManyToOne('CentreType', { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({ name: 'centreTypeId' })
  centreType!: CentreType | null;

  @ManyToOne('District', { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'districtId' })
  district!: District;

  @ManyToOne('Taluka', { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({ name: 'talukaId' })
  taluka!: Taluka | null;
}
