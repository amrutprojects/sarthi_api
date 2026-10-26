import bcrypt from 'bcrypt';
import type { DataSource } from 'typeorm';
import { appConfig } from '../../config/app.config';
import { env } from '../../config/env.config';

/*
 * The EDP tracking panel's sign-in (edp.sumago.ai/manage), from EDP_ADMIN_EMAIL and EDP_ADMIN_PASSWORD. Idempotent: an
 * existing admin with that email is left as it is (its password is never overwritten). Nothing happens when either
 * variable is unset. The password is never printed.
 */
export async function seedEdpAdmin(ds: DataSource): Promise<{ created: boolean; skipped?: string }> {
  const email = env.EDP_ADMIN_EMAIL?.trim().toLowerCase();
  const password = env.EDP_ADMIN_PASSWORD;
  if (!email || !password) return { created: false, skipped: 'EDP_ADMIN_EMAIL / EDP_ADMIN_PASSWORD not set' };
  const hash = await bcrypt.hash(password, appConfig.bcryptRounds);
  const rows: { id: string }[] = await ds.query(
    `INSERT INTO "edp_admins" ("name", "email", "passwordHash") VALUES ('EDP Administrator', $1, $2)
     ON CONFLICT ("email") WHERE "isDelete" = false DO NOTHING RETURNING "id"`,
    [email, hash],
  );
  return { created: rows.length > 0 };
}
