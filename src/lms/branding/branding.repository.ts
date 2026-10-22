import type { EntityManager } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { BaseRepository } from '../../database/base.repository';
import { LmsEntitySetting } from './branding.model';

export class LmsEntitySettingRepository extends BaseRepository<LmsEntitySetting> {
  constructor() {
    super(LmsEntitySetting);
  }

  /* The non-deleted setting rows of one entity, by key. */
  async forEntity(entityId: string, m?: EntityManager): Promise<Map<string, LmsEntitySetting>> {
    const rows = await this.findMany({ entityId }, { manager: m });
    return new Map(rows.map((r) => [r.key, r]));
  }

  /*
   * Writes one key's value: updates its row, or inserts the first one. The caller holds the entity row
   * FOR UPDATE, so two writers never both insert the same key (UQ_lms_entity_settings_key_active).
   */
  async write(entityId: string, key: string, value: unknown, existing: LmsEntitySetting | undefined, m: EntityManager): Promise<void> {
    /* jsonb: TypeORM serialises the value with JSON.stringify; null is stored as SQL NULL. */
    const repo = m.getRepository(LmsEntitySetting);
    if (existing) await repo.update({ id: existing.id }, { value } as QueryDeepPartialEntity<LmsEntitySetting>);
    else await repo.insert({ entityId, key, value } as QueryDeepPartialEntity<LmsEntitySetting>);
  }
}

export const lmsEntitySettingRepository = new LmsEntitySettingRepository();
