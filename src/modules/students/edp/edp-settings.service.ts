import type { Request } from 'express';
import { appConfig } from '../../../config/app.config';
import { AppDataSource } from '../../../config/database.config';
import { logger } from '../../../observability/logger';
import { auditService } from '../../audit';
import type { EdpAdmin } from './edp.entities';
import type { SupportBody } from './edp.validation';

/* The standard contact line; {email} and {mobile} are replaced with the contact details. */
export const DEFAULT_SUPPORT_MESSAGE =
  'If you have any query related to your registration, you can contact us on email ID {email} or mobile number {mobile}.';

export interface SupportContact {
  message: string;
  email: string | null;
  mobile: string | null;
}

/* Without a saved value: the standard message and EDP_SUPPORT_EMAIL / EDP_SUPPORT_MOBILE. */
const envSupport = (): SupportContact => ({ message: DEFAULT_SUPPORT_MESSAGE, ...appConfig.edp.support });

/*
 * Settings the EDP tracking panel edits (edp_settings, one row per key). "support": the contact line students see after
 * submitting and in the portal's emails, edited by an ADMIN.
 */
export const edpSettingsService = {
  /*
   * The contact line as saved, else the defaults. Never fails: if the settings cannot be read (e.g. the database is
   * briefly unavailable), the defaults are used, so an OTP email is still sent.
   */
  async support(): Promise<SupportContact> {
    try {
      const [row]: { value: SupportContact }[] = await AppDataSource.query(`SELECT "value" FROM "edp_settings" WHERE "key" = 'support'`);
      return row ? { message: row.value.message, email: row.value.email ?? null, mobile: row.value.mobile ?? null } : envSupport();
    } catch (err) {
      logger.warn({ err }, 'EDP support contact could not be read; using the defaults');
      return envSupport();
    }
  },

  /* The tracking panel's view: the contact line, and who saved it when (null = the defaults are in use). */
  async supportForAdmin() {
    const [row]: { updatedAt: Date; byName: string | null }[] = await AppDataSource.query(
      `SELECT s."updatedAt", a."name" AS "byName" FROM "edp_settings" s LEFT JOIN "edp_admins" a ON a."id" = s."updatedById" WHERE s."key" = 'support'`,
    );
    return { ...(await this.support()), updated_at: row?.updatedAt ?? null, updated_by: row?.byName ?? null };
  },

  /* Saves the contact line (an ADMIN's action). */
  async saveSupport(req: Request, admin: EdpAdmin, body: SupportBody) {
    const value: SupportContact = { message: body.message, email: body.email ?? null, mobile: body.mobile ?? null };
    await AppDataSource.query(
      `INSERT INTO "edp_settings" ("key", "value", "updatedAt", "updatedById") VALUES ('support', $1::jsonb, now(), $2)
       ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "updatedAt" = now(), "updatedById" = EXCLUDED."updatedById"`,
      [JSON.stringify(value), admin.id],
    );
    await auditService.record(req, {
      action: 'edp.settings.support',
      resource: 'edp_settings',
      resourceId: 'support',
      actorUserId: null,
      details: { byEdpAdminId: admin.id },
    });
    return this.supportForAdmin();
  },
};
