import type { Request } from 'express';
import type { EntityManager, EntityTarget, FindOptionsWhere } from 'typeorm';
import { AppDataSource } from '../../config/database.config';
import type { AppBaseEntity } from '../../database/base.entity';
import { auditService } from '../../modules/audit';
import { AUDIT_ACTIONS } from '../../shared/constants/app.constants';
import { AppError } from '../../shared/errors/app-error';
import type { Paginated } from '../../shared/utils/pagination';
import type { GeoOption } from '../../cms/masters/geography/geography.types';
import { assertNoRefs, assertUsableRef, countRefs, lockForUpdate, plural } from '../../masters/shared/master-refs';
import { TechnologyTrack } from '../../masters/technology-track/technology-track.model';
import { TrainingCentre } from '../../masters/training-centre/training-centre.model';
import {
  DEFAULT_TIME_ZONE, LMS_LANGUAGE_CODES, LMS_LANGUAGES_CONFIRMED, LMS_PLATFORM_LANGUAGES, timeZoneOptions,
} from './entity.constants';
import { LmsEntity } from './entity.model';
import { lmsEntityRepository } from './entity.repository';
import { lmsEntitySettingRepository } from '../branding/branding.repository';
import { LmsCourse } from '../course/course.model';
import { LmsAcademicCalendar } from '../calendar/calendar.model';
import type {
  CreateLmsEntityInput, EnabledCentre, EnabledTrack, LmsEntityFormOptions, LmsEntityListQuery, LmsEntityReference,
  LmsEntityRelated, PublicLmsEntityDetail, UpdateLmsEntityInput,
} from './entity.types';

/*
 * One kind of LMS record that stores an entityId. `count` returns its non-deleted rows for the entity.
 * `locksCode` marks the records that freeze the entity code.
 */
export interface EntityReferenceSource {
  one: string;
  many?: string;
  locksCode?: boolean;
  count: (m: EntityManager, entityId: string) => Promise<number>;
}

/* An ENTITY_REFERENCES entry counting `target` rows whose `column` holds the entity id. */
export const entityRef = <T extends AppBaseEntity>(
  target: EntityTarget<T>,
  column: keyof T & string,
  one: string,
  opts: { many?: string; locksCode?: boolean } = {},
): EntityReferenceSource => ({ one, ...opts, count: (m, entityId) => countRefs(m, target, column, entityId) });

/*
 * ======================================== ENTITY GUARD LIST ========================================
 * Every LMS master whose table stores an entityId appends ONE line here (import its MODEL, not its
 * service), e.g.
 *     entityRef(LmsCalendar, 'entityId', 'calendar'),
 *     entityRef(LmsCourse, 'entityId', 'course', { locksCode: true }),
 * - Any entry with non-deleted rows blocks delete (remove() → assertNoRefs → readable 409).
 * - `locksCode: true` also freezes the entity code. Set it on lms_courses ONLY: a course using the entity
 *   is this implementation's proxy for the spec's "immutable after first use in API-100" (F-LMS-03-02;
 *   L-03), because API-100 (the Admin Panel catalogue) does not exist in this system.
 * ===================================================================================================
 */
export const ENTITY_REFERENCES: EntityReferenceSource[] = [
  /* ↓ LMS masters append their entityRef(...) line here ↓ */
  entityRef(LmsCourse, 'entityId', 'course', { locksCode: true }),
  entityRef(LmsAcademicCalendar, 'entityId', 'calendar'),
];

/* One kind of LMS record that stores a centreId next to its entityId. `count` returns its non-deleted rows for the pair. */
export interface CentreReferenceSource {
  one: string;
  many?: string;
  count: (m: EntityManager, entityId: string, centreId: string) => Promise<number>;
}

/* A CENTRE_REFERENCES entry counting `target` rows whose `entityColumn` / `centreColumn` hold the pair. */
export const centreRef = <T extends AppBaseEntity>(
  target: EntityTarget<T>,
  entityColumn: keyof T & string,
  centreColumn: keyof T & string,
  one: string,
  opts: { many?: string } = {},
): CentreReferenceSource => ({
  one,
  ...opts,
  count: (m, entityId, centreId) =>
    m.getRepository(target).count({ where: { [entityColumn]: entityId, [centreColumn]: centreId, isDelete: false } as FindOptionsWhere<T> }),
});

/*
 * ======================================== CENTRE GUARD LIST ========================================
 * Every LMS master that stores a centre enabled for the entity (checked with assertCentreEnabled) appends
 * ONE line here (import its MODEL, not its service). Any entry with non-deleted rows for (entity, centre)
 * blocks removing that centre from the entity's selection (update() → 409 on centreIds), so no record is
 * left on a centre the entity no longer enables (F-LMS-05-03 for calendars).
 * ===================================================================================================
 */
export const CENTRE_REFERENCES: CentreReferenceSource[] = [
  /* ↓ LMS masters append their centreRef(...) line here ↓ */
  centreRef(LmsAcademicCalendar, 'entityId', 'centreId', 'calendar'),
];

const CODE_LOCKED = 'The code cannot be changed.';

const conflict = (message: string, field: string, detail: string) => new AppError(409, message, 'CONFLICT', [{ field, message: detail }]);

const toPublic = (e: LmsEntity, centres: EnabledCentre[], tracks: EnabledTrack[]): PublicLmsEntityDetail => ({
  id: e.id,
  name: e.name,
  code: e.code,
  description: e.description,
  defaultLanguage: e.defaultLanguage,
  timeZone: e.timeZone,
  enabledCentres: centres,
  enabledTracks: tracks,
  isActive: e.isActive,
  createdAt: e.createdAt,
  updatedAt: e.updatedAt,
});

/* Old / new selection to the ids to add and the ids to remove. */
const diff = (current: string[], next: string[]) => ({
  added: next.filter((id) => !current.includes(id)),
  removed: current.filter((id) => !next.includes(id)),
});

/*
 * Entity Master — AMRUT_KALASH_03 L-03 / FR-303, form F-LMS-03 (Table 28), table DB-302.
 *
 * - Name (3–120) is unique case-insensitively; code (A–Z, 0–9, hyphen, 2–20) is unique. Both among
 *   non-deleted entities, with a 409 carrying the field.
 * - The code is frozen once a course uses the entity (ENTITY_REFERENCES locksCode; proxy for API-100).
 * - Enabled centres / tracks are chosen from the Admin Panel's records (read-only here): a newly enabled one
 *   must be active and not deleted (assertUsableRef, FOR SHARE). One already enabled that the Admin Panel
 *   later deactivated stays in the selection, reported with isActive false, until an administrator removes
 *   it — the spec leaves that case open. None are required at creation (≥ 1 only "before a batch").
 *   A centre cannot leave the selection while a CENTRE_REFERENCES record of the entity uses it (409).
 * - A new default language is added to the entity's stored enabled languages (F-LMS-04-07), audited.
 * - Deactivation is not blocked: the spec blocks it only while LMS batches are ACTIVE, and LMS batches do
 *   not exist in this system.
 * - Delete (archive) is a soft delete, refused while any ENTITY_REFERENCES record points at the entity.
 *   The entity row is locked FOR UPDATE before counting; child writes read it FOR SHARE (assertUsableRef),
 *   so no child is left under a deleted entity and the code cannot change under a course being created.
 * - Every write runs in one transaction with its audit record (before / after values).
 */
export class LmsEntityService {
  async list(q: LmsEntityListQuery): Promise<Paginated<PublicLmsEntityDetail>> {
    if (q.centreId) await this.assertFilterExists(TrainingCentre, q.centreId, 'centreId', 'training centre');
    if (q.trackId) await this.assertFilterExists(TechnologyTrack, q.trackId, 'trackId', 'technology track');
    const page = await lmsEntityRepository.list(q);
    const ids = page.items.map((e) => e.id);
    const [centres, tracks] = await Promise.all([lmsEntityRepository.enabledCentres(ids), lmsEntityRepository.enabledTracks(ids)]);
    return { items: page.items.map((e) => toPublic(e, centres.get(e.id) ?? [], tracks.get(e.id) ?? [])), meta: page.meta };
  }

  async get(id: string): Promise<PublicLmsEntityDetail> {
    const entity = await lmsEntityRepository.findById(id);
    if (!entity) throw AppError.notFound('Entity not found');
    const m = AppDataSource.manager;
    const [centres, tracks, related] = await Promise.all([
      lmsEntityRepository.enabledCentres([id], m),
      lmsEntityRepository.enabledTracks([id], m),
      this.related(m, id),
    ]);
    return { ...toPublic(entity, centres.get(id) ?? [], tracks.get(id) ?? []), related };
  }

  /* Contract E1: active entities, A to Z. */
  async options(): Promise<GeoOption[]> {
    const rows = await lmsEntityRepository.findSelectable();
    return rows.map((e) => ({ id: e.id, name: e.name, code: e.code }));
  }

  formOptions(): LmsEntityFormOptions {
    return {
      languages: LMS_PLATFORM_LANGUAGES.map((l) => ({ code: l.code, label: l.label })),
      languagesConfirmed: LMS_LANGUAGES_CONFIRMED,
      timeZones: timeZoneOptions(),
      defaultTimeZone: DEFAULT_TIME_ZONE,
    };
  }

  /* The ENTITY_REFERENCES counts for one entity, non-zero ones only. */
  async related(m: EntityManager, id: string): Promise<LmsEntityRelated> {
    const references: LmsEntityReference[] = [];
    for (const ref of ENTITY_REFERENCES) {
      const count = await ref.count(m, id);
      if (count > 0) references.push({ label: plural(count, ref.one, ref.many), count, locksCode: ref.locksCode === true });
    }
    return { codeLocked: references.some((r) => r.locksCode), references };
  }

  private async assertFilterExists<T extends AppBaseEntity>(target: EntityTarget<T>, id: string, field: string, label: string): Promise<void> {
    const found = await AppDataSource.getRepository(target).createQueryBuilder('r').where('r.id = :id', { id }).andWhere('r.isDelete = false').getExists();
    if (!found) throw AppError.badRequest(`The selected ${label} does not exist`, [{ field, message: `Unknown ${label}` }]);
  }

  private async assertUniqueName(name: string | undefined, excludeId: string | undefined, m: EntityManager): Promise<void> {
    if (name && (await lmsEntityRepository.findByName(name, { excludeId, manager: m }))) {
      throw conflict('An entity with this name already exists', 'name', 'This name is already used.');
    }
  }

  private async assertUniqueCode(code: string | undefined, excludeId: string | undefined, m: EntityManager): Promise<void> {
    if (code && (await lmsEntityRepository.findByCode(code, { excludeId, manager: m }))) {
      throw conflict('An entity with this code already exists', 'code', 'This code is already used.');
    }
  }

  /* Newly enabled centres / tracks must be usable Admin Panel records (F-LMS-03-04 / -05 "only ACTIVE rows"). */
  private async assertSelectable(m: EntityManager, centreIds: string[], trackIds: string[]): Promise<void> {
    for (const id of centreIds) await assertUsableRef(m, TrainingCentre, id, 'centreIds', 'training centre');
    for (const id of trackIds) await assertUsableRef(m, TechnologyTrack, id, 'trackIds', 'technology track');
  }

  /*
   * A centre leaves the selection only when no CENTRE_REFERENCES record of the entity uses it (409 on
   * centreIds). The caller holds the entity row FOR UPDATE, and every such record's write locks it first.
   */
  private async assertCentresUnused(m: EntityManager, entityId: string, centreIds: string[]): Promise<void> {
    for (const centreId of centreIds) {
      const held: string[] = [];
      let total = 0;
      for (const ref of CENTRE_REFERENCES) {
        const count = await ref.count(m, entityId, centreId);
        if (count > 0) held.push(plural(count, ref.one, ref.many));
        total += count;
      }
      if (!held.length) continue;
      const name = (await m.getRepository(TrainingCentre).findOne({ where: { id: centreId } }))?.name ?? 'This centre';
      const list = held.join(' and ');
      throw conflict(
        `${name} cannot be removed from the entity while ${list} of this entity ${total === 1 ? 'uses' : 'use'} it. Delete those records or change their centre first.`,
        'centreIds',
        `${name} is still used by ${list}.`,
      );
    }
  }

  async create(input: CreateLmsEntityInput, req?: Request): Promise<PublicLmsEntityDetail> {
    const id = await AppDataSource.transaction(async (m) => {
      await this.assertUniqueName(input.name, undefined, m);
      await this.assertUniqueCode(input.code, undefined, m);
      await this.assertSelectable(m, input.centreIds, input.trackIds);

      const entity = await lmsEntityRepository.create(
        {
          name: input.name,
          code: input.code,
          description: input.description ?? null,
          defaultLanguage: input.defaultLanguage,
          timeZone: input.timeZone,
          isActive: input.isActive ?? true,
        },
        m,
      );
      await lmsEntityRepository.addCentres(entity.id, input.centreIds, m);
      await lmsEntityRepository.addTracks(entity.id, input.trackIds, m);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.LMS_ENTITY_CREATE,
        resource: 'lms-entity',
        resourceId: entity.id,
        details: {
          after: {
            name: entity.name,
            code: entity.code,
            description: entity.description,
            defaultLanguage: entity.defaultLanguage,
            timeZone: entity.timeZone,
            isActive: entity.isActive,
            centreIds: input.centreIds,
            trackIds: input.trackIds,
          },
        },
      });
      return entity.id;
    });
    return this.get(id);
  }

  async update(id: string, input: UpdateLmsEntityInput, req?: Request): Promise<PublicLmsEntityDetail> {
    await AppDataSource.transaction(async (m) => {
      /* Locked FOR UPDATE before the reference count: a course being created for this entity holds it FOR SHARE. */
      const entity = await lockForUpdate(m, LmsEntity, id);
      if (!entity) throw AppError.notFound('Entity not found');

      if (input.name !== undefined && input.name !== entity.name) await this.assertUniqueName(input.name, id, m);

      const codeChanged = input.code !== undefined && input.code !== entity.code;
      if (codeChanged) {
        if ((await this.related(m, id)).codeLocked) throw conflict(`${CODE_LOCKED} Courses already use this entity.`, 'code', CODE_LOCKED);
        await this.assertUniqueCode(input.code, id, m);
      }

      const columns: Partial<Pick<LmsEntity, 'name' | 'code' | 'description' | 'defaultLanguage' | 'timeZone'>> = {};
      const before: Record<string, unknown> = {};
      const set = <K extends keyof typeof columns>(key: K, value: (typeof columns)[K] | undefined) => {
        if (value === undefined || value === entity[key]) return;
        columns[key] = value;
        before[key] = entity[key];
      };
      set('name', input.name);
      if (codeChanged) set('code', input.code);
      set('description', input.description);
      set('defaultLanguage', input.defaultLanguage);
      set('timeZone', input.timeZone);

      /* F-LMS-04-07: the enabled languages always keep the default language; a new default is enabled with it. */
      if (columns.defaultLanguage) {
        const row = (await lmsEntitySettingRepository.forEntity(id, m)).get('languages');
        const enabled = (row?.value ?? null) as string[] | null;
        if (enabled && !enabled.includes(columns.defaultLanguage)) {
          const after = LMS_LANGUAGE_CODES.filter((c) => c === columns.defaultLanguage || enabled.includes(c));
          await lmsEntitySettingRepository.write(id, 'languages', after, row, m);
          await auditService.recordInTx(m, req, {
            action: AUDIT_ACTIONS.LMS_SETTING_UPDATE,
            resource: 'lms-branding',
            resourceId: id,
            details: { event: 'entity.setting.updated', key: 'languages', before: enabled, after },
          });
        }
      }

      let centres: { added: string[]; removed: string[] } | undefined;
      if (input.centreIds) {
        centres = diff(await lmsEntityRepository.selectedCentreIds(id, m), input.centreIds);
        await this.assertSelectable(m, centres.added, []);
        await this.assertCentresUnused(m, id, centres.removed);
        await lmsEntityRepository.removeCentres(id, centres.removed, m);
        await lmsEntityRepository.addCentres(id, centres.added, m);
      }
      let tracks: { added: string[]; removed: string[] } | undefined;
      if (input.trackIds) {
        tracks = diff(await lmsEntityRepository.selectedTrackIds(id, m), input.trackIds);
        await this.assertSelectable(m, [], tracks.added);
        await lmsEntityRepository.removeTracks(id, tracks.removed, m);
        await lmsEntityRepository.addTracks(id, tracks.added, m);
      }

      if (Object.keys(columns).length) await lmsEntityRepository.update(id, columns, m);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.LMS_ENTITY_UPDATE,
        resource: 'lms-entity',
        resourceId: id,
        details: {
          fields: Object.keys(columns),
          before,
          after: columns,
          centres: centres && (centres.added.length || centres.removed.length) ? centres : undefined,
          tracks: tracks && (tracks.added.length || tracks.removed.length) ? tracks : undefined,
        },
      });
    });
    return this.get(id);
  }

  /* F-LMS-03-08 ACTIVE ↔ INACTIVE. Not blocked: the spec's guard concerns LMS batches, which do not exist here. */
  async setStatus(id: string, isActive: boolean, req?: Request): Promise<PublicLmsEntityDetail> {
    await AppDataSource.transaction(async (m) => {
      const entity = await lmsEntityRepository.findById(id, { manager: m });
      if (!entity) throw AppError.notFound('Entity not found');
      await lmsEntityRepository.update(id, { isActive }, m);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.LMS_ENTITY_STATUS,
        resource: 'lms-entity',
        resourceId: id,
        details: { before: { isActive: entity.isActive }, after: { isActive }, name: entity.name, code: entity.code },
      });
    });
    return this.get(id);
  }

  /*
   * Archive (entity.archive): soft-deletes the entity. Refused while any record in ENTITY_REFERENCES (top
   * of this file — the guard list the other LMS masters append to) points at it; L-03: an entity with
   * records "can be set INACTIVE but never deleted". The selection rows are kept, so a restore brings the
   * same configuration back.
   */
  async remove(id: string, req?: Request): Promise<void> {
    await AppDataSource.transaction(async (m) => {
      const entity = await lockForUpdate(m, LmsEntity, id);
      if (!entity) throw AppError.notFound('Entity not found');
      const refs = [];
      /* ENTITY GUARD: the counted tables are the ENTITY_REFERENCES list at the top of this file — add yours there. */
      for (const ref of ENTITY_REFERENCES) refs.push({ count: await ref.count(m, id), one: ref.one, many: ref.many });
      assertNoRefs('entity', refs);
      await lmsEntityRepository.softDelete(id, m);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.LMS_ENTITY_DELETE,
        resource: 'lms-entity',
        resourceId: id,
        details: { name: entity.name, code: entity.code },
      });
    });
  }

  /* Brings a deleted entity back, inactive. Refused when its name or code has been taken meanwhile. */
  async restore(id: string, req?: Request): Promise<PublicLmsEntityDetail> {
    await AppDataSource.transaction(async (m) => {
      const existing = await lmsEntityRepository.findByIdIncludingDeleted(id, m);
      if (!existing) throw AppError.notFound('Entity not found');
      if (!existing.isDelete) throw AppError.conflict('Entity is not deleted');
      await this.assertUniqueName(existing.name, id, m);
      await this.assertUniqueCode(existing.code, id, m);
      await lmsEntityRepository.restore(id, m);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.LMS_ENTITY_RESTORE,
        resource: 'lms-entity',
        resourceId: id,
        details: { name: existing.name, code: existing.code },
      });
    });
    return this.get(id);
  }
}

export const lmsEntityService = new LmsEntityService();
