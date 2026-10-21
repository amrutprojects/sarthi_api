import { Column, Entity, Index, OneToMany } from 'typeorm';
import { AppBaseEntity } from '../../database/base.entity';
import type { District } from '../district/district.model';

/*
 * CMS geography master: a state. Top of the State → District → Taluka hierarchy.
 *
 * Uniqueness is enforced among non-deleted rows only (partial indexes), so a soft-deleted state does
 * not block a new one with the same name or code. The name index is on lower("name"): names are
 * compared case-insensitively, and the service trims and collapses whitespace before writing.
 */
@Entity({ name: 'states' })
@Index('UQ_states_code_active', ['code'], { unique: true, where: '"isDelete" = false' })
export class State extends AppBaseEntity {
  @Column({ type: 'varchar', length: 100 })
  name!: string;

  /* Short stable code, upper case, e.g. MH. */
  @Column({ type: 'varchar', length: 10 })
  code!: string;

  @OneToMany('District', (d: District) => d.state)
  districts!: District[];
}
