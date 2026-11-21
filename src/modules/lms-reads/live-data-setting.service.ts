import type { Request } from 'express';
import { AppDataSource } from '../../config/database.config';
import { env } from '../../config/env.config';
import { LMS_SYNC_REQUIRED } from '../../config/lms-link-config';
import { HTTP_STATUS } from '../../constants/api-response.constants';
import { AppError } from '../../shared/errors/app-error';
import { auditService } from '../audit';
import { PanelSetting } from './panel-setting.entity';

/*
 * G-2 "Show live LMS data" (docs/mt-g2-live-data-setting.md).
 *
 * Two switches, both needed for live data:
 * - LMS_READS_ENABLED (env): the server-side master switch, set by whoever runs the server. While it is off the
 *   setting cannot turn live reads on, and the /lms-reads data routes answer exactly as before (404 LMS_READS_DISABLED).
 * - The Panel setting `lms.live_data` (database, default off), switched by an administrator (settings.update) on the
 *   System Settings screen. Every change is audited.
 * The setting can only be switched on while the master switch is on and the LMS link is configured (LMS API host,
 * tenant key and tenant code entered). Switching it off is always allowed.
 *
 * Off (the default): the screens keep their current local data and the live routes refuse with 404 LMS_LIVE_DATA_OFF.
 * On: the screens read live through /api/v1/lms-reads/*.
 */
export const LIVE_DATA_KEY = 'lms.live_data';
export const LIVE_DATA_OFF = 'LMS_LIVE_DATA_OFF';
export const LIVE_DATA_UNAVAILABLE = 'LMS_LIVE_DATA_UNAVAILABLE';
export const LIVE_DATA_AUDIT_ACTION = 'lms.live_data.update';

/* Why the switch cannot be turned on (null = it can). */
export type LiveDataBlocker = 'MASTER_SWITCH_OFF' | 'LMS_NOT_CONFIGURED';

export interface LiveDataState {
  /* What an administrator chose (stored; default false). */
  setting: boolean;
  /* LMS_READS_ENABLED. */
  masterSwitch: boolean;
  /* LMS API host, tenant key and tenant code are all entered (never says which values). */
  configured: boolean;
  /* The switch may be turned on now. */
  canEnable: boolean;
  blocker: LiveDataBlocker | null;
  /* Names of the missing link values (variable names only, never values). */
  missing: string[];
  /* The screens show live data: setting && masterSwitch && configured. */
  live: boolean;
  source: 'live' | 'local';
  updatedAt: string | null;
  updatedByUserId: string | null;
}

const repo = () => AppDataSource.getRepository(PanelSetting);

function linkMissing(): string[] {
  return LMS_SYNC_REQUIRED.filter((k) => !env[k]);
}

function stateOf(row: PanelSetting | null): LiveDataState {
  const setting = row?.value?.enabled === true;
  const masterSwitch = env.LMS_READS_ENABLED;
  const missing = linkMissing();
  const configured = missing.length === 0;
  const blocker: LiveDataBlocker | null = !masterSwitch ? 'MASTER_SWITCH_OFF' : !configured ? 'LMS_NOT_CONFIGURED' : null;
  const live = setting && masterSwitch && configured;
  return {
    setting,
    masterSwitch,
    configured,
    canEnable: blocker === null,
    blocker,
    missing,
    live,
    source: live ? 'live' : 'local',
    updatedAt: row ? row.updatedAt.toISOString() : null,
    updatedByUserId: row?.updatedByUserId ?? null,
  };
}

export class LiveDataSettingService {
  async state(): Promise<LiveDataState> {
    return stateOf(await repo().findOneBy({ key: LIVE_DATA_KEY }));
  }

  /* The stored choice only (one primary-key read); used by the live-route gate. */
  async isOn(): Promise<boolean> {
    const row = await repo().findOneBy({ key: LIVE_DATA_KEY });
    return row?.value?.enabled === true;
  }

  async set(req: Request, enabled: boolean): Promise<LiveDataState> {
    const before = await this.state();
    if (enabled && !before.canEnable) {
      throw new AppError(
        HTTP_STATUS.CONFLICT,
        before.blocker === 'MASTER_SWITCH_OFF'
          ? 'Live LMS data cannot be switched on: the server master switch LMS_READS_ENABLED is off'
          : 'Live LMS data cannot be switched on: the LMS link is not configured',
        LIVE_DATA_UNAVAILABLE,
        [{ field: 'blocker', message: before.blocker ?? '' }, ...before.missing.map((m) => ({ field: 'missing', message: m }))],
      );
    }
    if (before.setting === enabled) return before;
    await AppDataSource.transaction(async (m) => {
      await m
        .getRepository(PanelSetting)
        .upsert({ key: LIVE_DATA_KEY, value: { enabled }, updatedByUserId: req.auth?.id ?? null }, ['key']);
      await auditService.recordInTx(m, req, {
        action: LIVE_DATA_AUDIT_ACTION,
        resource: 'panel_setting',
        resourceId: LIVE_DATA_KEY,
        details: { from: before.setting, to: enabled },
      });
    });
    return this.state();
  }
}

export const liveDataSettingService = new LiveDataSettingService();
