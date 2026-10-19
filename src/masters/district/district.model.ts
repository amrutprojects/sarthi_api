import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany } from 'typeorm';
import { AppBaseEntity } from '../../entities/base.entity';
import type { State } from '../state/state.model';
import type { Taluka } from '../taluka/taluka.model';

/*
 * CMS geography master: a district. Always belongs to exactly one state — the foreign key is NOT NULL
 * and RESTRICT, so a district can never exist without a valid state.
 *
 * Name and code are unique within the state (among non-deleted rows), not globally: two states may
 * each have a "Bid" district. The name index is on (stateId, lower("name")).
 */
@Entity({ name: 'districts' })
@Index('UQ_districts_state_code_active', ['stateId', 'code'], { unique: true, where: '"isDelete" = false' })
@Index('IDX_districts_stateId', ['stateId'])
export class District extends AppBaseEntity {
  @Column({ type: 'uuid', name: 'stateId' })
  stateId!: string;

  @Column({ type: 'varchar', length: 100 })
  name!: string;

  /* Short stable code, upper case, unique within the state, e.g. PUN. */
  @Column({ type: 'varchar', length: 20 })
  code!: string;

  @ManyToOne('State', (s: State) => s.districts, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'stateId' })
  state!: State;

  @OneToMany('Taluka', (t: Taluka) => t.district)
  talukas!: Taluka[];
}
