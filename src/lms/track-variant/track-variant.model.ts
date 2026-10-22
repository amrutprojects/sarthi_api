import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { AppBaseEntity } from '../../database/base.entity';
import type { TechnologyTrack } from '../../masters/technology-track/technology-track.model';
import type { LmsCourseModule } from '../course-module/course-module.model';
import type { CurriculumStatus } from './track-variant.constants';

/*
 * Module 3 track variant — the definition of Module 3 (Domain-Specific Basic Digital Skills) for one
 * technology track (AMRUT_KALASH_03 L-07 / FR-307, screen UI-317, F-LMS-07-03 / -09, table DB-310).
 *
 * One variant per (Module 3 course module, technology track) among non-deleted rows (F-LMS-07-01 "unique per
 * course (per track for Module 3)"; DB-310 unique (course_id, module_no, track_ref_id)). The track is the Admin
 * Panel's record (technology_tracks, T01–T12), read-only from the LMS.
 *
 * The curriculum of the variant lives in the child tables lms_track_variant_* (phases, track modules,
 * learning components, OFT cards, assessment components, readiness gates).
 *
 * `status` is the curriculum lifecycle DRAFT → PUBLISHED → RETIRED (L-07); isActive is the activation flag
 * every master has; archive (soft delete) is refused once published.
 */
@Entity({ name: 'lms_track_variants' })
export class LmsTrackVariant extends AppBaseEntity {
  /* The Module 3 programme module of the course (F-LMS-07-01 module number 3); immutable after creation. */
  @Column({ type: 'uuid', name: 'courseModuleId' })
  courseModuleId!: string;

  /* F-LMS-07-03: ACTIVE track enabled for the course's entity; immutable after creation. */
  @Column({ type: 'uuid', name: 'trackId' })
  trackId!: string;

  @Column({ type: 'varchar', length: 12, default: 'DRAFT' })
  status!: CurriculumStatus;

  /* F-LMS-07-09 track modules "22 or 23 per track", entered from the track's syllabus; null = not entered yet. */
  @Column({ type: 'smallint', name: 'expectedTrackModules', nullable: true })
  expectedTrackModules!: number | null;

  /* F-LMS-07-09 OFT cards "12 or 13 per track"; null = not entered yet. */
  @Column({ type: 'smallint', name: 'expectedOftCards', nullable: true })
  expectedOftCards!: number | null;

  /* F-LMS-07-05: document and version the values come from (the track's syllabus), ≤ 120 characters. */
  @Column({ type: 'varchar', length: 120, name: 'syllabusReference', nullable: true })
  syllabusReference!: string | null;

  /* F-LMS-07-06: description and outcomes, ≤ 3,000 characters. */
  @Column({ type: 'varchar', length: 3000, nullable: true })
  description!: string | null;

  /* When the variant was last published (proxy for its inclusion in a published content release, L-30). */
  @Column({ type: 'timestamptz', name: 'publishedAt', nullable: true })
  publishedAt!: Date | null;

  @ManyToOne('LmsCourseModule', { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'courseModuleId' })
  courseModule!: LmsCourseModule;

  @ManyToOne('TechnologyTrack', { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'trackId' })
  track!: TechnologyTrack;
}
