import type { Request } from 'express';
import type { DeepPartial, EntityManager, EntityTarget, FindOptionsWhere } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { AppDataSource } from '../../config/database.config';
import type { AppBaseEntity } from '../../database/base.entity';
import { assertNoRefs, countRefs, lockForUpdate } from '../../masters/shared/master-refs';
import { TechnologyTrack } from '../../masters/technology-track/technology-track.model';
import { auditService } from '../../modules/audit';
import { AUDIT_ACTIONS } from '../../shared/constants/app.constants';
import { AppError } from '../../shared/errors/app-error';
import { LEARNING_COMPONENT_LABELS, SINGLE_LEARNING_COMPONENTS, oftCodePattern, type LearningComponentKind } from './track-variant.constants';
import { LmsTrackVariantAssessmentComponent } from './track-variant-assessment-component.model';
import { LmsTrackVariantComponent } from './track-variant-component.model';
import { LmsTrackVariantReadinessGate } from './track-variant-gate.model';
import { LmsTrackVariantModule } from './track-variant-module.model';
import { LmsTrackVariantOftCard } from './track-variant-oft-card.model';
import { LmsTrackVariantPhase } from './track-variant-phase.model';
import { LmsTrackVariant } from './track-variant.model';

/*
 * The curriculum of a Module 3 track variant — nested CRUD under /track-variants/:id/<path>:
 * phases, track modules, learning components, OFT cards (F-LMS-29), assessment components (F-LMS-18-10) and
 * readiness gates (F-LMS-32). One definition per kind (ITEM_KINDS below) drives list / get / create / update /
 * delete, so every kind gets the same rules:
 * - Every write locks the variant FOR UPDATE first (one writer per variant at a time: uniqueness, gate order
 *   and delete guards are checked against committed rows) and runs in one transaction with its audit record.
 * - A RETIRED variant is read-only (409). Edits to a PUBLISHED variant are edits of the draft curriculum.
 * - References to other items (phase, track module) must be live items of the SAME variant (400 with field).
 * - Uniqueness per variant answers 409 with the field (partial unique indexes back them up).
 * - Delete is a soft delete, refused (409) while another item of the variant points at the row.
 */

type Row = AppBaseEntity & { trackVariantId: string };
type Values = Record<string, unknown>;

interface Ctx {
  m: EntityManager;
  variant: LmsTrackVariant;
}

interface UniqueRule {
  field: string;
  message: (v: Values) => string;
  /* Applies only when this returns true for the resulting values (e.g. the single learning components). */
  when?: (v: Values) => boolean;
}

interface ItemKind {
  path: string;
  one: string;
  resource: string;
  target: EntityTarget<Row>;
  /* ORDER BY of the list (columns of the item). */
  order: Record<string, 'ASC' | 'DESC'>;
  /* Public columns, beside id / trackVariantId / timestamps. */
  fields: string[];
  unique: UniqueRule[];
  /* Checks a create (row undefined) or update and returns the columns to write. */
  prepare(ctx: Ctx, input: Values, row?: Values): Promise<Values>;
  guardDelete?(ctx: Ctx, row: Values): Promise<void>;
  afterWrite?(ctx: Ctx, field: string): Promise<void>;
  /* Extra refusal of any update / delete of the row (e.g. a retired OFT card). */
  locked?(row: Values): string | null;
}

const conflict = (message: string, field: string, detail = message) => new AppError(409, message, 'CONFLICT', [{ field, message: detail }]);
const invalid = (message: string, field: string, detail = message) => AppError.badRequest(message, [{ field, message: detail }]);

/* A live item of the same variant, or 400 on `field`. */
async function assertSameVariant<T extends Row>(ctx: Ctx, target: EntityTarget<T>, id: string, field: string, message: string): Promise<T> {
  const row = await ctx.m.getRepository(target).findOne({ where: { id, trackVariantId: ctx.variant.id, isDelete: false } as FindOptionsWhere<T> });
  if (!row) throw invalid(message, field);
  return row;
}

/* Only the keys that were sent (undefined = not sent; null = cleared). */
const sent = (input: Values, keys: string[]): Values => Object.fromEntries(keys.filter((k) => input[k] !== undefined).map((k) => [k, input[k]]));

/*
 * F-LMS-32-04 "gate order follows track-module order": gate n is held after an earlier track module than gate
 * n + 1. Checked after every gate write and every track-module write (a reorder can break it too).
 */
async function assertGateOrder(ctx: Ctx, onError: (detail: string) => AppError): Promise<void> {
  const rows: { gateNumber: number; sortOrder: number; code: string }[] = await ctx.m.query(
    `SELECT g."gateNumber" AS "gateNumber", tm."sortOrder" AS "sortOrder", tm."code" AS "code"
       FROM "lms_track_variant_readiness_gates" g
       JOIN "lms_track_variant_modules" tm ON tm."id" = g."heldAfterTrackModuleId"
      WHERE g."trackVariantId" = $1 AND g."isDelete" = false
      ORDER BY g."gateNumber"`,
    [ctx.variant.id],
  );
  for (let i = 1; i < rows.length; i++) {
    if (Number(rows[i].sortOrder) <= Number(rows[i - 1].sortOrder)) {
      throw onError(
        `Gate ${rows[i].gateNumber} must be held after a later track module than gate ${rows[i - 1].gateNumber} (${rows[i - 1].code}).`,
      );
    }
  }
}

const PHASES: ItemKind = {
  path: 'phases',
  one: 'phase',
  resource: 'lms-track-variant-phase',
  target: LmsTrackVariantPhase,
  order: { phaseNumber: 'ASC' },
  fields: ['phaseNumber', 'title', 'description'],
  unique: [{ field: 'phaseNumber', message: () => 'This phase already exists for the variant.' }],
  async prepare(_ctx, input) {
    return sent(input, this.fields);
  },
  async guardDelete(ctx, row) {
    assertNoRefs('phase', [{ count: await countRefs(ctx.m, LmsTrackVariantModule, 'phaseId', row.id as string), one: 'track module' }]);
  },
};

const TRACK_MODULES: ItemKind = {
  path: 'track-modules',
  one: 'track module',
  resource: 'lms-track-variant-module',
  target: LmsTrackVariantModule,
  order: { sortOrder: 'ASC' },
  fields: ['phaseId', 'code', 'title', 'sortOrder', 'lectureHours', 'practicalHours', 'description'],
  unique: [
    { field: 'code', message: () => 'This track module code is already used in this variant.' },
    { field: 'sortOrder', message: () => 'Another track module of this variant has this position.' },
  ],
  async prepare(ctx, input) {
    if (input.phaseId !== undefined) await assertSameVariant(ctx, LmsTrackVariantPhase, input.phaseId as string, 'phaseId', 'Select a phase of this variant.');
    return sent(input, this.fields);
  },
  async guardDelete(ctx, row) {
    const id = row.id as string;
    assertNoRefs('track module', [
      { count: await countRefs(ctx.m, LmsTrackVariantReadinessGate, 'heldAfterTrackModuleId', id), one: 'readiness gate' },
      { count: await countRefs(ctx.m, LmsTrackVariantOftCard, 'linkedTrackModuleId', id), one: 'OFT card' },
      { count: await countRefs(ctx.m, LmsTrackVariantComponent, 'trackModuleId', id), one: 'learning component' },
    ]);
  },
  async afterWrite(ctx) {
    await assertGateOrder(ctx, (d) => conflict('This position would put the readiness gates out of track-module order.', 'sortOrder', d));
  },
};

const LEARNING_COMPONENTS: ItemKind = {
  path: 'learning-components',
  one: 'learning component',
  resource: 'lms-track-variant-component',
  target: LmsTrackVariantComponent,
  order: { kind: 'ASC', createdAt: 'ASC' },
  fields: ['kind', 'title', 'trackModuleId', 'description'],
  unique: [
    {
      field: 'kind',
      when: (v) => SINGLE_LEARNING_COMPONENTS.includes(v.kind as LearningComponentKind),
      message: (v) => `This variant already has a ${LEARNING_COMPONENT_LABELS[v.kind as LearningComponentKind]}.`,
    },
  ],
  async prepare(ctx, input) {
    if (input.trackModuleId) {
      await assertSameVariant(ctx, LmsTrackVariantModule, input.trackModuleId as string, 'trackModuleId', 'Select a track module of this variant.');
    }
    return sent(input, this.fields);
  },
};

const OFT_CARDS: ItemKind = {
  path: 'oft-cards',
  one: 'OFT card',
  resource: 'lms-track-variant-oft-card',
  target: LmsTrackVariantOftCard,
  order: { oftCode: 'ASC' },
  fields: [
    'oftCode', 'title', 'stage', 'linkedTrackModuleId', 'instructions', 'hoursMin', 'hoursMax', 'deliverable', 'evidenceTypes',
    'evidenceNotes', 'hostVerificationRequired', 'status',
  ],
  unique: [{ field: 'oftCode', message: () => 'This OFT code is already used in this module.' }],
  locked: (row) => (row.status === 'RETIRED' ? 'A retired OFT card cannot be changed.' : null),
  async prepare(ctx, input, row) {
    if (input.oftCode !== undefined && input.oftCode !== row?.oftCode) {
      /* F-LMS-29-01: immutable once released (here: once published with the variant — batches do not exist). */
      if (row && row.status !== 'DRAFT') throw conflict('The OFT code cannot be changed once the card is published.', 'oftCode');
      const track = await ctx.m.getRepository(TechnologyTrack).findOne({ where: { id: ctx.variant.trackId } });
      const code = track?.code ?? '';
      if (!oftCodePattern(code).test(input.oftCode as string)) {
        throw invalid('The OFT code does not match this track', 'oftCode', `Use the pattern OFT-M3-${code}-{nn}, for example OFT-M3-${code}-01.`);
      }
    }
    if (input.linkedTrackModuleId) {
      await assertSameVariant(ctx, LmsTrackVariantModule, input.linkedTrackModuleId as string, 'linkedTrackModuleId', 'Select an item of the same module.');
    }
    const min = (input.hoursMin ?? row?.hoursMin) as number;
    const max = (input.hoursMax ?? row?.hoursMax) as number;
    if (Number(min) > Number(max)) throw invalid('Enter a valid hours range.', 'hoursMax');
    /* status is set by publish / retire only. */
    return sent(input, this.fields.filter((f) => f !== 'status'));
  },
  async guardDelete(_ctx, row) {
    if (row.status === 'PUBLISHED') throw conflict('A published OFT card is retired, never deleted.', 'status', 'Retire the card instead.');
  },
};

const ASSESSMENT_COMPONENTS: ItemKind = {
  path: 'assessment-components',
  one: 'assessment component',
  resource: 'lms-track-variant-assessment-component',
  target: LmsTrackVariantAssessmentComponent,
  order: { sortOrder: 'ASC' },
  fields: ['componentCode', 'label', 'weight', 'source', 'indicative', 'sortOrder'],
  unique: [
    { field: 'componentCode', message: () => 'This component code is already used in this variant.' },
    { field: 'sortOrder', message: () => 'Another component of this variant has this position.' },
  ],
  async prepare(_ctx, input, row) {
    /* F-LMS-18-10: changing a weight "needs a reference to the prescribing decision". */
    const weightChanged = row && row.weight !== null && input.weight !== undefined && Number(input.weight) !== Number(row.weight);
    if (weightChanged && !input.source) throw invalid('Enter the reference for this change.', 'source');
    return sent(input, this.fields);
  },
};

const READINESS_GATES: ItemKind = {
  path: 'readiness-gates',
  one: 'readiness gate',
  resource: 'lms-track-variant-readiness-gate',
  target: LmsTrackVariantReadinessGate,
  order: { gateNumber: 'ASC' },
  fields: [
    'gateNumber', 'title', 'heldAfterTrackModuleId', 'demonstration', 'evidenceTypes', 'evidenceNotes', 'remediationPath', 'clearanceMode',
    'clearanceMinBand',
  ],
  unique: [{ field: 'gateNumber', message: () => 'This gate already exists for the track.' }],
  async prepare(ctx, input, row) {
    if (input.heldAfterTrackModuleId !== undefined) {
      await assertSameVariant(ctx, LmsTrackVariantModule, input.heldAfterTrackModuleId as string, 'heldAfterTrackModuleId', 'Select a track module of this track.');
    }
    const out = sent(input, this.fields);
    /* F-LMS-32-08: 'assessor decides', or 'minimum band' with a band 1–5 (no band assumed, OQ-013). */
    const mode = (input.clearanceMode ?? row?.clearanceMode ?? 'ASSESSOR_DECIDES') as string;
    if (mode === 'ASSESSOR_DECIDES') {
      if (input.clearanceMinBand !== undefined && input.clearanceMinBand !== null) {
        throw invalid('A minimum band applies only when the gate is cleared by minimum band.', 'clearanceMinBand');
      }
      if (row?.clearanceMinBand !== null && row?.clearanceMinBand !== undefined) out.clearanceMinBand = null;
    } else {
      const band = input.clearanceMinBand !== undefined ? input.clearanceMinBand : (row?.clearanceMinBand ?? null);
      if (band === null) throw invalid('Choose how the gate is cleared.', 'clearanceMinBand', 'Choose a minimum band from 1 to 5.');
    }
    return out;
  },
  async afterWrite(ctx) {
    await assertGateOrder(ctx, (d) => invalid('Gate order must follow track-module order.', 'heldAfterTrackModuleId', d));
  },
};

export const ITEM_KINDS = { PHASES, TRACK_MODULES, LEARNING_COMPONENTS, OFT_CARDS, ASSESSMENT_COMPONENTS, READINESS_GATES } as const;
export type ItemKindName = keyof typeof ITEM_KINDS;

const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const toPublic = (kind: ItemKind, row: Values) => ({
  id: row.id,
  trackVariantId: row.trackVariantId,
  ...Object.fromEntries(kind.fields.map((f) => [f, row[f]])),
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

export class TrackVariantItemsService {
  private async variant(m: EntityManager, id: string, lock: boolean): Promise<LmsTrackVariant> {
    const variant = lock
      ? await lockForUpdate(m, LmsTrackVariant, id)
      : await m.getRepository(LmsTrackVariant).findOne({ where: { id, isDelete: false } });
    if (!variant) throw AppError.notFound('Track variant not found');
    return variant;
  }

  private async writable(m: EntityManager, id: string): Promise<Ctx> {
    const variant = await this.variant(m, id, true);
    if (variant.status === 'RETIRED') throw AppError.conflict('A retired track variant cannot be changed.');
    return { m, variant };
  }

  private async item(ctx: Ctx, kind: ItemKind, itemId: string): Promise<Values> {
    const row = await ctx.m.getRepository(kind.target).findOne({ where: { id: itemId, trackVariantId: ctx.variant.id, isDelete: false } });
    if (!row) throw AppError.notFound(`${titleCase(kind.one)} not found`);
    return row as unknown as Values;
  }

  private async assertUnique(ctx: Ctx, kind: ItemKind, values: Values, excludeId?: string): Promise<void> {
    for (const rule of kind.unique) {
      if (rule.when && !rule.when(values)) continue;
      const qb = ctx.m
        .getRepository(kind.target)
        .createQueryBuilder('i')
        .where('i.trackVariantId = :variantId', { variantId: ctx.variant.id })
        .andWhere('i.isDelete = false')
        .andWhere(`i.${rule.field} = :value`, { value: values[rule.field] });
      if (excludeId) qb.andWhere('i.id <> :excludeId', { excludeId });
      if (await qb.getExists()) throw conflict(rule.message(values), rule.field);
    }
  }

  async list(kindName: ItemKindName, variantId: string) {
    const kind = ITEM_KINDS[kindName];
    const m = AppDataSource.manager;
    await this.variant(m, variantId, false);
    const rows = await m.getRepository(kind.target).find({
      where: { trackVariantId: variantId, isDelete: false },
      order: kind.order as never,
    });
    return rows.map((r) => toPublic(kind, r as unknown as Values));
  }

  async get(kindName: ItemKindName, variantId: string, itemId: string) {
    const kind = ITEM_KINDS[kindName];
    const m = AppDataSource.manager;
    const variant = await this.variant(m, variantId, false);
    return toPublic(kind, await this.item({ m, variant }, kind, itemId));
  }

  async create(kindName: ItemKindName, variantId: string, input: Values, req?: Request) {
    const kind = ITEM_KINDS[kindName];
    const id = await AppDataSource.transaction(async (m) => {
      const ctx = await this.writable(m, variantId);
      const columns = await kind.prepare(ctx, input);
      await this.assertUnique(ctx, kind, columns);
      const repo = m.getRepository(kind.target);
      const saved = await repo.save(repo.create({ ...columns, trackVariantId: variantId } as DeepPartial<Row>));
      await kind.afterWrite?.(ctx, 'create');
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.LMS_VARIANT_ITEM_CREATE,
        resource: kind.resource,
        resourceId: saved.id,
        details: { trackVariantId: variantId, after: columns },
      });
      return saved.id;
    });
    return this.get(kindName, variantId, id);
  }

  async update(kindName: ItemKindName, variantId: string, itemId: string, input: Values, req?: Request) {
    const kind = ITEM_KINDS[kindName];
    await AppDataSource.transaction(async (m) => {
      const ctx = await this.writable(m, variantId);
      const row = await this.item(ctx, kind, itemId);
      const lockedReason = kind.locked?.(row);
      if (lockedReason) throw AppError.conflict(lockedReason);
      const prepared = await kind.prepare(ctx, input, row);
      /* Only the columns whose value changes are written and audited. */
      const columns: Values = {};
      const before: Values = {};
      for (const [k, v] of Object.entries(prepared)) {
        if (JSON.stringify(v) === JSON.stringify(row[k])) continue;
        columns[k] = v;
        before[k] = row[k];
      }
      if (!Object.keys(columns).length) return;
      await this.assertUnique(ctx, kind, { ...row, ...columns }, itemId);
      await m.getRepository(kind.target).update({ id: itemId }, columns as QueryDeepPartialEntity<Row>);
      await kind.afterWrite?.(ctx, 'update');
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.LMS_VARIANT_ITEM_UPDATE,
        resource: kind.resource,
        resourceId: itemId,
        details: { trackVariantId: variantId, fields: Object.keys(columns), before, after: columns },
      });
    });
    return this.get(kindName, variantId, itemId);
  }

  async remove(kindName: ItemKindName, variantId: string, itemId: string, req?: Request): Promise<void> {
    const kind = ITEM_KINDS[kindName];
    await AppDataSource.transaction(async (m) => {
      const ctx = await this.writable(m, variantId);
      const row = await this.item(ctx, kind, itemId);
      const lockedReason = kind.locked?.(row);
      if (lockedReason) throw AppError.conflict(lockedReason);
      await kind.guardDelete?.(ctx, row);
      await m.getRepository(kind.target).update({ id: itemId }, { isDelete: true, isActive: false } as QueryDeepPartialEntity<Row>);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.LMS_VARIANT_ITEM_DELETE,
        resource: kind.resource,
        resourceId: itemId,
        details: { trackVariantId: variantId, before: Object.fromEntries(kind.fields.map((f) => [f, row[f]])) },
      });
    });
  }

  /* F-LMS-29-12 "Retire action": a PUBLISHED card becomes RETIRED (kept, no longer counted); a draft is deleted instead. */
  async retireOftCard(variantId: string, itemId: string, req?: Request) {
    await AppDataSource.transaction(async (m) => {
      const ctx = await this.writable(m, variantId);
      const row = await this.item(ctx, OFT_CARDS, itemId);
      if (row.status !== 'PUBLISHED') throw conflict('Only a published OFT card can be retired; delete a draft card instead.', 'status');
      await m.getRepository(LmsTrackVariantOftCard).update({ id: itemId }, { status: 'RETIRED' });
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.LMS_VARIANT_ITEM_UPDATE,
        resource: OFT_CARDS.resource,
        resourceId: itemId,
        details: { trackVariantId: variantId, fields: ['status'], before: { status: row.status }, after: { status: 'RETIRED' }, oftCode: row.oftCode },
      });
    });
    return this.get('OFT_CARDS', variantId, itemId);
  }
}

export const trackVariantItemsService = new TrackVariantItemsService();
