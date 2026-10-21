import type { Request } from 'express';
import type { EntityManager, EntityTarget } from 'typeorm';
import { AppDataSource } from '../../config/database.config';
import type { AppBaseEntity } from '../../database/base.entity';
import type { GeoOption } from '../../cms/masters/geography/geography.types';
import { assertUsableRef, lockForUpdate } from '../../masters/shared/master-refs';
import { TechnologyTrack } from '../../masters/technology-track/technology-track.model';
import { auditService } from '../../modules/audit';
import { AUDIT_ACTIONS } from '../../shared/constants/app.constants';
import { AppError } from '../../shared/errors/app-error';
import type { Paginated } from '../../shared/utils/pagination';
import { LmsCourse } from '../course/course.model';
import { LmsCourseModule } from '../course-module/course-module.model';
import { assertTrackEnabled } from '../entity/entity.refs';
import { LmsEntity } from '../entity/entity.model';
import { evaluateCompleteness } from './track-variant.completeness';
import {
  COMPETENCY_BANDS, CURRICULUM_STATUSES, EVIDENCE_TYPES, GATE_CLEARANCE_MODES, LEARNING_COMPONENT_KINDS, SINGLE_LEARNING_COMPONENTS,
  TRACK_VARIANT_MODULE_NUMBER, VARIANT_ASSESSMENT_COMPONENTS, VARIANT_OFT_CARDS, VARIANT_PHASES, VARIANT_READINESS_GATES,
  VARIANT_TRACK_MODULES,
} from './track-variant.constants';
import { LmsTrackVariantOftCard } from './track-variant-oft-card.model';
import { LmsTrackVariant } from './track-variant.model';
import { lmsTrackVariantRepository, type VariantContext } from './track-variant.repository';
import type {
  CreateTrackVariantInput, PublicTrackVariant, TrackVariantCounts, TrackVariantFormOptions, TrackVariantListQuery, UpdateTrackVariantInput,
} from './track-variant.types';

const NOT_FOUND = 'Track variant not found';

const conflict = (message: string, field: string, detail = message) => new AppError(409, message, 'CONFLICT', [{ field, message: detail }]);

const toPublic = (v: LmsTrackVariant, ctx: VariantContext, counts: TrackVariantCounts): PublicTrackVariant => ({
  id: v.id,
  courseModuleId: v.courseModuleId,
  trackId: v.trackId,
  course: ctx.course,
  courseModule: ctx.courseModule,
  track: ctx.track,
  status: v.status,
  expectedTrackModules: v.expectedTrackModules,
  expectedOftCards: v.expectedOftCards,
  syllabusReference: v.syllabusReference,
  description: v.description,
  publishedAt: v.publishedAt,
  isActive: v.isActive,
  createdAt: v.createdAt,
  updatedAt: v.updatedAt,
  completeness: evaluateCompleteness(v, counts, ctx.courseModule),
});

/*
 * Track Variant Master — AMRUT_KALASH_03 L-07 / FR-307 (UI-317), F-LMS-07-03 / -09, DB-310.
 *
 * - One variant per (Module 3 course module, technology track) among non-deleted rows; a second one answers 409
 *   "A variant for this track already exists." (F-LMS-07-03). The module must be module number 3 (400).
 * - The track is the Admin Panel's record (read-only; the LMS cannot add, rename or delete a track): it must be
 *   ACTIVE and enabled for the course's entity (assertTrackEnabled, F-LMS-07-03). Module and track are fixed on
 *   creation. A track deactivated later keeps its variant (L-07), reported with track.isActive false.
 * - The curriculum (phases, track modules, learning components, OFT cards, assessment components, gates) is
 *   track-variant-items.service.ts. Every response carries the completeness check (track-variant.completeness.ts).
 * - Lifecycle DRAFT → PUBLISHED → RETIRED (L-07). Content releases (L-30) are not built, so publish is this
 *   master's proxy for "included in a release": refused while the variant is incomplete (L-07 acceptance
 *   criteria, TC-359); it publishes the draft OFT cards with it (F-LMS-29-12). Retire ends a published variant.
 * - Delete (archive) is a soft delete of a DRAFT variant only; a published variant is retired, never deleted
 *   (DB-310 "Retire, never delete when referenced"). Its curriculum rows are kept, so a restore brings it back.
 * - Every write runs in one transaction with its audit record (before / after values).
 */
export class LmsTrackVariantService {
  async list(q: TrackVariantListQuery): Promise<Paginated<PublicTrackVariant>> {
    if (q.courseId) await this.assertFilterExists(LmsCourse, q.courseId, 'courseId', 'course');
    if (q.courseModuleId) await this.assertFilterExists(LmsCourseModule, q.courseModuleId, 'courseModuleId', 'course module');
    if (q.trackId) await this.assertFilterExists(TechnologyTrack, q.trackId, 'trackId', 'technology track');
    const page = await lmsTrackVariantRepository.list(q);
    return { items: await this.toPublicMany(page.items), meta: page.meta };
  }

  async get(id: string, m?: EntityManager): Promise<PublicTrackVariant> {
    const variant = await lmsTrackVariantRepository.findById(id, { manager: m });
    if (!variant) throw AppError.notFound(NOT_FOUND);
    return (await this.toPublicMany([variant], m))[0];
  }

  /* Dropdown feed (active, not retired, in track order) for the masters that pick a variant (batches). */
  async options(courseModuleId?: string): Promise<GeoOption[]> {
    const rows = await lmsTrackVariantRepository.findSelectable(courseModuleId);
    return rows.map((v) => ({ id: v.id, name: v.track.name, code: v.track.code }));
  }

  formOptions(): TrackVariantFormOptions {
    return {
      shape: {
        phases: VARIANT_PHASES,
        readinessGates: VARIANT_READINESS_GATES,
        trackModules: { ...VARIANT_TRACK_MODULES },
        oftCards: { ...VARIANT_OFT_CARDS },
        assessmentComponents: VARIANT_ASSESSMENT_COMPONENTS,
      },
      statuses: CURRICULUM_STATUSES,
      learningComponentKinds: LEARNING_COMPONENT_KINDS,
      singleLearningComponentKinds: SINGLE_LEARNING_COMPONENTS,
      evidenceTypes: EVIDENCE_TYPES,
      clearanceModes: GATE_CLEARANCE_MODES,
      competencyBands: { ...COMPETENCY_BANDS },
    };
  }

  private async toPublicMany(variants: LmsTrackVariant[], m?: EntityManager): Promise<PublicTrackVariant[]> {
    const ids = variants.map((v) => v.id);
    const [contexts, counts] = await Promise.all([lmsTrackVariantRepository.contexts(variants, m), lmsTrackVariantRepository.counts(ids, m)]);
    return variants.map((v) => toPublic(v, contexts.get(v.id)!, counts.get(v.id)!));
  }

  private async assertFilterExists<T extends AppBaseEntity>(target: EntityTarget<T>, id: string, field: string, label: string): Promise<void> {
    const found = await AppDataSource.getRepository(target).createQueryBuilder('r').where('r.id = :id', { id }).andWhere('r.isDelete = false').getExists();
    if (!found) throw AppError.badRequest(`The selected ${label} does not exist`, [{ field, message: `Unknown ${label}` }]);
  }

  private async assertUniquePair(m: EntityManager, courseModuleId: string, trackId: string, excludeId?: string): Promise<void> {
    if (await lmsTrackVariantRepository.findByPair(courseModuleId, trackId, { excludeId, manager: m })) {
      throw conflict('A variant for this track already exists.', 'trackId');
    }
  }

  async create(input: CreateTrackVariantInput, req?: Request): Promise<PublicTrackVariant> {
    const id = await AppDataSource.transaction(async (m) => {
      /* The module (FOR SHARE), its course and the course's entity, then the track enabled for that entity. */
      const module = await assertUsableRef(m, LmsCourseModule, input.courseModuleId, 'courseModuleId', 'course module');
      if (module.moduleNumber !== TRACK_VARIANT_MODULE_NUMBER) {
        throw AppError.badRequest('Track variants belong to Module 3', [{ field: 'courseModuleId', message: 'Select a Module 3 course module.' }]);
      }
      if (module.status === 'RETIRED') {
        throw AppError.badRequest('The selected course module is retired', [{ field: 'courseModuleId', message: 'Select a module that is not retired.' }]);
      }
      const course = await assertUsableRef(m, LmsCourse, module.courseId, 'courseModuleId', 'course');
      await assertUsableRef(m, LmsEntity, course.entityId, 'courseModuleId', 'entity');
      const track = await assertTrackEnabled(m, course.entityId, input.trackId, 'trackId');
      await this.assertUniquePair(m, input.courseModuleId, input.trackId);

      const variant = await lmsTrackVariantRepository.create(
        {
          courseModuleId: input.courseModuleId,
          trackId: input.trackId,
          status: 'DRAFT',
          expectedTrackModules: input.expectedTrackModules ?? null,
          expectedOftCards: input.expectedOftCards ?? null,
          syllabusReference: input.syllabusReference ?? null,
          description: input.description ?? null,
          isActive: input.isActive ?? true,
        },
        m,
      );
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.LMS_VARIANT_CREATE,
        resource: 'lms-track-variant',
        resourceId: variant.id,
        details: {
          /* L-07 audit "curriculum.module.created (track_code)". */
          trackCode: track.code,
          after: {
            courseModuleId: variant.courseModuleId,
            trackId: variant.trackId,
            status: variant.status,
            expectedTrackModules: variant.expectedTrackModules,
            expectedOftCards: variant.expectedOftCards,
            syllabusReference: variant.syllabusReference,
            description: variant.description,
            isActive: variant.isActive,
          },
        },
      });
      return variant.id;
    });
    return this.get(id);
  }

  async update(id: string, input: UpdateTrackVariantInput, req?: Request): Promise<PublicTrackVariant> {
    await AppDataSource.transaction(async (m) => {
      const variant = await lockForUpdate(m, LmsTrackVariant, id);
      if (!variant) throw AppError.notFound(NOT_FOUND);
      if (variant.status === 'RETIRED') throw AppError.conflict('A retired track variant cannot be changed.');

      const columns: Partial<Pick<LmsTrackVariant, 'expectedTrackModules' | 'expectedOftCards' | 'syllabusReference' | 'description'>> = {};
      const before: Record<string, unknown> = {};
      const set = <K extends keyof typeof columns>(key: K, value: (typeof columns)[K] | undefined) => {
        if (value === undefined || value === variant[key]) return;
        columns[key] = value;
        before[key] = variant[key];
      };
      set('expectedTrackModules', input.expectedTrackModules);
      set('expectedOftCards', input.expectedOftCards);
      set('syllabusReference', input.syllabusReference);
      set('description', input.description);

      if (!Object.keys(columns).length) return;
      await lmsTrackVariantRepository.update(id, columns, m);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.LMS_VARIANT_UPDATE,
        resource: 'lms-track-variant',
        resourceId: id,
        details: { fields: Object.keys(columns), before, after: columns },
      });
    });
    return this.get(id);
  }

  /* Activation flag (every master's status endpoint); the curriculum lifecycle is publish / retire. */
  async setStatus(id: string, isActive: boolean, req?: Request): Promise<PublicTrackVariant> {
    await AppDataSource.transaction(async (m) => {
      const variant = await lockForUpdate(m, LmsTrackVariant, id);
      if (!variant) throw AppError.notFound(NOT_FOUND);
      await lmsTrackVariantRepository.update(id, { isActive }, m);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.LMS_VARIANT_STATUS,
        resource: 'lms-track-variant',
        resourceId: id,
        details: { before: { isActive: variant.isActive }, after: { isActive } },
      });
    });
    return this.get(id);
  }

  /*
   * Publishes the draft curriculum of the variant (DRAFT or PUBLISHED → PUBLISHED). The proxy for inclusion in
   * a published content release (L-30, not built): "A variant … incomplete … cannot be included in a release"
   * (L-07) — refused with 409 listing what is missing. The variant's DRAFT OFT cards become PUBLISHED
   * (F-LMS-29-12 "PUBLISHED (through a content release)"), which freezes their codes.
   */
  async publish(id: string, req?: Request): Promise<PublicTrackVariant> {
    await AppDataSource.transaction(async (m) => {
      const variant = await lockForUpdate(m, LmsTrackVariant, id);
      if (!variant) throw AppError.notFound(NOT_FOUND);
      if (variant.status === 'RETIRED') throw AppError.conflict('A retired track variant cannot be published.');
      const { completeness } = await this.get(id, m);
      if (!completeness.complete) {
        throw new AppError(
          409,
          'The track variant is incomplete and cannot be published.',
          'CONFLICT',
          completeness.missing.map((x) => ({ field: x.item, message: x.message })),
        );
      }
      const publishedAt = new Date();
      await lmsTrackVariantRepository.update(id, { status: 'PUBLISHED', publishedAt }, m);
      const cards = await m.getRepository(LmsTrackVariantOftCard).update({ trackVariantId: id, status: 'DRAFT', isDelete: false }, { status: 'PUBLISHED' });
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.LMS_VARIANT_STATUS,
        resource: 'lms-track-variant',
        resourceId: id,
        details: { before: { status: variant.status }, after: { status: 'PUBLISHED', publishedAt }, oftCardsPublished: cards.affected ?? 0 },
      });
    });
    return this.get(id);
  }

  /* PUBLISHED → RETIRED: kept for the records that use it, never offered again. */
  async retire(id: string, req?: Request): Promise<PublicTrackVariant> {
    await AppDataSource.transaction(async (m) => {
      const variant = await lockForUpdate(m, LmsTrackVariant, id);
      if (!variant) throw AppError.notFound(NOT_FOUND);
      if (variant.status !== 'PUBLISHED') {
        throw conflict('Only a published track variant can be retired.', 'status', 'Delete a draft variant instead.');
      }
      await lmsTrackVariantRepository.update(id, { status: 'RETIRED' }, m);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.LMS_VARIANT_STATUS,
        resource: 'lms-track-variant',
        resourceId: id,
        details: { before: { status: variant.status }, after: { status: 'RETIRED' } },
      });
    });
    return this.get(id);
  }

  /* Archive: soft-deletes a DRAFT variant; its curriculum rows are kept for a restore. */
  async remove(id: string, req?: Request): Promise<void> {
    await AppDataSource.transaction(async (m) => {
      const variant = await lockForUpdate(m, LmsTrackVariant, id);
      if (!variant) throw AppError.notFound(NOT_FOUND);
      if (variant.status !== 'DRAFT') {
        throw conflict('A published track variant is retired, never deleted.', 'status', 'Retire the variant instead.');
      }
      await lmsTrackVariantRepository.softDelete(id, m);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.LMS_VARIANT_DELETE,
        resource: 'lms-track-variant',
        resourceId: id,
        details: { courseModuleId: variant.courseModuleId, trackId: variant.trackId },
      });
    });
  }

  /* Brings a deleted variant back, inactive. Refused when its (module, track) pair has been taken meanwhile. */
  async restore(id: string, req?: Request): Promise<PublicTrackVariant> {
    await AppDataSource.transaction(async (m) => {
      const existing = await lmsTrackVariantRepository.findByIdIncludingDeleted(id, m);
      if (!existing) throw AppError.notFound(NOT_FOUND);
      if (!existing.isDelete) throw AppError.conflict('Track variant is not deleted');
      await assertUsableRef(m, LmsCourseModule, existing.courseModuleId, 'courseModuleId', 'course module');
      await this.assertUniquePair(m, existing.courseModuleId, existing.trackId, id);
      await lmsTrackVariantRepository.restore(id, m);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.LMS_VARIANT_RESTORE,
        resource: 'lms-track-variant',
        resourceId: id,
        details: { courseModuleId: existing.courseModuleId, trackId: existing.trackId },
      });
    });
    return this.get(id);
  }
}

export const lmsTrackVariantService = new LmsTrackVariantService();
