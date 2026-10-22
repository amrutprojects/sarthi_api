import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { AppBaseEntity } from '../../database/base.entity';
import type { LmsEntity } from '../entity/entity.model';

/*
 * One branding value or setting of an LMS entity (AMRUT_KALASH_03 L-04 / FR-304, form F-LMS-04 Table 29;
 * DB-302 "entity_setting"): the spec's entity_setting(<key>) as a typed key-value row.
 *
 * - key is one of BRANDING_KEYS (branding.constants.ts); value is the JSON of its declared type, validated
 *   by the server before it is written. NULL = reset to the default (entity name, default language or the
 *   platform default), so a key that was set once keeps its row and its history stays in the audit log.
 * - One non-deleted row per (entity, key). Settings are the entity's own configuration (DB-302 keeps them
 *   on lms_entity): archiving the entity keeps them, restoring it brings them back.
 * - Status: "Not applicable (settings are versioned by audit)" (L-04), so isActive is not used.
 */
@Entity({ name: 'lms_entity_settings' })
export class LmsEntitySetting extends AppBaseEntity {
  @Column({ type: 'uuid', name: 'entityId' })
  entityId!: string;

  @Column({ type: 'varchar', length: 64 })
  key!: string;

  @Column({ type: 'jsonb', nullable: true })
  value!: unknown;

  @ManyToOne('LmsEntity', { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'entityId' })
  entity!: LmsEntity;
}
