import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/*
 * A Panel setting changed at run time by an administrator (migration 1798700000000). No row = the default.
 * G-2 uses key `lms.live_data` with value `{ "enabled": boolean }` (live-data-setting.service.ts).
 */
@Entity({ name: 'panel_settings' })
export class PanelSetting {
  @PrimaryColumn({ type: 'varchar', length: 80 }) key!: string;
  @Column({ type: 'jsonb' }) value!: Record<string, unknown>;
  @Column({ type: 'uuid', name: 'updatedByUserId', nullable: true }) updatedByUserId!: string | null;
  @CreateDateColumn({ type: 'timestamptz', name: 'createdAt' }) createdAt!: Date;
  @UpdateDateColumn({ type: 'timestamptz', name: 'updatedAt' }) updatedAt!: Date;
}
