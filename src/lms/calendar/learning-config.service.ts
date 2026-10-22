import type { Request } from 'express';
import { IsNull } from 'typeorm';
import { AppDataSource } from '../../config/database.config';
import { auditService } from '../../modules/audit';
import { AUDIT_ACTIONS } from '../../shared/constants/app.constants';
import { AppError } from '../../shared/errors/app-error';
import { assertUsableRef } from '../../masters/shared/master-refs';
import { LmsEntity } from '../entity/entity.model';
import { lmsCalendarRepository } from './calendar.repository';
import type { LearningConfigView, PublicLearningConfigValue, UpdateLearningConfigInput } from './calendar.types';
import {
  LEARNING_CONFIG_KEYS, LEARNING_CONFIG_KEY_MAP, LEARNING_CONFIG_MODES, SYLLABUS_SOURCE,
  type LearningConfigKeyDef, type LearningConfigMode, type LearningConfigValue,
} from './learning-config.constants';
import { LmsLearningConfig } from './learning-config.model';

const PRESCRIBED_SOURCE = 'To be prescribed by the competent authority';
const RANGE_MESSAGE = 'Enter a value within the allowed range.';

const invalid = (message: string) => AppError.badRequest(RANGE_MESSAGE, [{ field: 'value', message }]);

const isWhole = (v: unknown, min: number): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= min;

/*
 * The value checked against the key's type (F-LMS-05-07 "type and range defined per key"; "a range key needs
 * minimum ≤ maximum"). Returns it normalised (trimmed text, list in the catalogue's order).
 */
function parseValue(def: LearningConfigKeyDef, v: unknown): LearningConfigValue {
  const min = def.min ?? 0;
  switch (def.type) {
    case 'integer':
    case 'duration':
      if (!isWhole(v, min)) throw invalid(`Enter a whole number${def.unit ? ` of ${def.unit}` : ''}, at least ${min}.`);
      return v;
    case 'percentage':
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 100) throw invalid('Enter a percentage from 0 to 100.');
      return v;
    case 'range': {
      const r = v as { min?: unknown; max?: unknown } | null;
      if (typeof r !== 'object' || r === null || Array.isArray(r) || Object.keys(r).some((k) => k !== 'min' && k !== 'max')) {
        throw invalid('Enter a minimum and a maximum.');
      }
      if (!isWhole(r.min, min) || !isWhole(r.max, min)) throw invalid(`Enter whole numbers${def.unit ? ` of ${def.unit}` : ''}, at least ${min}.`);
      if (r.min > r.max) throw invalid('The minimum cannot be greater than the maximum.');
      return { min: r.min, max: r.max };
    }
    case 'enum':
      if (typeof v !== 'string' || !def.options?.includes(v)) throw invalid(`Choose one of: ${def.options?.join(', ')}.`);
      return v;
    case 'enum-list': {
      const options = def.options ?? [];
      if (!Array.isArray(v) || !v.length || v.some((x) => typeof x !== 'string' || !options.includes(x)) || new Set(v).size !== v.length) {
        throw invalid(`Choose one or more of: ${options.join(', ')}, each once.`);
      }
      return options.filter((o) => (v as string[]).includes(o));
    }
    case 'labels': {
      const n = def.length ?? 0;
      if (!Array.isArray(v) || v.length !== n || v.some((x) => typeof x !== 'string' || !x.trim() || x.trim().length > 60)) {
        throw invalid(`Enter ${n} labels of 1 to 60 characters.`);
      }
      return (v as string[]).map((x) => x.trim());
    }
    case 'text':
      if (typeof v !== 'string' || !v.trim() || v.trim().length > 500) throw invalid('Enter a text of 1 to 500 characters.');
      return v.trim();
  }
}

const sameValue = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

const view = (def: LearningConfigKeyDef, mode: LearningConfigMode | null, row: LmsLearningConfig | undefined): PublicLearningConfigValue => {
  const syllabusValue = def.syllabusValue ?? null;
  const value = row ? row.value : syllabusValue;
  return {
    key: def.key,
    label: def.label,
    group: def.group,
    type: def.type,
    unit: def.unit ?? null,
    min: def.min ?? null,
    options: def.options ? [...def.options] : null,
    length: def.length ?? null,
    kind: def.kind,
    mode,
    value,
    valueSource: value === null ? null : row ? 'CONFIGURED' : 'SYLLABUS',
    syllabusValue,
    sourceNote: def.kind === 'SYLLABUS' ? SYLLABUS_SOURCE : PRESCRIBED_SOURCE,
    toBeConfirmed: value === null,
    openQuestions: [...def.openQuestions],
    reason: row?.reason ?? null,
    updatedAt: row?.createdAt ?? null,
  };
};

const modesOf = (def: LearningConfigKeyDef): (LearningConfigMode | null)[] => (def.perMode ? [...LEARNING_CONFIG_MODES] : [null]);

/*
 * Learning configuration (L-05 learning-configuration tab, F-LMS-05-07) of one entity.
 *
 * - Syllabus keys show the value of the final syllabus documents until an authorised user changes it
 *   (OQ-012); they can be changed, not emptied.
 * - Prescribed keys have no value ('To Be Confirmed') until an authorised user sets one (OQ-013 / OQ-014 /
 *   OQ-015); no default is assumed, and they can be emptied again.
 * - Mode-specific keys hold one value per delivery mode; a write without a mode sets both alike, since
 *   which rules differ is still open (OQ-042).
 * - Every change needs a reason and is audited with key, mode, before, after and reason
 *   (config.learning.updated / config.mode_rules.updated). An unchanged value writes nothing.
 * - "Changing a key never rewrites past records": the current row is soft-deleted and a new one inserted.
 * Permission: the spec's config.learning.view / update map to the Academic Calendar menu's view / update,
 * the screen (UI-313) they share.
 */
export class LmsLearningConfigService {
  async get(entityId: string, key?: string): Promise<LearningConfigView> {
    const entity = await AppDataSource.getRepository(LmsEntity).findOne({ where: { id: entityId, isDelete: false } });
    if (!entity) throw AppError.badRequest('The selected entity does not exist', [{ field: 'entityId', message: 'Unknown entity' }]);
    const rows = await lmsCalendarRepository.currentConfig(entityId);
    const saved = new Map(rows.map((r) => [`${r.key}|${r.mode ?? ''}`, r]));
    const keys = LEARNING_CONFIG_KEYS.filter((d) => !key || d.key === key).flatMap((def) =>
      modesOf(def).map((mode) => view(def, mode, saved.get(`${def.key}|${mode ?? ''}`))),
    );
    return { entityId, keys };
  }

  async update(key: string, input: UpdateLearningConfigInput, req?: Request): Promise<LearningConfigView> {
    const def = LEARNING_CONFIG_KEY_MAP.get(key);
    if (!def) throw AppError.notFound('Unknown configuration key');
    if (input.mode && !def.perMode) {
      throw AppError.badRequest('This key does not differ by delivery mode', [{ field: 'mode', message: 'Leave the mode empty for this key.' }]);
    }
    let value: LearningConfigValue | null = null;
    if (input.value === null) {
      if (def.kind === 'SYLLABUS') throw invalid('A syllabus value can be changed but not emptied.');
    } else {
      value = parseValue(def, input.value);
    }
    const modes = input.mode ? [input.mode] : modesOf(def);

    await AppDataSource.transaction(async (m) => {
      /* FOR UPDATE: serialises the configuration writes of one entity (one current row per key and mode). */
      await assertUsableRef(m, LmsEntity, input.entityId, 'entityId', 'entity', 'pessimistic_write');
      const repo = m.getRepository(LmsLearningConfig);
      for (const mode of modes) {
        const current = await repo.findOne({ where: { entityId: input.entityId, key, mode: mode ?? IsNull(), isDelete: false } });
        const before = current ? current.value : (def.syllabusValue ?? null);
        if (sameValue(before, value)) continue;
        if (current) await repo.update({ id: current.id }, { isDelete: true, isActive: false });
        const row = await repo.save(repo.create({ entityId: input.entityId, key, mode, value, reason: input.reason }));
        await auditService.recordInTx(m, req, {
          action: AUDIT_ACTIONS.LMS_LEARNING_CONFIG_UPDATE,
          resource: 'lms-learning-config',
          resourceId: row.id,
          details: { entityId: input.entityId, key, mode, before, after: value, reason: input.reason },
        });
      }
    });
    return this.get(input.entityId, key);
  }
}

export const lmsLearningConfigService = new LmsLearningConfigService();
