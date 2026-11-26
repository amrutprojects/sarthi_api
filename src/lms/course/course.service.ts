import type { Request } from 'express';
import type { EntityManager, EntityTarget } from 'typeorm';
import { AppDataSource } from '../../config/database.config';
import type { AppBaseEntity } from '../../database/base.entity';
import { auditService } from '../../modules/audit';
import { AUDIT_ACTIONS } from '../../shared/constants/app.constants';
import { AppError } from '../../shared/errors/app-error';
import type { Paginated } from '../../shared/utils/pagination';
import { assertUsableRef, countRefs, lockForUpdate, plural } from '../../masters/shared/master-refs';
import type { BrandingKey } from '../branding/branding.constants';
import { lmsEntitySettingRepository } from '../branding/branding.repository';
import { MODULE_NUMBERS } from '../course-module/course-module.constants';
import { LmsCourseModule } from '../course-module/course-module.model';
import { LMS_PLATFORM_LANGUAGES } from '../entity/entity.constants';
import { LmsEntity } from '../entity/entity.model';
import type { EntityReferenceSource } from '../entity/entity.service';
import { LmsCourse } from './course.model';
import { lmsCourseRepository } from './course.repository';
import type {
  CourseModuleSummary, CreateLmsCourseInput, LmsCourseLanguageOptions, LmsCourseListQuery, LmsCourseOption, LmsCourseReference,
  PublicLmsCourse, PublicLmsCourseDetail, UpdateLmsCourseInput,
} from './course.types';
import { assertNoDependencies, defineDependencies, fromReferences } from '../../shared/dependencies/dependencies';
import { P } from '../../modules/roles-permissions/permission.constants';

/* A COURSE_REFERENCES entry counting `target` rows whose `column` holds the course id. */
export const courseRef = <T extends AppBaseEntity>(
  target: EntityTarget<T>,
  column: keyof T & string,
  one: string,
  opts: { many?: string } = {},
): EntityReferenceSource => ({ one, ...opts, count: (m, courseId) => countRefs(m, target, column, courseId) });

/*
 * ======================================== COURSE GUARD LIST ========================================
 * Every LMS record that stores a courseId appends ONE line here (import its MODEL, not its service).
 * Any entry with non-deleted rows blocks delete (remove() → assertNoRefs → readable 409).
 * ===================================================================================================
 */
export const COURSE_REFERENCES: EntityReferenceSource[] = [
  courseRef(LmsCourseModule, 'courseId', 'programme module'),
];

/* The course's delete rule (shared/dependencies), made from the guard list above. */
export const LMS_COURSE_DEPENDENCIES = defineDependencies({
  kind: 'lms-course',
  noun: 'course',
  table: 'lms_courses',
  permission: P.LMS_COURSES_DELETE,
  hint: 'Deactivate it instead, or remove those records first.',
  rules: () => fromReferences(COURSE_REFERENCES),
});

const CODE_LOCKED = 'The code cannot be changed.';

const conflict = (message: string, field: string, detail: string) => new AppError(409, message, 'CONFLICT', [{ field, message: detail }]);

const toPublic = (c: LmsCourse): PublicLmsCourse => ({
  id: c.id,
  entityId: c.entityId,
  entity: c.entity ? { id: c.entity.id, name: c.entity.name, code: c.entity.code } : null,
  code: c.code,
  title: c.title,
  description: c.description,
  languages: c.languages,
  status: c.status,
  publishedReleaseId: c.publishedReleaseId,
  publishedReleaseNo: c.publishedReleaseNo,
  isActive: c.isActive,
  createdAt: c.createdAt,
  updatedAt: c.updatedAt,
});

const toModuleSummary = (m: LmsCourseModule): CourseModuleSummary => ({
  id: m.id,
  moduleNumber: m.moduleNumber,
  title: m.title,
  coreHours: m.coreHours,
  oftHoursMin: m.oftHoursMin,
  oftHoursMax: m.oftHoursMax,
  syllabusRef: m.syllabusRef,
  status: m.status,
  isActive: m.isActive,
});

/*
 * Course Master — AMRUT_KALASH_03 L-06 / FR-306, form F-LMS-06 (Table 31), table DB-310 "course".
 *
 * - Code (A–Z, 0–9, hyphen) is unique among non-deleted courses (409 "This course code is already used.");
 *   it is immutable once the course is in a published release (status no longer DRAFT).
 * - The entity must be ACTIVE on creation (assertUsableRef, FOR SHARE: the entity code cannot change and
 *   the entity cannot be deleted under a course being created) and is immutable afterwards.
 * - Languages default to the entity's default language and must be enabled for the entity (F-LMS-06-05:
 *   the Branding "languages" setting, F-LMS-04-07; unset = [default language]).
 * - Status is system-set: DRAFT on creation; PUBLISHED by the first published release (L-30, not built);
 *   RETIRED by the Retire action (from PUBLISHED). The spec blocks retiring while ACTIVE batches exist;
 *   LMS batches do not exist in this system, so nothing blocks it yet.
 * - Delete is the soft delete of a DRAFT course with no programme modules (COURSE_REFERENCES). A course
 *   that reached a release is "retired, never deleted" (L-06).
 * - Every write runs in one transaction with its audit record (before / after values).
 */
export class LmsCourseService {
  async list(q: LmsCourseListQuery): Promise<Paginated<PublicLmsCourse>> {
    const page = await lmsCourseRepository.list(q);
    return { items: page.items.map(toPublic), meta: page.meta };
  }

  async get(id: string): Promise<PublicLmsCourseDetail> {
    const course = await lmsCourseRepository.findWithEntity(id);
    if (!course) throw AppError.notFound('Course not found');
    const m = AppDataSource.manager;
    const [modules, references] = await Promise.all([lmsCourseRepository.modules(id, m), this.references(m, id)]);
    const present = new Set(modules.map((x) => x.moduleNumber));
    const missingModuleNumbers = MODULE_NUMBERS.filter((n) => !present.has(n));
    return {
      ...toPublic(course),
      modules: modules.map(toModuleSummary),
      missingModuleNumbers,
      hasAllModules: missingModuleNumbers.length === 0,
      references,
    };
  }

  /* Dropdown feed for the masters that pick a course (modules, track variants). */
  async options(entityId?: string): Promise<LmsCourseOption[]> {
    const rows = await lmsCourseRepository.findSelectable(entityId);
    return rows.map((c) => ({ id: c.id, code: c.code, title: c.title, entityId: c.entityId }));
  }

  /* The COURSE_REFERENCES counts for one course, non-zero ones only. */
  async references(m: EntityManager, id: string): Promise<LmsCourseReference[]> {
    const out: LmsCourseReference[] = [];
    for (const ref of COURSE_REFERENCES) {
      const count = await ref.count(m, id);
      if (count > 0) out.push({ label: plural(count, ref.one, ref.many), count });
    }
    return out;
  }

  private async assertUniqueCode(code: string | undefined, excludeId: string | undefined, m: EntityManager): Promise<void> {
    if (code && (await lmsCourseRepository.findByCode(code, { excludeId, manager: m }))) {
      throw conflict('A course with this code already exists', 'code', 'This course code is already used.');
    }
  }

  /*
   * F-LMS-06-05: a subset of the entity's enabled languages — the Branding "languages" setting (F-LMS-04-07),
   * which always keeps the default language; unset = [default language]. The caller holds the entity row
   * FOR SHARE (Branding writes lock it FOR UPDATE), so the list cannot change under the check.
   */
  private async enabledLanguageCodes(entity: LmsEntity, m: EntityManager): Promise<Set<string>> {
    const LANGUAGES: BrandingKey = 'languages';
    const stored = (await lmsEntitySettingRepository.forEntity(entity.id, m)).get(LANGUAGES)?.value;
    return new Set([entity.defaultLanguage, ...(Array.isArray(stored) ? (stored as string[]) : [])]);
  }

  /*
   * GET /lms/courses/languages?entityId= — the languages a course of this entity may use (F-LMS-06-05), in platform
   * order, so the course form offers exactly what assertEnabledLanguages accepts without the Branding / Entity
   * permissions.
   */
  async enabledLanguages(entityId: string): Promise<LmsCourseLanguageOptions> {
    const m = AppDataSource.manager;
    const entity = await m.getRepository(LmsEntity).findOne({ where: { id: entityId, isDelete: false } });
    if (!entity) throw AppError.notFound('Entity not found');
    const enabled = await this.enabledLanguageCodes(entity, m);
    return {
      defaultLanguage: entity.defaultLanguage,
      languages: LMS_PLATFORM_LANGUAGES.filter((l) => enabled.has(l.code)).map((l) => ({ code: l.code, label: l.label })),
    };
  }

  private async assertEnabledLanguages(entity: LmsEntity, languages: string[], m: EntityManager): Promise<void> {
    const enabled = await this.enabledLanguageCodes(entity, m);
    const off = languages.filter((l) => !enabled.has(l));
    if (off.length) {
      const names = off.map((c) => LMS_PLATFORM_LANGUAGES.find((l) => l.code === c)?.label ?? c).join(', ');
      throw AppError.badRequest('Select languages enabled for the entity.', [
        { field: 'languages', message: `${names} ${off.length > 1 ? 'are' : 'is'} not enabled for this entity.` },
      ]);
    }
  }

  async create(input: CreateLmsCourseInput, req?: Request): Promise<PublicLmsCourseDetail> {
    const id = await AppDataSource.transaction(async (m) => {
      /* F-LMS-06-03: an ACTIVE entity, read FOR SHARE (the entity update / delete locks it FOR UPDATE). */
      const entity = await assertUsableRef(m, LmsEntity, input.entityId, 'entityId', 'entity');
      await this.assertUniqueCode(input.code, undefined, m);
      const languages = input.languages ?? [entity.defaultLanguage];
      await this.assertEnabledLanguages(entity, languages, m);

      const course = await lmsCourseRepository.create(
        {
          entityId: entity.id,
          code: input.code,
          title: input.title,
          description: input.description ?? null,
          languages,
          status: 'DRAFT',
          isActive: input.isActive ?? true,
        },
        m,
      );
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.LMS_COURSE_CREATE,
        resource: 'lms-course',
        resourceId: course.id,
        details: {
          after: {
            entityId: course.entityId,
            code: course.code,
            title: course.title,
            description: course.description,
            languages: course.languages,
            status: course.status,
            isActive: course.isActive,
          },
        },
      });
      return course.id;
    });
    return this.get(id);
  }

  async update(id: string, input: UpdateLmsCourseInput, req?: Request): Promise<PublicLmsCourseDetail> {
    await AppDataSource.transaction(async (m) => {
      const course = await lockForUpdate(m, LmsCourse, id);
      if (!course) throw AppError.notFound('Course not found');

      const codeChanged = input.code !== undefined && input.code !== course.code;
      if (codeChanged) {
        /* F-LMS-06-01: immutable once in a published release. */
        if (course.status !== 'DRAFT') {
          throw conflict(`${CODE_LOCKED} The course is in a published release.`, 'code', CODE_LOCKED);
        }
        await this.assertUniqueCode(input.code, id, m);
      }

      const columns: Partial<Pick<LmsCourse, 'code' | 'title' | 'description' | 'languages'>> = {};
      const before: Record<string, unknown> = {};
      const set = <K extends keyof typeof columns>(key: K, value: (typeof columns)[K] | undefined) => {
        if (value === undefined || value === course[key]) return;
        columns[key] = value;
        before[key] = course[key];
      };
      if (codeChanged) set('code', input.code);
      set('title', input.title);
      set('description', input.description);
      /* Checked only when the list changes: narrowing the entity later never blocks an unrelated edit. */
      if (input.languages && input.languages.join(',') !== course.languages.join(',')) {
        const entity = await m.getRepository(LmsEntity).findOne({ where: { id: course.entityId }, lock: { mode: 'pessimistic_read' } });
        if (!entity) throw AppError.notFound('Entity not found');
        await this.assertEnabledLanguages(entity, input.languages, m);
        set('languages', input.languages);
      }

      if (Object.keys(columns).length) await lmsCourseRepository.update(id, columns, m);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.LMS_COURSE_UPDATE,
        resource: 'lms-course',
        resourceId: id,
        details: { fields: Object.keys(columns), before, after: columns },
      });
    });
    return this.get(id);
  }

  /* The platform's ACTIVE / INACTIVE switch (an inactive course leaves the dropdowns). */
  async setStatus(id: string, isActive: boolean, req?: Request): Promise<PublicLmsCourseDetail> {
    await AppDataSource.transaction(async (m) => {
      const course = await lockForUpdate(m, LmsCourse, id);
      if (!course) throw AppError.notFound('Course not found');
      await lmsCourseRepository.update(id, { isActive }, m);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.LMS_COURSE_STATUS,
        resource: 'lms-course',
        resourceId: id,
        details: { before: { isActive: course.isActive }, after: { isActive }, code: course.code },
      });
    });
    return this.get(id);
  }

  /*
   * F-LMS-06-06 Retire action (audit event curriculum.course.retired): PUBLISHED → RETIRED. A DRAFT course
   * was never released, so it is deleted instead. "Blocked while ACTIVE batches exist" has nothing to
   * count yet: LMS batches do not exist in this system.
   */
  async retire(id: string, req?: Request): Promise<PublicLmsCourseDetail> {
    await AppDataSource.transaction(async (m) => {
      const course = await lockForUpdate(m, LmsCourse, id);
      if (!course) throw AppError.notFound('Course not found');
      if (course.status === 'RETIRED') throw AppError.conflict('This course is already retired.');
      if (course.status !== 'PUBLISHED') {
        throw AppError.conflict('Only a published course can be retired. A draft course is deleted instead.');
      }
      await lmsCourseRepository.update(id, { status: 'RETIRED' }, m);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.LMS_COURSE_STATUS,
        resource: 'lms-course',
        resourceId: id,
        details: { event: 'curriculum.course.retired', before: { status: course.status }, after: { status: 'RETIRED' }, code: course.code },
      });
    });
    return this.get(id);
  }

  /*
   * Soft delete. Refused for a course that reached a release (retire it instead) and while any
   * COURSE_REFERENCES record — its programme modules first — points at it. The course row is locked
   * FOR UPDATE before counting; module writes read it FOR SHARE (assertUsableRef).
   */
  async remove(id: string, req?: Request): Promise<void> {
    await AppDataSource.transaction(async (m) => {
      const course = await lockForUpdate(m, LmsCourse, id);
      if (!course) throw AppError.notFound('Course not found');
      if (course.status !== 'DRAFT') {
        throw AppError.conflict('A course that is in a published release is retired, never deleted.');
      }
      await assertNoDependencies(LMS_COURSE_DEPENDENCIES, id, m);
      await lmsCourseRepository.softDelete(id, m);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.LMS_COURSE_DELETE,
        resource: 'lms-course',
        resourceId: id,
        details: { code: course.code, title: course.title },
      });
    });
  }

  /* Brings a deleted course back, inactive. Refused when its code was taken or its entity deleted meanwhile. */
  async restore(id: string, req?: Request): Promise<PublicLmsCourseDetail> {
    await AppDataSource.transaction(async (m) => {
      const existing = await lmsCourseRepository.findByIdIncludingDeleted(id, m);
      if (!existing) throw AppError.notFound('Course not found');
      if (!existing.isDelete) throw AppError.conflict('Course is not deleted');
      const entity = await m.getRepository(LmsEntity).findOne({ where: { id: existing.entityId, isDelete: false }, lock: { mode: 'pessimistic_read' } });
      if (!entity) throw AppError.conflict('The entity of this course is deleted. Restore the entity first.');
      await this.assertUniqueCode(existing.code, id, m);
      await lmsCourseRepository.restore(id, m);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.LMS_COURSE_RESTORE,
        resource: 'lms-course',
        resourceId: id,
        details: { code: existing.code, title: existing.title },
      });
    });
    return this.get(id);
  }
}

export const lmsCourseService = new LmsCourseService();
