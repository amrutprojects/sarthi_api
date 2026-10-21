import { Column, Entity } from 'typeorm';
import { AppBaseEntity } from '../../database/base.entity';

/*
 * LMS entity — the configured learning environment within which courses, batches, trainers and learners
 * operate (AMRUT_KALASH_03 L-03 / FR-303, form F-LMS-03 Table 28, table DB-302). An operational boundary,
 * not necessarily a separate legal entity.
 *
 * Status (F-LMS-03-08, ACTIVE / INACTIVE) is AppBaseEntity.isActive; archive is the soft delete.
 * The enabled centres and tracks (F-LMS-03-04 / -05) are the join tables lms_entity_centres and
 * lms_entity_tracks (see entity-centre.model.ts / entity-track.model.ts).
 *
 * The spec maps description, default language and time zone to "entity_setting(<key>)" (Table 28) but DB-302
 * lists the time zone on lms_entity and gives no DDL for either, so they are typed columns here.
 */
@Entity({ name: 'lms_entities' })
export class LmsEntity extends AppBaseEntity {
  /* F-LMS-03-01: 3–120 characters, unique (case-insensitive, non-deleted rows). */
  @Column({ type: 'varchar', length: 120 })
  name!: string;

  /* F-LMS-03-02: A–Z, 0–9, hyphen; 2–20 characters; unique; frozen once a course uses the entity. */
  @Column({ type: 'varchar', length: 20 })
  code!: string;

  /* F-LMS-03-03: optional, ≤ 500 characters. */
  @Column({ type: 'varchar', length: 500, nullable: true })
  description!: string | null;

  /* F-LMS-03-06: one of the platform languages (LMS_PLATFORM_LANGUAGES, To Be Confirmed — OQ-023). */
  @Column({ type: 'varchar', length: 10, name: 'defaultLanguage' })
  defaultLanguage!: string;

  /* F-LMS-03-07: IANA zone, default Asia/Kolkata. Display zone only: timestamps are always stored in UTC. */
  @Column({ type: 'varchar', length: 64, name: 'timeZone', default: 'Asia/Kolkata' })
  timeZone!: string;
}
