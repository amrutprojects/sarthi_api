import type { MigrationInterface, QueryRunner } from 'typeorm';

/*
 * CMS: "Quick Actions" — the strip of tiles under the home page hero (Apply Now, Check Application
 * Status, Verify Certificate, Training centres).
 *
 * Two tables. The tiles are a list an administrator adds to, edits, reorders, hides and deletes, one
 * row each, with no fixed number. Whether the whole strip is shown is single-valued and lives in a
 * singleton settings row, written only by the "Show on website" switch.
 *
 * A tile's title is never blank in either language. Its subtitle is optional: blank in both languages
 * (the small line is left out) or filled in both. `icon` is a name from the website's icon set, checked
 * against the list below — written out here rather than imported, so this migration stays what it was
 * when it ran even if QUICK_ACTION_ICONS changes later (a name added there needs a migration that
 * widens this CHECK). A tile's `link` lands in an href on the home page, so the CHECK admits only a
 * page of this site ('/apply', never '//host') or an absolute http(s) address — never `javascript:` or
 * `data:` — the same rule as the Top Bar links. A tile without a destination is meaningless, so the
 * column is NOT NULL.
 *
 * The settings row (shown) and the four tiles the website showed are inserted here, all active, so
 * `migration:run` alone makes the strip work and the home page stays exactly as it is today. No seed
 * is needed. Creates tables only; no existing table or row is touched.
 */
const ICONS = [
  'plus',
  'search',
  'qr',
  'building',
  'doc',
  'check',
  'clipboard',
  'award',
  'users',
  'teacher',
  'phone',
  'mail',
  'help',
  'download',
  'calendar',
  'pin',
  'map',
  'home',
  'globe',
  'megaphone',
  'bell',
  'eye',
  'rupee',
  'layers',
  'monitor',
  'chart',
  'shield',
  'folder',
  'settings',
  'play',
  'clock',
];

/* The strip as the website printed it, word for word, in order. */
const TILES = [
  {
    icon: 'plus',
    titleMr: 'आता अर्ज करा',
    titleEn: 'Apply Now',
    subtitleMr: 'नवीन नोंदणी करा',
    subtitleEn: 'Register as a new candidate',
    link: '/apply',
  },
  {
    icon: 'search',
    titleMr: 'अर्जाची स्थिती पहा',
    titleEn: 'Check Application Status',
    subtitleMr: 'अर्ज क्रमांकाने तपासा',
    subtitleEn: 'Track by application ID',
    link: '/track',
  },
  {
    icon: 'qr',
    titleMr: 'प्रमाणपत्र पडताळणी',
    titleEn: 'Verify Certificate',
    subtitleMr: 'QR किंवा क्रमांकाने',
    subtitleEn: 'By QR or certificate number',
    link: '/verify',
  },
  {
    icon: 'building',
    titleMr: 'प्रशिक्षण केंद्रे',
    titleEn: 'Training centres',
    subtitleMr: 'जवळचे केंद्र शोधा',
    subtitleEn: 'Find a centre near you',
    link: '/contact',
  },
];

export class CmsQuickActions1797300000000 implements MigrationInterface {
  name = 'CmsQuickActions1797300000000';

  public async up(q: QueryRunner): Promise<void> {
    const base = `
      "id"        uuid        NOT NULL DEFAULT gen_random_uuid(),
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now(),
      "isDelete"  boolean     NOT NULL DEFAULT false,
      "isActive"  boolean     NOT NULL DEFAULT true`;

    const pair = (table: string, name: string, col: string) =>
      `CONSTRAINT "CHK_${table}_${name}_pair" CHECK ((btrim("${col}Mr") = '') = (btrim("${col}En") = ''))`;
    const filled = (table: string, name: string, col: string) =>
      `CONSTRAINT "CHK_${table}_${name}_mr" CHECK (btrim("${col}Mr") <> ''),
       CONSTRAINT "CHK_${table}_${name}_en" CHECK (btrim("${col}En") <> '')`;
    const iconList = ICONS.map((i) => `'${i}'`).join(', ');

    await q.query(`
      CREATE TABLE "quick_action_settings" (${base},
        "showSection" boolean NOT NULL DEFAULT true,
        CONSTRAINT "PK_quick_action_settings" PRIMARY KEY ("id")
      )`);

    /* A singleton, the same way the other CMS sections are: one live configuration, ever. */
    await q.query(`CREATE UNIQUE INDEX "UQ_quick_action_settings_singleton" ON "quick_action_settings" ((true)) WHERE "isDelete" = false`);

    await q.query(`
      CREATE TABLE "quick_actions" (${base},
        "titleMr"      varchar(40)  NOT NULL,
        "titleEn"      varchar(40)  NOT NULL,
        "subtitleMr"   varchar(60)  NOT NULL DEFAULT '',
        "subtitleEn"   varchar(60)  NOT NULL DEFAULT '',
        "icon"         varchar(30)  NOT NULL,
        "link"         varchar(500) NOT NULL,
        "displayOrder" integer      NOT NULL DEFAULT 0,
        CONSTRAINT "PK_quick_actions" PRIMARY KEY ("id"),
        ${filled('quick_actions', 'title', 'title')},
        ${pair('quick_actions', 'subtitle', 'subtitle')},
        CONSTRAINT "CHK_quick_actions_icon" CHECK ("icon" IN (${iconList})),
        CONSTRAINT "CHK_quick_actions_link" CHECK (
          ("link" ~ '^/[A-Za-z0-9._~/?=&%#-]*$' AND "link" !~ '^//')
          OR "link" ~ '^https?://[^[:space:]<>"]+$'
        ),
        CONSTRAINT "CHK_quick_actions_order" CHECK ("displayOrder" >= 0)
      )`);

    for (const t of ['quick_action_settings', 'quick_actions']) {
      await q.query(`CREATE TRIGGER "TRG_${t}_updated_at" BEFORE UPDATE ON "${t}" FOR EACH ROW EXECUTE FUNCTION "set_updated_at"()`);
    }

    await q.query(`INSERT INTO "quick_action_settings" ("showSection") VALUES ($1)`, [true]);

    const columns = ['titleMr', 'titleEn', 'subtitleMr', 'subtitleEn', 'icon', 'link', 'displayOrder'];
    const rows = TILES.map((t, i) => [t.titleMr, t.titleEn, t.subtitleMr, t.subtitleEn, t.icon, t.link, i + 1]);
    const placeholders = rows.map((r, i) => `(${r.map((_, j) => `$${i * columns.length + j + 1}`).join(', ')})`).join(', ');
    await q.query(`INSERT INTO "quick_actions" (${columns.map((c) => `"${c}"`).join(', ')}) VALUES ${placeholders}`, rows.flat());
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "quick_actions"`);
    await q.query(`DROP TABLE IF EXISTS "quick_action_settings"`);
  }
}
