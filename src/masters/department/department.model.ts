import { Column, Entity } from 'typeorm';
import { AppBaseEntity } from '../../database/base.entity';

/*
 * CMS master: a department. Name and code are unique among non-deleted rows (partial indexes in the
 * CmsMasters migration); the name compares case-insensitively.
 */
@Entity({ name: 'departments' })
export class Department extends AppBaseEntity {
  @Column({ type: 'varchar', length: 100 })
  name!: string;

  /* Short stable code, upper case, e.g. CSE. */
  @Column({ type: 'varchar', length: 20 })
  code!: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  description!: string | null;
}
