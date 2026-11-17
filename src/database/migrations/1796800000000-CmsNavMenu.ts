import type { MigrationInterface, QueryRunner } from 'typeorm';

/*
 * CMS: "Navigation Menu" — a show/hide switch for each item of the website's menu bar (the saffron bar
 * under the Brand Bar) and its Login / Register button. A hidden item is left out of the bar and the
 * mobile menu; its page still opens by its address.
 *
 * One row per item, keyed by the website's fixed menu key; the labels and links stay in the website.
 * At most one live row per key. The keys are written out here rather than imported, so this migration
 * stays what it was when it ran even if the list in the code changes later.
 *
 * The ten rows are inserted here, all shown, so `migration:run` alone makes the switch work and the
 * website's menu stays exactly as it is today. No seed is needed: an item with no row reads as shown.
 */
const KEYS = ['home', 'about', 'programme', 'advisory', 'modules', 'eligibility', 'apply', 'faq', 'contact', 'login'];

export class CmsNavMenu1796800000000 implements MigrationInterface {
  name = 'CmsNavMenu1796800000000';

  public async up(q: QueryRunner): Promise<void> {
    const keyList = KEYS.map((k) => `'${k}'`).join(', ');
    await q.query(`
      CREATE TABLE "nav_menu_items" (
        "id"            uuid        NOT NULL DEFAULT gen_random_uuid(),
        "createdAt"     timestamptz NOT NULL DEFAULT now(),
        "updatedAt"     timestamptz NOT NULL DEFAULT now(),
        "isDelete"      boolean     NOT NULL DEFAULT false,
        "isActive"      boolean     NOT NULL DEFAULT true,
        "key"           varchar(40) NOT NULL,
        "showOnWebsite" boolean     NOT NULL DEFAULT true,
        CONSTRAINT "PK_nav_menu_items" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_nav_menu_items_key" CHECK ("key" IN (${keyList}))
      )`);

    await q.query(`CREATE UNIQUE INDEX "UQ_nav_menu_items_key_active" ON "nav_menu_items" ("key") WHERE "isDelete" = false`);
    await q.query(
      `CREATE TRIGGER "TRG_nav_menu_items_updated_at" BEFORE UPDATE ON "nav_menu_items" FOR EACH ROW EXECUTE FUNCTION "set_updated_at"()`,
    );

    await q.query(`INSERT INTO "nav_menu_items" ("key") VALUES ${KEYS.map((_, i) => `($${i + 1})`).join(', ')}`, KEYS);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "nav_menu_items"`);
  }
}
