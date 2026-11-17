import type { Request } from 'express';
import { appConfig } from '../../../config/app.config';
import { AppDataSource } from '../../../config/database.config';
import { logger } from '../../../observability/logger';
import { auditService } from '../../audit';
import { EDP_HELP_FIELDS } from './edp.constants';
import type { EdpAdmin } from './edp.entities';
import type { HelpBody, SupportBody, WelcomeBody } from './edp.validation';

/* The standard contact line; {email} and {mobile} are replaced with the contact details. */
export const DEFAULT_SUPPORT_MESSAGE =
  'If you have any query related to your registration, you can contact us on email ID {email} or mobile number {mobile}.';

export interface SupportContact {
  message: string;
  email: string | null;
  mobile: string | null;
}

/* The congratulations dialog the portal shows once the mobile OTP is verified and the account has been created. */
export interface WelcomeMessage {
  enabled: boolean;
  title: string;
  message: string;
  /* Blank: the portal uses its own button text, in the language the student chose. */
  button_label: string;
}

/* One line of the Help button: a name and its value. An email address or a phone number is shown as a link. */
export interface HelpField {
  label: string;
  value: string;
}

/* The Help button in the portal's bottom-right corner: up to EDP_HELP_FIELDS name / value lines. */
export interface HelpContact {
  enabled: boolean;
  title: string;
  intro: string;
  fields: HelpField[];
}

export const DEFAULT_WELCOME: WelcomeMessage = {
  enabled: true,
  title: 'Congratulations! Your account is created',
  message:
    'Your mobile number is verified and your Entrepreneurship Development Program account is ready. Fill in the form in three steps, upload your documents and submit it — you can see your application any time.',
  button_label: '',
};

export const DEFAULT_HELP_TITLE = 'Need help?';

const str = (v: unknown, fallback = '') => (typeof v === 'string' ? v : fallback);
/* A value saved before the flag existed counts as enabled. */
const flag = (v: unknown) => v !== false;

/* Without a saved value: the standard message and EDP_SUPPORT_EMAIL / EDP_SUPPORT_MOBILE. */
const envSupport = (): SupportContact => ({ message: DEFAULT_SUPPORT_MESSAGE, ...appConfig.edp.support });

/* Without a saved value: the standard heading and whichever of EDP_SUPPORT_MOBILE / EDP_SUPPORT_EMAIL is configured. */
const envHelp = (): HelpContact => ({
  enabled: true,
  title: DEFAULT_HELP_TITLE,
  intro: 'For any query about your registration, you can contact the programme office.',
  fields: [
    { label: 'Contact Number', value: appConfig.edp.support.mobile ?? '' },
    { label: 'Email ID', value: appConfig.edp.support.email ?? '' },
  ].filter((f) => f.value),
});

/* A saved row is jsonb and may predate a field: read it defensively, never trusting its shape. */
const asSupport = (v: Partial<SupportContact>): SupportContact => ({
  message: str(v?.message),
  email: v?.email ?? null,
  mobile: v?.mobile ?? null,
});
const asWelcome = (v: Partial<WelcomeMessage>): WelcomeMessage => ({
  enabled: flag(v?.enabled),
  title: str(v?.title, DEFAULT_WELCOME.title),
  message: str(v?.message, DEFAULT_WELCOME.message),
  button_label: str(v?.button_label),
});
const asHelp = (v: Partial<HelpContact>): HelpContact => ({
  enabled: flag(v?.enabled),
  title: str(v?.title, DEFAULT_HELP_TITLE),
  intro: str(v?.intro),
  fields: (Array.isArray(v?.fields) ? v.fields : [])
    .map((f: Partial<HelpField>) => ({ label: str(f?.label).trim(), value: str(f?.value).trim() }))
    .filter((f) => f.label && f.value)
    .slice(0, EDP_HELP_FIELDS),
});

/*
 * Reads one settings row. Never fails: if the settings cannot be read (e.g. the database is briefly unavailable), the
 * defaults are used, so an OTP email is still sent and the portal's options still load.
 */
async function read<T, S>(key: string, shape: (value: S) => T, fallback: () => T): Promise<T> {
  try {
    const [row]: { value: S }[] = await AppDataSource.query(`SELECT "value" FROM "edp_settings" WHERE "key" = $1`, [key]);
    return row ? shape(row.value) : fallback();
  } catch (err) {
    logger.warn({ err, key }, 'EDP setting could not be read; using the defaults');
    return fallback();
  }
}

/* When the row was last saved and by whom; no row = the defaults are in use. */
async function meta(key: string) {
  const [row]: { updatedAt: Date; byName: string | null }[] = await AppDataSource.query(
    `SELECT s."updatedAt", a."name" AS "byName" FROM "edp_settings" s LEFT JOIN "edp_admins" a ON a."id" = s."updatedById" WHERE s."key" = $1`,
    [key],
  );
  return { updated_at: row?.updatedAt ?? null, updated_by: row?.byName ?? null };
}

/* Saves one settings row (an ADMIN action) and records who saved it. */
async function write(req: Request, admin: EdpAdmin, key: string, value: unknown) {
  await AppDataSource.query(
    `INSERT INTO "edp_settings" ("key", "value", "updatedAt", "updatedById") VALUES ($1, $2::jsonb, now(), $3)
     ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "updatedAt" = now(), "updatedById" = EXCLUDED."updatedById"`,
    [key, JSON.stringify(value), admin.id],
  );
  await auditService.record(req, {
    action: `edp.settings.${key}`,
    resource: 'edp_settings',
    resourceId: key,
    actorUserId: null,
    details: { byEdpAdminId: admin.id },
  });
}

/*
 * Settings the EDP tracking panel edits (edp_settings, one row per key); all three go to the portal with GET
 * /edp/options. "support": the contact line students see after submitting and in the portal's emails. "welcome": the
 * congratulations dialog shown once the account is created. "help": the Help button's contact details. Each is read by
 * every tracking panel user and saved by an ADMIN (see edp.routes.ts).
 */
export const edpSettingsService = {
  /* The contact line as saved, else the defaults. */
  support: () => read('support', asSupport, envSupport),
  /* The tracking panel's view: the contact line, and who saved it when (null = the defaults are in use). */
  async supportForAdmin() {
    return { ...(await this.support()), ...(await meta('support')) };
  },
  /* Saves the contact line (an ADMIN's action). */
  async saveSupport(req: Request, admin: EdpAdmin, body: SupportBody) {
    const value: SupportContact = { message: body.message, email: body.email ?? null, mobile: body.mobile ?? null };
    await write(req, admin, 'support', value);
    return this.supportForAdmin();
  },

  /* The congratulations dialog as saved, else the standard text. */
  welcome: () => read('welcome', asWelcome, () => ({ ...DEFAULT_WELCOME })),
  async welcomeForAdmin() {
    return { ...(await this.welcome()), ...(await meta('welcome')) };
  },
  async saveWelcome(req: Request, admin: EdpAdmin, body: WelcomeBody) {
    const value: WelcomeMessage = { enabled: body.enabled, title: body.title, message: body.message, button_label: body.button_label };
    await write(req, admin, 'welcome', value);
    return this.welcomeForAdmin();
  },

  /* The Help button's contact details as saved, else whatever the environment configures. */
  help: () => read('help', asHelp, envHelp),
  async helpForAdmin() {
    return { ...(await this.help()), ...(await meta('help')) };
  },
  async saveHelp(req: Request, admin: EdpAdmin, body: HelpBody) {
    /* Only complete lines are kept: a row with just a name, or just a value, is nothing to show. */
    const value: HelpContact = {
      enabled: body.enabled,
      title: body.title,
      intro: body.intro,
      fields: body.fields.filter((f) => f.label && f.value).slice(0, EDP_HELP_FIELDS),
    };
    await write(req, admin, 'help', value);
    return this.helpForAdmin();
  },
};
