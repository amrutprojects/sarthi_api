import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { AppBaseEntity } from '../../database/base.entity';
import type { District } from '../../cms/masters/district/district.model';
import type { Taluka } from '../../cms/masters/taluka/taluka.model';
import type { TechnologyTrack } from '../technology-track/technology-track.model';

/*
 * Center Master (migration 1795200000000): the centres an EDP portal student chooses in step 2. The College
 * Master's fields plus a contact person; the same rules (district required, taluka optional and of that district,
 * name unique within the district, code unique overall). Managed from the Amrut admin panel and the EDP tracking
 * panel alike — one table, one service.
 */
@Entity({ name: 'edp_centres' })
export class Centre extends AppBaseEntity {
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

  @Column({ type: 'varchar', length: 120, name: 'contactPerson', nullable: true })
  contactPerson!: string | null;

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

/*
 * A Technology / 3rd module selection (technology_tracks, T01–T12) offered at a centre (migration 1795400000000).
 * One non-deleted row per pair; removal soft-deletes the row.
 */
@Entity({ name: 'edp_centre_technologies' })
export class CentreTechnology extends AppBaseEntity {
  @Column({ type: 'uuid', name: 'centreId' })
  centreId!: string;

  @Column({ type: 'uuid', name: 'technologyTrackId' })
  technologyTrackId!: string;

  @ManyToOne('Centre', { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'centreId' })
  centre!: Centre;

  @ManyToOne('TechnologyTrack', { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'technologyTrackId' })
  technologyTrack!: TechnologyTrack;
}
