import type { Request } from 'express';
import type { EntityManager } from 'typeorm';
import { AppDataSource } from '../../config/database.config';
import { auditService } from '../audit';
import { PanelSetting } from '../lms-reads';
import { isSuperRole } from './ipp-access';
import { HEAD_OFFICE_KEY, HEAD_OFFICE_LOCK_KEY, IPP_AUDIT, LEVEL_ROLES, SWITCH_ROLE } from './ipp-approvals.constants';
import { kickIppLink } from './ipp-outbox.runtime';

/*
 * The switch "Head Office approval" (panel_settings `ipp.head_office_approval`, no row = on): on, the Head Officer gives
 * the final approval; off, the Super Admin does. Changing it moves everything waiting at the other final stage in the
 * same transaction (event MOVED, decision MOVE to IPP), so no form is ever left at a stage nobody decides.
 */
export interface HeadOfficeState {
  enabled: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
}

class IppHeadOfficeService {
  async isEnabled(m: EntityManager = AppDataSource.manager): Promise<boolean> {
    /* A query of its own (not a repository find): with a read replica this must be the main database. */
    const [row] = (await m.query(`SELECT "value" FROM "panel_settings" WHERE "key" = $1`, [HEAD_OFFICE_KEY])) as {
      value: { enabled?: unknown };
    }[];
    return row?.value?.enabled !== false;
  }

  /* Holds the switch as it is until the transaction ends (decisions run side by side, a change of the switch waits for them). */
  async holdAndRead(m: EntityManager): Promise<boolean> {
    await m.query(`SELECT pg_advisory_xact_lock_shared($1)`, [HEAD_OFFICE_LOCK_KEY]);
    return this.isEnabled(m);
  }

  async state(): Promise<HeadOfficeState> {
    const [row] = (await AppDataSource.query(
      `SELECT s."value", s."updatedAt", u."name" FROM "panel_settings" s LEFT JOIN "users" u ON u."id" = s."updatedByUserId" WHERE s."key" = $1`,
      [HEAD_OFFICE_KEY],
    )) as { value: { enabled?: unknown }; updatedAt: Date; name: string | null }[];
    return { enabled: row?.value?.enabled !== false, updatedAt: row ? row.updatedAt.toISOString() : null, updatedBy: row?.name ?? null };
  }

  async set(req: Request, enabled: boolean): Promise<HeadOfficeState & { moved: number }> {
    const auth = req.auth!;
    const moved = await AppDataSource.transaction(async (m) => {
      await m.query(`SELECT pg_advisory_xact_lock($1)`, [HEAD_OFFICE_LOCK_KEY]);
      const before = await this.isEnabled(m);
      if (before === enabled) return 0;
      await m.getRepository(PanelSetting).upsert({ key: HEAD_OFFICE_KEY, value: { enabled }, updatedByUserId: auth.id }, ['key']);
      const role = isSuperRole(auth.roleCodes) ? LEVEL_ROLES.SUPER_ADMIN : SWITCH_ROLE;
      const n = await this.moveWaiting(m, enabled, { id: auth.id, name: auth.name, role });
      await auditService.recordInTx(m, req, {
        action: IPP_AUDIT.HEAD_OFFICE,
        resource: 'panel_setting',
        resourceId: HEAD_OFFICE_KEY,
        details: { from: before, to: enabled, moved: n },
      });
      return n;
    });
    if (moved) kickIppLink();
    return { ...(await this.state()), moved };
  }

  private async moveWaiting(m: EntityManager, headOffice: boolean, by: { id: string; name: string; role: string }): Promise<number> {
    const [from, to] = headOffice ? ['SUPER_ADMIN', 'HEAD_OFFICE'] : ['HEAD_OFFICE', 'SUPER_ADMIN'];
    /* In id order, like every other lock on applications. */
    const waiting: { id: string }[] = await m.query(`SELECT "id" FROM "ipp_applications" WHERE "stage" = $1 ORDER BY "id" FOR UPDATE`, [
      from,
    ]);
    if (!waiting.length) return 0;
    const ids = waiting.map((w) => w.id);
    await m.query(
      `UPDATE "ipp_applications" SET "stage" = $2, "stageEvent" = 'MOVED', "stageUpdatedAt" = clock_timestamp() WHERE "id" = ANY($1::uuid[])`,
      [ids, to],
    );
    await m.query(
      `INSERT INTO "ipp_approval_events" ("applicationId", "event", "fromStage", "toStage", "byUserId", "byName", "byRole", "at")
       SELECT t."id", 'MOVED', $2::varchar, $3::varchar, $4::uuid, $5::varchar, $6::varchar, clock_timestamp() FROM unnest($1::uuid[]) WITH ORDINALITY AS t("id", "n") ORDER BY t."n"`,
      [ids, from, to, by.id, by.name, by.role],
    );
    await m.query(
      `INSERT INTO "ipp_decisions" ("applicationId", "action", "fromStage", "toStage", "byName", "byRole", "decidedAt")
       SELECT t."id", 'MOVE', $2::varchar, $3::varchar, $4::varchar, $5::varchar, clock_timestamp() FROM unnest($1::uuid[]) WITH ORDINALITY AS t("id", "n") ORDER BY t."n"`,
      [ids, from, to, by.name, by.role],
    );
    return ids.length;
  }
}

export const ippHeadOfficeService = new IppHeadOfficeService();
