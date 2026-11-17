import type { MigrationInterface, QueryRunner } from 'typeorm';

/*
 * CMS: "Live Dashboard" — the home page's "Programme Progress – Live Dashboard" (KPI cards, district
 * map, training-modes donut and the figures beside it).
 *
 * Four tables. The settings row (a singleton) holds the texts, which parts are shown and the two
 * training-mode totals; `showSection` is written only by the "Show on website" switch. The KPI cards
 * and the side figures are lists an administrator adds to, edits, reorders, hides and deletes. The 36
 * districts are fixed rows — the website's map tiles, joined by `districtCode` — edited in place.
 *
 * Every figure is stored as entered. Optional texts are blank in both languages or filled in both.
 * A card's `link` lands in an href, so the CHECK admits only '' (no link) or a page of this site
 * ('/programme', never '//host'). The tone and status lists are written out here rather than imported,
 * so this migration stays what it was when it ran even if LIVE_DASHBOARD_TONES or
 * DISTRICT_PROGRESS_STATUSES change later (a name added there needs a migration that widens the CHECK).
 *
 * The rows below are exactly what the website showed from its bundled demo dataset when this was
 * written — produced by running the website's data module (data/index.ts, data/marathi-names.ts),
 * not typed by hand — so `migration:run` alone makes the section managed and the home page stays
 * exactly as it is today. No seed is needed. Creates tables only; no existing table or row is touched.
 */
const TONES = ['default', 'blue', 'green', 'violet'];
const STATUSES = ['NOT_STARTED', 'PLANNING', 'CENTRE_SELECTION', 'MOBILIZATION', 'TRAINING_ACTIVE', 'COMPLETED', 'ON_HOLD', 'CRITICAL'];

const SETTINGS = {
  headingMr: 'कार्यक्रम प्रगती - थेट माहितीफलक',
  headingEn: 'Programme Progress - Live Dashboard',
  subtitleMr: 'अमृत कलश अंतर्गत महाराष्ट्रातील ३६ जिल्ह्यांमधील प्रशिक्षण प्रगतीचा सार्वजनिक आढावा.',
  subtitleEn: 'Public view of AMRUT Kalash training progress across all 36 districts of Maharashtra.',
  disclaimerMr: 'प्रात्यक्षिक आवृत्ती - नमुना माहिती. ही वास्तविक शासकीय आकडेवारी नाही.',
  disclaimerEn: 'DEMO ENVIRONMENT - SAMPLE DATA. Not actual government programme performance.',
  mapTitleMr: 'जिल्हानिहाय प्रगती — महाराष्ट्र',
  mapTitleEn: 'District-wise progress — Maharashtra',
  modesTitleMr: 'प्रशिक्षण पद्धती',
  modesTitleEn: 'Training modes',
  offlineLabelMr: 'ऑफलाइन (केंद्र)',
  offlineLabelEn: 'Offline (centre)',
  onlineLabelMr: 'ऑनलाइन (केंद्रीय)',
  onlineLabelEn: 'Online (central)',
  offlineCount: 800,
  onlineCount: 200,
  donutCenterLabelMr: 'प्रवेशित',
  donutCenterLabelEn: 'Enrolled',
};

/* The eight KPI cards as printed, in order: [labelMr, labelEn, value, detailMr, detailEn, link, tone]. */
const CARDS: [string, string, string, string, string, string, string][] = [
  ['एकूण लक्ष्य', 'Total target', '2,000', 'विद्यार्थी', 'students', '/programme', 'blue'],
  ['प्राप्त अर्ज', 'Applications', '1,245', 'नोंदणी झालेली', 'registrations received', '/track', 'default'],
  ['पात्र उमेदवार', 'Eligible', '1,080', '87% अर्जांपैकी', '87% of applications', '/eligibility', 'blue'],
  ['प्रवेशित', 'Enrolled', '1,000', '100% लक्ष्यापैकी', '100% of target', '/programme', 'green'],
  ['प्रशिक्षण सुरू', 'Training active', '760', '600 ऑफलाइन · 160 ऑनलाइन', '600 offline · 160 online', '/verify', 'default'],
  ['प्रशिक्षण पूर्ण', 'Completed', '240', '24% पूर्णत्व दर', '24% completion rate', '/verify', 'green'],
  ['मूल्यमापन झालेले', 'Assessed', '180', '92% उत्तीर्ण दर', '92% pass rate', '/verify', 'violet'],
  ['प्रमाणित', 'Certified', '165', 'प्रमाणपत्रे दिली', 'certificates issued', '/verify', 'green'],
];

/* The five figures beside the donut, in order: [labelMr, labelEn, value]. */
const STATS: [string, string, string][] = [
  ['मंजूर प्रशिक्षण केंद्रे', 'Approved centres', '10'],
  ['कार्यरत बॅचेस', 'Active batches', '15'],
  ['प्रशिक्षक', 'Trainers', '12'],
  ['सरासरी उपस्थिती', 'Average attendance', '78%'],
  ['प्रगतीपथावरील जिल्हे', 'Districts on track', '21 / 36'],
];

/*
 * The 36 districts in the website's dataset order:
 * [code, nameMr, nameEn, status, target, enrolled, trainingActive, completed, certified, attendancePct].
 */
const DISTRICTS: [string, string, string, string, number, number, number, number, number, number][] = [
  ['NDB', 'नंदुरबार', 'Nandurbar', 'TRAINING_ACTIVE', 8, 11, 0, 11, 11, 88],
  ['DHU', 'धुळे', 'Dhule', 'TRAINING_ACTIVE', 8, 9, 0, 9, 9, 89],
  ['JAL', 'जळगाव', 'Jalgaon', 'MOBILIZATION', 80, 80, 80, 0, 0, 78],
  ['BUL', 'बुलढाणा', 'Buldhana', 'CENTRE_SELECTION', 8, 5, 0, 5, 5, 90],
  ['AKO', 'अकोला', 'Akola', 'TRAINING_ACTIVE', 8, 9, 0, 9, 2, 78],
  ['AMR', 'अमरावती', 'Amravati', 'TRAINING_ACTIVE', 8, 12, 6, 6, 0, 80],
  ['NAG', 'नागपूर', 'Nagpur', 'MOBILIZATION', 8, 7, 7, 0, 0, 72],
  ['BHA', 'भंडारा', 'Bhandara', 'TRAINING_ACTIVE', 8, 10, 10, 0, 0, 77],
  ['GON', 'गोंदिया', 'Gondia', 'TRAINING_ACTIVE', 8, 9, 9, 0, 0, 77],
  ['PAL', 'पालघर', 'Palghar', 'CENTRE_SELECTION', 8, 4, 4, 0, 0, 66],
  ['NAS', 'नाशिक', 'Nashik', 'TRAINING_ACTIVE', 80, 80, 0, 80, 55, 85],
  ['WAS', 'वाशिम', 'Washim', 'TRAINING_ACTIVE', 8, 11, 11, 0, 0, 79],
  ['YAV', 'यवतमाळ', 'Yavatmal', 'TRAINING_ACTIVE', 8, 8, 8, 0, 0, 78],
  ['WAR', 'वर्धा', 'Wardha', 'TRAINING_ACTIVE', 8, 9, 9, 0, 0, 76],
  ['CHA', 'चंद्रपूर', 'Chandrapur', 'MOBILIZATION', 8, 6, 6, 0, 0, 71],
  ['GAD', 'गडचिरोली', 'Gadchiroli', 'ON_HOLD', 8, 9, 9, 0, 0, 80],
  ['MUS', 'मुंबई उपनगर', 'Mumbai Suburban', 'TRAINING_ACTIVE', 8, 8, 8, 0, 0, 70],
  ['THA', 'ठाणे', 'Thane', 'TRAINING_ACTIVE', 80, 80, 40, 40, 27, 82],
  ['CSN', 'छत्रपती संभाजीनगर', 'Chhatrapati Sambhajinagar', 'MOBILIZATION', 80, 80, 80, 0, 0, 74],
  ['JLN', 'जालना', 'Jalna', 'MOBILIZATION', 8, 6, 6, 0, 0, 78],
  ['HIN', 'हिंगोली', 'Hingoli', 'TRAINING_ACTIVE', 8, 10, 10, 0, 0, 81],
  ['PAR', 'परभणी', 'Parbhani', 'CENTRE_SELECTION', 8, 4, 4, 0, 0, 68],
  ['NAN', 'नांदेड', 'Nanded', 'CRITICAL', 80, 80, 80, 0, 0, 75],
  ['MUC', 'मुंबई शहर', 'Mumbai City', 'TRAINING_ACTIVE', 7, 7, 7, 0, 0, 71],
  ['RAI', 'रायगड', 'Raigad', 'TRAINING_ACTIVE', 7, 8, 8, 0, 0, 75],
  ['PUN', 'पुणे', 'Pune', 'TRAINING_ACTIVE', 80, 80, 0, 80, 56, 86],
  ['AHL', 'अहिल्यानगर', 'Ahilyanagar', 'MOBILIZATION', 80, 80, 80, 0, 0, 75],
  ['BEE', 'बीड', 'Beed', 'CRITICAL', 80, 80, 80, 0, 0, 75],
  ['LAT', 'लातूर', 'Latur', 'MOBILIZATION', 7, 6, 6, 0, 0, 0],
  ['DHA', 'धाराशिव', 'Dharashiv', 'TRAINING_ACTIVE', 7, 7, 7, 0, 0, 0],
  ['RAT', 'रत्नागिरी', 'Ratnagiri', 'CENTRE_SELECTION', 7, 4, 4, 0, 0, 0],
  ['SAT', 'सातारा', 'Satara', 'TRAINING_ACTIVE', 80, 80, 80, 0, 0, 75],
  ['SOL', 'सोलापूर', 'Solapur', 'TRAINING_ACTIVE', 7, 9, 9, 0, 0, 0],
  ['SIN', 'सिंधुदुर्ग', 'Sindhudurg', 'TRAINING_ACTIVE', 7, 7, 7, 0, 0, 0],
  ['KOL', 'कोल्हापूर', 'Kolhapur', 'TRAINING_ACTIVE', 80, 80, 80, 0, 0, 73],
  ['SAN', 'सांगली', 'Sangli', 'MOBILIZATION', 7, 5, 5, 0, 0, 0],
];

export class CmsLiveDashboard1797600000000 implements MigrationInterface {
  name = 'CmsLiveDashboard1797600000000';

  public async up(q: QueryRunner): Promise<void> {
    const base = `
      "id"        uuid        NOT NULL DEFAULT gen_random_uuid(),
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now(),
      "isDelete"  boolean     NOT NULL DEFAULT false,
      "isActive"  boolean     NOT NULL DEFAULT true`;

    const pair = (table: string, col: string) =>
      `CONSTRAINT "CHK_${table}_${col}_pair" CHECK ((btrim("${col}Mr") = '') = (btrim("${col}En") = ''))`;
    const filled = (table: string, col: string) =>
      `CONSTRAINT "CHK_${table}_${col}_mr" CHECK (btrim("${col}Mr") <> ''),
       CONSTRAINT "CHK_${table}_${col}_en" CHECK (btrim("${col}En") <> '')`;
    const nonNegative = (table: string, cols: string[]) =>
      cols.map((c) => `CONSTRAINT "CHK_${table}_${c}" CHECK ("${c}" >= 0)`).join(',\n        ');
    const list = (values: string[]) => values.map((v) => `'${v}'`).join(', ');

    await q.query(`
      CREATE TABLE "live_dashboard_settings" (${base},
        "headingMr"          varchar(150) NOT NULL,
        "headingEn"          varchar(150) NOT NULL,
        "subtitleMr"         varchar(300) NOT NULL DEFAULT '',
        "subtitleEn"         varchar(300) NOT NULL DEFAULT '',
        "showSection"        boolean      NOT NULL DEFAULT true,
        "disclaimerMr"       varchar(300) NOT NULL DEFAULT '',
        "disclaimerEn"       varchar(300) NOT NULL DEFAULT '',
        "showDisclaimer"     boolean      NOT NULL DEFAULT true,
        "mapTitleMr"         varchar(120) NOT NULL,
        "mapTitleEn"         varchar(120) NOT NULL,
        "showMap"            boolean      NOT NULL DEFAULT true,
        "modesTitleMr"       varchar(120) NOT NULL,
        "modesTitleEn"       varchar(120) NOT NULL,
        "showModes"          boolean      NOT NULL DEFAULT true,
        "offlineLabelMr"     varchar(60)  NOT NULL,
        "offlineLabelEn"     varchar(60)  NOT NULL,
        "onlineLabelMr"      varchar(60)  NOT NULL,
        "onlineLabelEn"      varchar(60)  NOT NULL,
        "offlineCount"       integer      NOT NULL DEFAULT 0,
        "onlineCount"        integer      NOT NULL DEFAULT 0,
        "donutCenterLabelMr" varchar(40)  NOT NULL,
        "donutCenterLabelEn" varchar(40)  NOT NULL,
        CONSTRAINT "PK_live_dashboard_settings" PRIMARY KEY ("id"),
        ${filled('live_dashboard_settings', 'heading')},
        ${pair('live_dashboard_settings', 'subtitle')},
        ${pair('live_dashboard_settings', 'disclaimer')},
        ${filled('live_dashboard_settings', 'mapTitle')},
        ${filled('live_dashboard_settings', 'modesTitle')},
        ${filled('live_dashboard_settings', 'offlineLabel')},
        ${filled('live_dashboard_settings', 'onlineLabel')},
        ${filled('live_dashboard_settings', 'donutCenterLabel')},
        ${nonNegative('live_dashboard_settings', ['offlineCount', 'onlineCount'])}
      )`);

    /* A singleton, the same way the other CMS sections are: one live configuration, ever. */
    await q.query(
      `CREATE UNIQUE INDEX "UQ_live_dashboard_settings_singleton" ON "live_dashboard_settings" ((true)) WHERE "isDelete" = false`,
    );

    await q.query(`
      CREATE TABLE "live_dashboard_cards" (${base},
        "labelMr"      varchar(60)  NOT NULL,
        "labelEn"      varchar(60)  NOT NULL,
        "value"        varchar(20)  NOT NULL,
        "detailMr"     varchar(120) NOT NULL DEFAULT '',
        "detailEn"     varchar(120) NOT NULL DEFAULT '',
        "link"         varchar(200) NOT NULL DEFAULT '',
        "tone"         varchar(10)  NOT NULL DEFAULT 'default',
        "displayOrder" integer      NOT NULL DEFAULT 0,
        CONSTRAINT "PK_live_dashboard_cards" PRIMARY KEY ("id"),
        ${filled('live_dashboard_cards', 'label')},
        CONSTRAINT "CHK_live_dashboard_cards_value" CHECK (btrim("value") <> ''),
        ${pair('live_dashboard_cards', 'detail')},
        CONSTRAINT "CHK_live_dashboard_cards_link" CHECK ("link" = '' OR ("link" ~ '^/[A-Za-z0-9._~/?=&%#-]*$' AND "link" !~ '^//')),
        CONSTRAINT "CHK_live_dashboard_cards_tone" CHECK ("tone" IN (${list(TONES)})),
        ${nonNegative('live_dashboard_cards', ['displayOrder'])}
      )`);

    await q.query(`
      CREATE TABLE "live_dashboard_stats" (${base},
        "labelMr"      varchar(80) NOT NULL,
        "labelEn"      varchar(80) NOT NULL,
        "value"        varchar(30) NOT NULL,
        "displayOrder" integer     NOT NULL DEFAULT 0,
        CONSTRAINT "PK_live_dashboard_stats" PRIMARY KEY ("id"),
        ${filled('live_dashboard_stats', 'label')},
        CONSTRAINT "CHK_live_dashboard_stats_value" CHECK (btrim("value") <> ''),
        ${nonNegative('live_dashboard_stats', ['displayOrder'])}
      )`);

    await q.query(`
      CREATE TABLE "live_dashboard_districts" (${base},
        "districtCode"   varchar(3)  NOT NULL,
        "nameMr"         varchar(60) NOT NULL,
        "nameEn"         varchar(60) NOT NULL,
        "status"         varchar(20) NOT NULL,
        "target"         integer     NOT NULL DEFAULT 0,
        "enrolled"       integer     NOT NULL DEFAULT 0,
        "trainingActive" integer     NOT NULL DEFAULT 0,
        "completed"      integer     NOT NULL DEFAULT 0,
        "certified"      integer     NOT NULL DEFAULT 0,
        "attendancePct"  integer     NOT NULL DEFAULT 0,
        "displayOrder"   integer     NOT NULL DEFAULT 0,
        CONSTRAINT "PK_live_dashboard_districts" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_live_dashboard_districts_code" CHECK ("districtCode" ~ '^[A-Z]{3}$'),
        ${filled('live_dashboard_districts', 'name')},
        CONSTRAINT "CHK_live_dashboard_districts_status" CHECK ("status" IN (${list(STATUSES)})),
        ${nonNegative('live_dashboard_districts', ['target', 'enrolled', 'trainingActive', 'completed', 'certified', 'displayOrder'])},
        CONSTRAINT "CHK_live_dashboard_districts_attendance" CHECK ("attendancePct" BETWEEN 0 AND 100)
      )`);

    /* One live row per district: the website joins its map tiles on the code. */
    await q.query(
      `CREATE UNIQUE INDEX "UQ_live_dashboard_districts_code" ON "live_dashboard_districts" ("districtCode") WHERE "isDelete" = false`,
    );

    for (const t of ['live_dashboard_settings', 'live_dashboard_cards', 'live_dashboard_stats', 'live_dashboard_districts']) {
      await q.query(`CREATE TRIGGER "TRG_${t}_updated_at" BEFORE UPDATE ON "${t}" FOR EACH ROW EXECUTE FUNCTION "set_updated_at"()`);
    }

    const insert = async (table: string, columns: string[], rows: unknown[][]) => {
      const placeholders = rows.map((r, i) => `(${r.map((_, j) => `$${i * columns.length + j + 1}`).join(', ')})`).join(', ');
      await q.query(`INSERT INTO "${table}" (${columns.map((c) => `"${c}"`).join(', ')}) VALUES ${placeholders}`, rows.flat());
    };

    await insert('live_dashboard_settings', Object.keys(SETTINGS), [Object.values(SETTINGS)]);
    await insert(
      'live_dashboard_cards',
      ['labelMr', 'labelEn', 'value', 'detailMr', 'detailEn', 'link', 'tone', 'displayOrder'],
      CARDS.map((c, i) => [...c, i + 1]),
    );
    await insert(
      'live_dashboard_stats',
      ['labelMr', 'labelEn', 'value', 'displayOrder'],
      STATS.map((s, i) => [...s, i + 1]),
    );
    await insert(
      'live_dashboard_districts',
      ['districtCode', 'nameMr', 'nameEn', 'status', 'target', 'enrolled', 'trainingActive', 'completed', 'certified', 'attendancePct', 'displayOrder'],
      DISTRICTS.map((d, i) => [...d, i + 1]),
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "live_dashboard_districts"`);
    await q.query(`DROP TABLE IF EXISTS "live_dashboard_stats"`);
    await q.query(`DROP TABLE IF EXISTS "live_dashboard_cards"`);
    await q.query(`DROP TABLE IF EXISTS "live_dashboard_settings"`);
  }
}
