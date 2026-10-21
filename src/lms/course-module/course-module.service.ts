import type { Request } from 'express';
import type { EntityManager, EntityTarget } from 'typeorm';
import { AppDataSource } from '../../config/database.config';
import type { AppBaseEntity } from '../../database/base.entity';
import { auditService } from '../../modules/audit';
import { AUDIT_ACTIONS } from '../../shared/constants/app.constants';
import { AppError, type ErrorDetail } from '../../shared/errors/app-error';
import type { Paginated } from '../../shared/utils/pagination';
import { assertNoRefs, assertUsableRef, countRefs, lockForUpdate, plural } from '../../masters/shared/master-refs';
import { LmsCourse } from '../course/course.model';
import type { EntityReferenceSource } from '../entity/entity.service';
import { PRESCRIBED_MODULES } from './course-module.constants';
import { LmsCourseModule } from './course-module.model';
import { lmsCourseModuleRepository } from './course-module.repository';
import { LmsTrackVariant } from '../track-variant/track-variant.model';
import type {
  CreateLmsCourseModuleInput, LmsCourseModuleListQuery, LmsCourseModuleOption, ModuleHours, PrescribedModulesResponse,
  PrescribedModulesResult, PublicLmsCourseModule, UpdateLmsCourseModuleInput,
} from './course-module.types';

/* A COURSE_MODULE_REFERENCES entry counting `target` rows whose `column` holds the module id. */
export const courseModuleRef = <T extends AppBaseEntity>(
  target: EntityTarget<T>,
  column: keyof T & string,
  one: string,
  opts: { many?: string } = {},
): EntityReferenceSource => ({ one, ...opts, count: (m, moduleId) => countRefs(m, target, column, moduleId) });

/*
 * ===================================== COURSE MODULE GUARD LIST =====================================
 * Every LMS record that stores a course module id appends ONE line here (import its MODEL, not its
 * service), e.g.
 *     courseModuleRef(LmsTrackVariant, 'courseModuleId', 'track variant'),
 * Any entry with non-deleted rows blocks delete (remove() → assertNoRefs → readable 409).
 * ====================================================================================================
 */
export const COURSE_MODULE_REFERENCES: EntityReferenceSource[] = [
  /* ↓ LMS masters append their courseModuleRef(...) line here ↓ */
  courseModuleRef(LmsTrackVariant, 'courseModuleId', 'track variant'),
];

const HOUR_KEYS = ['coreHours', 'syllabusRef', 'sessions', 'sessionHours', 'lectureHours', 'practicalHours', 'oftHoursMin', 'oftHoursMax'] as const;

const conflict = (message: string, field: string, detail: string) => new AppError(409, message, 'CONFLICT', [{ field, message: detail }]);

/* Hours compared in hundredths (numeric(6,2)), so 0.1 + 0.2 never "differs" from 0.3. */
const cents = (v: number) => Math.round(v * 100);

/*
 * F-LMS-07-05 / -07 / -08 on the full record (create, or the stored row merged with an update):
 * - the syllabus reference is "Required with core hours" (CHK_lms_course_modules_syllabus_ref_required);
 * - each delivery pair is complete, needs the core hours, and adds up to them;
 * - the OFT range is complete and 0 < minimum ≤ maximum (each value > 0 is the validator's).
 */
export function checkModuleHours(h: ModuleHours): ErrorDetail[] {
  const errors: ErrorDetail[] = [];
  const pair = (a: keyof ModuleHours, b: keyof ModuleHours, message: string) => {
    if ((h[a] === null) !== (h[b] === null)) errors.push({ field: h[a] === null ? a : b, message });
    return h[a] !== null && h[b] !== null;
  };
  const sessions = pair('sessions', 'sessionHours', 'Enter both the number of sessions and the session hours.');
  const lecture = pair('lectureHours', 'practicalHours', 'Enter both the lecture and the practical hours.');
  if ((sessions || lecture) && h.coreHours === null) {
    errors.push({ field: 'coreHours', message: 'Enter the core hours of the module.' });
  } else if (h.coreHours !== null) {
    const DOES_NOT_ADD_UP = 'The delivery pattern does not add up to the core hours.';
    if (sessions && cents(h.sessions! * h.sessionHours!) !== cents(h.coreHours)) errors.push({ field: 'sessions', message: DOES_NOT_ADD_UP });
    if (lecture && cents(h.lectureHours!) + cents(h.practicalHours!) !== cents(h.coreHours)) errors.push({ field: 'lectureHours', message: DOES_NOT_ADD_UP });
  }
  if (h.coreHours !== null && h.syllabusRef === null) errors.push({ field: 'syllabusRef', message: 'Enter the syllabus reference.' });
  if (pair('oftHoursMin', 'oftHoursMax', 'Enter a valid OFT hours range.') && cents(h.oftHoursMin!) > cents(h.oftHoursMax!)) {
    errors.push({ field: 'oftHoursMin', message: 'Enter a valid OFT hours range.' });
  }
  return errors;
}

/* The "Required before release" fields of F-LMS-07 that are still empty (read by the L-30 check). */
export function missingForRelease(h: ModuleHours): string[] {
  const missing: string[] = [];
  if (h.coreHours === null) missing.push('coreHours');
  if (h.syllabusRef === null) missing.push('syllabusRef');
  if (h.sessions === null && h.lectureHours === null) missing.push('deliveryPattern');
  if (h.oftHoursMin === null) missing.push('oftHours');
  return missing;
}

const hoursOf = (x: Partial<ModuleHours>): ModuleHours => ({
  coreHours: x.coreHours ?? null,
  syllabusRef: x.syllabusRef ?? null,
  sessions: x.sessions ?? null,
  sessionHours: x.sessionHours ?? null,
  lectureHours: x.lectureHours ?? null,
  practicalHours: x.practicalHours ?? null,
  oftHoursMin: x.oftHoursMin ?? null,
  oftHoursMax: x.oftHoursMax ?? null,
});

const toPublic = (cm: LmsCourseModule): PublicLmsCourseModule => ({
  id: cm.id,
  courseId: cm.courseId,
  course: cm.course ? { id: cm.course.id, code: cm.course.code, title: cm.course.title, entityId: cm.course.entityId } : null,
  moduleNumber: cm.moduleNumber,
  title: cm.title,
  description: cm.description,
  ...hoursOf(cm),
  status: cm.status,
  missingForRelease: missingForRelease(cm),
  isActive: cm.isActive,
  createdAt: cm.createdAt,
  updatedAt: cm.updatedAt,
});

const snapshot = (cm: LmsCourseModule) => ({
  courseId: cm.courseId,
  moduleNumber: cm.moduleNumber,
  title: cm.title,
  description: cm.description,
  ...hoursOf(cm),
  status: cm.status,
  isActive: cm.isActive,
});

/*
 * Module Master — AMRUT_KALASH_03 L-06 / FR-306, form F-LMS-07 (Table 32), table DB-310 "course_module",
 * programme learning model section 2.1.
 *
 * - A course has exactly four programme modules numbered 1 to 4 (BRL-310): a duplicate number is refused
 *   with 409 "This module already exists for the course." (a fifth module cannot exist: 1–4 only).
 * - The course must be usable (active, not deleted, not RETIRED; assertUsableRef FOR SHARE, so the course
 *   cannot be deleted under a module being created). Course and number are fixed after creation.
 * - Hours (F-LMS-07-04 / -07 / -08): > 0; each delivery pattern adds up to the core hours; 0 < OFT min ≤
 *   max; OFT is stored apart from the core hours and never deducted (BRL-336). All may stay empty until
 *   release ("Required before release"); missingForRelease lists what is still empty. The syllabus
 *   reference is "Required with core hours" (F-LMS-07-05): never core hours without it.
 * - A change of the core hours needs the syllabus reference and a reason (F-LMS-07-04); every change is
 *   audited with before and after values (L-06 acceptance).
 * - The prescribed values of the final syllabus documents (PRESCRIBED_MODULES, OQ-012) are offered by
 *   GET /prescribed and created by POST /prescribed for the modules a course is missing.
 * - Delete is the soft delete of a DRAFT module that nothing in COURSE_MODULE_REFERENCES (track variants…)
 *   references; a released module is "retired, never deleted" (L-06).
 */
export class LmsCourseModuleService {
  async list(q: LmsCourseModuleListQuery): Promise<Paginated<PublicLmsCourseModule>> {
    const page = await lmsCourseModuleRepository.list(q);
    return { items: page.items.map(toPublic), meta: page.meta };
  }

  async get(id: string): Promise<PublicLmsCourseModule> {
    const cm = await lmsCourseModuleRepository.findWithCourse(id);
    if (!cm) throw AppError.notFound('Module not found');
    const references = [];
    for (const ref of COURSE_MODULE_REFERENCES) {
      const count = await ref.count(AppDataSource.manager, id);
      if (count > 0) references.push({ label: plural(count, ref.one, ref.many), count });
    }
    return { ...toPublic(cm), references };
  }

  /* Dropdown feed (e.g. Module 3 of a course for the Track Variant master). */
  async options(filter: { courseId?: string; moduleNumber?: number }): Promise<LmsCourseModuleOption[]> {
    const rows = await lmsCourseModuleRepository.findSelectable(filter);
    return rows.map((cm) => ({ id: cm.id, courseId: cm.courseId, moduleNumber: cm.moduleNumber, title: cm.title }));
  }

  prescribed(): PrescribedModulesResponse {
    return {
      modules: PRESCRIBED_MODULES,
      confirmedByCompetentAuthority: false,
      source: 'Final syllabus documents (draft for review and approval by the competent authority, OQ-012)',
    };
  }

  /* The course must be active, not deleted and not retired; read FOR SHARE (the course delete locks it FOR UPDATE). */
  private async assertCourseUsable(m: EntityManager, courseId: string): Promise<LmsCourse> {
    const course = await assertUsableRef(m, LmsCourse, courseId, 'courseId', 'course');
    if (course.status === 'RETIRED') {
      throw AppError.badRequest('The selected course is retired', [{ field: 'courseId', message: 'Choose a course that is not retired' }]);
    }
    return course;
  }

  private async assertNumberFree(courseId: string, moduleNumber: number, excludeId: string | undefined, m: EntityManager): Promise<void> {
    if (await lmsCourseModuleRepository.findByNumber(courseId, moduleNumber, { excludeId, manager: m })) {
      throw conflict('This module already exists for the course', 'moduleNumber', 'This module already exists for the course.');
    }
  }

  private assertHours(h: ModuleHours): void {
    const errors = checkModuleHours(h);
    if (errors.length) throw AppError.badRequest(errors[0].message, errors);
  }

  async create(input: CreateLmsCourseModuleInput, req?: Request): Promise<PublicLmsCourseModule> {
    const id = await AppDataSource.transaction(async (m) => {
      await this.assertCourseUsable(m, input.courseId);
      await this.assertNumberFree(input.courseId, input.moduleNumber, undefined, m);
      const hours = hoursOf(input);
      this.assertHours(hours);
      const cm = await lmsCourseModuleRepository.create(
        {
          courseId: input.courseId,
          moduleNumber: input.moduleNumber,
          title: input.title,
          description: input.description ?? null,
          ...hours,
          status: 'DRAFT',
          isActive: input.isActive ?? true,
        },
        m,
      );
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.LMS_MODULE_CREATE,
        resource: 'lms-course-module',
        resourceId: cm.id,
        details: { after: snapshot(cm) },
      });
      return cm.id;
    });
    return this.get(id);
  }

  /*
   * Creates, in one transaction, the prescribed modules (section 2.1 / BRL-335 defaults) that the course
   * does not have yet, "with a syllabus reference" (BRL-335): the caller's, as the core hours need it
   * (F-LMS-07-05). The description stays empty: the spec gives no value for it.
   */
  async createPrescribed(courseId: string, syllabusRef: string, req?: Request): Promise<PrescribedModulesResult> {
    const created = await AppDataSource.transaction(async (m) => {
      await this.assertCourseUsable(m, courseId);
      const present = new Set((await lmsCourseModuleRepository.findMany({ courseId }, { manager: m })).map((x) => x.moduleNumber));
      const numbers: number[] = [];
      for (const p of PRESCRIBED_MODULES) {
        if (present.has(p.moduleNumber)) continue;
        const hours = { ...hoursOf(p), syllabusRef };
        this.assertHours(hours);
        const cm = await lmsCourseModuleRepository.create(
          {
            courseId,
            moduleNumber: p.moduleNumber,
            title: p.title,
            description: p.description,
            ...hours,
            status: 'DRAFT',
            isActive: true,
          },
          m,
        );
        await auditService.recordInTx(m, req, {
          action: AUDIT_ACTIONS.LMS_MODULE_CREATE,
          resource: 'lms-course-module',
          resourceId: cm.id,
          details: { after: snapshot(cm), source: 'prescribed defaults (final syllabus documents, OQ-012)' },
        });
        numbers.push(p.moduleNumber);
      }
      return numbers;
    });
    const modules = await lmsCourseModuleRepository.forCourse(courseId);
    return { courseId, created, modules: modules.map(toPublic) };
  }

  async update(id: string, input: UpdateLmsCourseModuleInput, req?: Request): Promise<PublicLmsCourseModule> {
    await AppDataSource.transaction(async (m) => {
      const cm = await lockForUpdate(m, LmsCourseModule, id);
      if (!cm) throw AppError.notFound('Module not found');

      const columns: Partial<Pick<LmsCourseModule, 'title' | 'description' | keyof ModuleHours>> = {};
      const before: Record<string, unknown> = {};
      const set = <K extends keyof typeof columns>(key: K, value: (typeof columns)[K] | undefined) => {
        if (value === undefined || value === cm[key]) return;
        columns[key] = value;
        before[key] = cm[key];
      };
      set('title', input.title);
      set('description', input.description);
      for (const key of HOUR_KEYS) set(key, input[key]);

      const merged = hoursOf({ ...hoursOf(cm), ...columns } as Partial<ModuleHours>);
      this.assertHours(merged);
      if ('coreHours' in columns && !input.reason) {
        /* F-LMS-07-04: "a change needs the syllabus reference and a reason" (the reference: checkModuleHours). */
        throw AppError.badRequest('A change of the core hours needs the syllabus reference and a reason', [{ field: 'reason', message: 'Enter a reason.' }]);
      }

      if (Object.keys(columns).length) await lmsCourseModuleRepository.update(id, columns, m);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.LMS_MODULE_UPDATE,
        resource: 'lms-course-module',
        resourceId: id,
        details: { fields: Object.keys(columns), before, after: columns, reason: input.reason, courseId: cm.courseId, moduleNumber: cm.moduleNumber },
      });
    });
    return this.get(id);
  }

  async setStatus(id: string, isActive: boolean, req?: Request): Promise<PublicLmsCourseModule> {
    await AppDataSource.transaction(async (m) => {
      const cm = await lockForUpdate(m, LmsCourseModule, id);
      if (!cm) throw AppError.notFound('Module not found');
      await lmsCourseModuleRepository.update(id, { isActive }, m);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.LMS_MODULE_STATUS,
        resource: 'lms-course-module',
        resourceId: id,
        details: { before: { isActive: cm.isActive }, after: { isActive }, courseId: cm.courseId, moduleNumber: cm.moduleNumber },
      });
    });
    return this.get(id);
  }

  /*
   * Soft delete of a DRAFT module, refused while any COURSE_MODULE_REFERENCES record (top of this file —
   * the guard list the Track Variant master appends to) points at it. The module row is locked FOR UPDATE
   * before counting; child writes read it FOR SHARE (assertUsableRef).
   */
  async remove(id: string, req?: Request): Promise<void> {
    await AppDataSource.transaction(async (m) => {
      const cm = await lockForUpdate(m, LmsCourseModule, id);
      if (!cm) throw AppError.notFound('Module not found');
      if (cm.status !== 'DRAFT') throw AppError.conflict('A module that is in a published release is retired, never deleted.');
      const refs = [];
      for (const ref of COURSE_MODULE_REFERENCES) refs.push({ count: await ref.count(m, id), one: ref.one, many: ref.many });
      assertNoRefs('module', refs);
      await lmsCourseModuleRepository.softDelete(id, m);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.LMS_MODULE_DELETE,
        resource: 'lms-course-module',
        resourceId: id,
        details: { courseId: cm.courseId, moduleNumber: cm.moduleNumber, title: cm.title },
      });
    });
  }

  /* Brings a deleted module back, inactive. Refused when its course is deleted or its number was taken meanwhile. */
  async restore(id: string, req?: Request): Promise<PublicLmsCourseModule> {
    await AppDataSource.transaction(async (m) => {
      const existing = await lmsCourseModuleRepository.findByIdIncludingDeleted(id, m);
      if (!existing) throw AppError.notFound('Module not found');
      if (!existing.isDelete) throw AppError.conflict('Module is not deleted');
      const course = await m.getRepository(LmsCourse).findOne({ where: { id: existing.courseId, isDelete: false }, lock: { mode: 'pessimistic_read' } });
      if (!course) throw AppError.conflict('The course of this module is deleted. Restore the course first.');
      await this.assertNumberFree(existing.courseId, existing.moduleNumber, id, m);
      await lmsCourseModuleRepository.restore(id, m);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.LMS_MODULE_RESTORE,
        resource: 'lms-course-module',
        resourceId: id,
        details: { courseId: existing.courseId, moduleNumber: existing.moduleNumber, title: existing.title },
      });
    });
    return this.get(id);
  }
}

export const lmsCourseModuleService = new LmsCourseModuleService();
