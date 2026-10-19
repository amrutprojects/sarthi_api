import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { AppBaseEntity } from '../../../database/base.entity';
import type { District } from '../district/district.model';

/*
 * CMS geography master: a taluka. Always belongs to exactly one district (NOT NULL, RESTRICT).
 *
 * The state is derived through the district rather than stored again here: a second foreign key could
 * disagree with the district's own state, and there is no way to keep two copies honest.
 *
 * Name is unique within the district (among non-deleted rows), on (districtId, lower("name")).
 * The code is optional — taluka code lists are often unavailable — but unique within the district
 * when given.
 */
@Entity({ name: 'talukas' })
@Index('IDX_talukas_districtId', ['districtId'])
export class Taluka extends AppBaseEntity {
  @Column({ type: 'uuid', name: 'districtId' })
  districtId!: string;

  @Column({ type: 'varchar', length: 100 })
  name!: string;

  /* Optional short code, upper case, unique within the district when present. */
  @Column({ type: 'varchar', length: 20, nullable: true })
  code!: string | null;

  @ManyToOne('District', (d: District) => d.talukas, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'districtId' })
  district!: District;
}
