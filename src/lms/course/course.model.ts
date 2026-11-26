import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { AppBaseEntity } from '../../database/base.entity';
import type { LmsEntity } from '../entity/entity.model';
import type { CourseStatus } from './course.constants';

/*
 * Course — the course and its four programme modules (AMRUT_KALASH_03 L-06 / FR-306, form F-LMS-06 Table 31,
 * table DB-310 "course"). The modules are lms_course_modules (course-module.model.ts).
 *
 * The spec recommends one course for SARTHI; nothing is seeded — the course is created on screen.
 *
 * `status` is the spec lifecycle (F-LMS-06-06, DRAFT → PUBLISHED → RETIRED). `isActive` is the platform's
 * on/off switch every master carries (AppBaseEntity); delete is the soft delete of a DRAFT course.
 */
@Entity({ name: 'lms_courses' })
export class LmsCourse extends AppBaseEntity {
  /* F-LMS-06-03: owner entity; an ACTIVE entity on creation, immutable afterwards. */
  @Column({ type: 'uuid', name: 'entityId' })
  entityId!: string;

  @ManyToOne('LmsEntity', { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'entityId' })
  entity!: LmsEntity;

  /* F-LMS-06-01: A–Z, 0–9, hyphen; unique among non-deleted courses; immutable once in a published release. */
  @Column({ type: 'varchar', length: 20 })
  code!: string;

  /* F-LMS-06-02: 3–120 characters (the default-language title). */
  @Column({ type: 'varchar', length: 120 })
  title!: string;

  /* F-LMS-06-04: optional, ≤ 2,000 characters, no scripts. */
  @Column({ type: 'varchar', length: 2000, nullable: true })
  description!: string | null;

  /* F-LMS-06-05: ≥ 1 language code; defaults to the entity's default language. */
  @Column({ type: 'varchar', length: 10, array: true })
  languages!: string[];

  /* F-LMS-06-06: DRAFT on creation; never set from a create / update body. */
  @Column({ type: 'varchar', length: 10, default: 'DRAFT' })
  status!: CourseStatus;

  /*
   * The content release association (L-30 / DB-312 content_release → course, release_no int): the latest
   * PUBLISHED release and its number, shown in the course list (UI-315 "latest release"). Content releases
   * are not built yet, so both stay null and carry no foreign key until DB-312 exists.
   */
  @Column({ type: 'uuid', name: 'publishedReleaseId', nullable: true })
  publishedReleaseId!: string | null;

  @Column({ type: 'integer', name: 'publishedReleaseNo', nullable: true })
  publishedReleaseNo!: number | null;
}
