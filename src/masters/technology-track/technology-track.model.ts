import { Column, Entity } from 'typeorm';
import { AppBaseEntity } from '../../database/base.entity';

/*
 * Technology track — the Admin Panel's reference list of the twelve Module 3 tracks T01–T12
 * (AMRUT_KALASH_02 F-ADM-15, Table 34). Seeded by the TechnologyTracks migration; read by the LMS Admin as
 * read-only reference data (AMRUT_KALASH_03 track_ref, DB-303) and by LMS entities and track variants.
 */
@Entity({ name: 'technology_tracks' })
export class TechnologyTrack extends AppBaseEntity {
  /* Stable code, T01–T12 (F-ADM-15-01: read-only after creation). */
  @Column({ type: 'varchar', length: 4 })
  code!: string;

  @Column({ type: 'varchar', length: 120 })
  name!: string;

  /* Names used by the external registration form (F-ADM-15-03). */
  @Column({ type: 'jsonb', default: () => `'[]'::jsonb` })
  aliases!: string[];

  @Column({ type: 'integer', name: 'sortOrder' })
  sortOrder!: number;
}
