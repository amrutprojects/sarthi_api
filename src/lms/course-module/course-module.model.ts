import { Column, Entity, JoinColumn, ManyToOne, type ValueTransformer } from 'typeorm';
import { AppBaseEntity } from '../../database/base.entity';
import type { LmsCourse } from '../course/course.model';
import type { ModuleStatus } from './course-module.constants';

/* numeric columns come back from PostgreSQL as strings; the API speaks numbers. */
const hours: ValueTransformer = {
  to: (v: number | null | undefined) => v,
  from: (v: string | null) => (v === null ? null : Number(v)),
};

/*
 * Programme module — one of the four modules of a course (AMRUT_KALASH_03 L-06 / FR-306, form F-LMS-07
 * Table 32, table DB-310 "course_module"; programme learning model section 2.1 Table 7).
 *
 * - moduleNumber 1–4, one non-deleted row per (course, number) (BRL-310; F-LMS-07-01).
 * - Core hours and the OFT range are separate fields; OFT is additional, never deducted (BRL-336).
 * - The values are configuration defaults from the final syllabus documents (BRL-335, OQ-012): see
 *   PRESCRIBED_MODULES in course-module.constants.ts. Each may be empty until release ("Required before
 *   release"); a change of the core hours needs the syllabus reference and a reason (F-LMS-07-04).
 * - The Module 3 variants per technology track (F-LMS-07-03 / -09) are the Track Variant master's tables.
 * - `status` is the spec lifecycle (DRAFT → PUBLISHED → RETIRED), set through content releases (L-30,
 *   not built yet); `isActive` is the platform's on/off switch.
 */
@Entity({ name: 'lms_course_modules' })
export class LmsCourseModule extends AppBaseEntity {
  /* Immutable after creation. */
  @Column({ type: 'uuid', name: 'courseId' })
  courseId!: string;

  @ManyToOne('LmsCourse', { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'courseId' })
  course!: LmsCourse;

  /* F-LMS-07-01: 1, 2, 3 or 4; unique per course; set on creation only. */
  @Column({ type: 'smallint', name: 'moduleNumber' })
  moduleNumber!: number;

  /* F-LMS-07-02: 3–160 characters. */
  @Column({ type: 'varchar', length: 160 })
  title!: string;

  /* F-LMS-07-06: description and outcomes, ≤ 3,000 characters, no scripts. */
  @Column({ type: 'varchar', length: 3000, nullable: true })
  description!: string | null;

  /* F-LMS-07-04: > 0 (DB-310 core_hours numeric). */
  @Column({ type: 'numeric', precision: 6, scale: 2, name: 'coreHours', nullable: true, transformer: hours })
  coreHours!: number | null;

  /* F-LMS-07-05: document and version the values come from, ≤ 120 characters. */
  @Column({ type: 'varchar', length: 120, name: 'syllabusRef', nullable: true })
  syllabusRef!: string | null;

  /*
   * F-LMS-07-07 delivery pattern: sessions × session hours (integers) and / or lecture + practical hours
   * (decimals; Module 1's "theory" hours are the lecture hours). Each pair given must equal the core hours.
   */
  @Column({ type: 'smallint', nullable: true })
  sessions!: number | null;

  @Column({ type: 'smallint', name: 'sessionHours', nullable: true })
  sessionHours!: number | null;

  @Column({ type: 'numeric', precision: 6, scale: 2, name: 'lectureHours', nullable: true, transformer: hours })
  lectureHours!: number | null;

  @Column({ type: 'numeric', precision: 6, scale: 2, name: 'practicalHours', nullable: true, transformer: hours })
  practicalHours!: number | null;

  /* F-LMS-07-08: OFT hours range, 0 < minimum ≤ maximum, additional to the core hours. */
  @Column({ type: 'numeric', precision: 6, scale: 2, name: 'oftHoursMin', nullable: true, transformer: hours })
  oftHoursMin!: number | null;

  @Column({ type: 'numeric', precision: 6, scale: 2, name: 'oftHoursMax', nullable: true, transformer: hours })
  oftHoursMax!: number | null;

  @Column({ type: 'varchar', length: 10, default: 'DRAFT' })
  status!: ModuleStatus;
}
