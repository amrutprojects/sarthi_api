import type { MigrationInterface, QueryRunner } from 'typeorm';

/*
 * Removes the website's former demo-dataset content that two applied migrations put in every database
 * (user decision, 23 Nov 2026: "remove Amrut demo data"). Applied migrations are never edited, so this
 * one undoes their rows instead:
 *
 *   1797600000000-CmsLiveDashboard   — the home page Live Dashboard's invented figures:
 *     - the 8 KPI cards and the 5 figures beside the donut are soft-deleted (isDelete, as the admin
 *       panel's Delete does);
 *     - the 36 district rows are fixed map tiles (no route adds or deletes one), so each keeps its row
 *       and names and gets status NOT_STARTED with every figure 0;
 *     - the training-mode totals (offline 800 / online 200) become 0 / 0;
 *     - when that leaves the section with nothing to show, it is switched off ("Show on website" off):
 *       the same state a live install's seeds give AMRUT's Impact (created hidden, with no figures).
 *     The settings row's headings and labels are the site's real text and stay.
 *
 *   1798300000000-ContactTrainingCentres — the ten made-up "approved training centres" (the same rows
 *     seed-contact-training-centres.ts gives a local install) are soft-deleted. The card's switch
 *     (contact_page_settings.showTrainingCentres) is left as it is.
 *
 * Only a row that STILL holds exactly what those migrations wrote is touched: every content column is
 * compared (the identifying keys and the demo values). A row an administrator has edited — any label,
 * value, figure, status, address, manager, phone or e-mail — or added is kept. Position and the
 * per-row show/hide switch are not content: a demo card that was only reordered or hidden is still an
 * invented figure, and goes.
 *
 * Runs on every environment (demo figures are wrong everywhere), in one transaction, and is idempotent:
 * a soft-deleted row no longer matches, a zeroed district no longer holds its demo figures. It logs
 * counts only — no names, phones or other personal data.
 *
 * Touches nothing else: not the student registration or import, not Amrut's old lms_* tables, not any
 * other CMS content. The demo values are written out here rather than imported, so this migration stays
 * what it was when it ran.
 */

/* [labelMr, labelEn, value, detailMr, detailEn, link, tone] — as 1797600000000 inserted them. */
const DEMO_CARDS: [string, string, string, string, string, string, string][] = [
  ['एकूण लक्ष्य', 'Total target', '2,000', 'विद्यार्थी', 'students', '/programme', 'blue'],
  ['प्राप्त अर्ज', 'Applications', '1,245', 'नोंदणी झालेली', 'registrations received', '/track', 'default'],
  ['पात्र उमेदवार', 'Eligible', '1,080', '87% अर्जांपैकी', '87% of applications', '/eligibility', 'blue'],
  ['प्रवेशित', 'Enrolled', '1,000', '100% लक्ष्यापैकी', '100% of target', '/programme', 'green'],
  ['प्रशिक्षण सुरू', 'Training active', '760', '600 ऑफलाइन · 160 ऑनलाइन', '600 offline · 160 online', '/verify', 'default'],
  ['प्रशिक्षण पूर्ण', 'Completed', '240', '24% पूर्णत्व दर', '24% completion rate', '/verify', 'green'],
  ['मूल्यमापन झालेले', 'Assessed', '180', '92% उत्तीर्ण दर', '92% pass rate', '/verify', 'violet'],
  ['प्रमाणित', 'Certified', '165', 'प्रमाणपत्रे दिली', 'certificates issued', '/verify', 'green'],
];

/* [labelMr, labelEn, value] — as 1797600000000 inserted them. */
const DEMO_STATS: [string, string, string][] = [
  ['मंजूर प्रशिक्षण केंद्रे', 'Approved centres', '10'],
  ['कार्यरत बॅचेस', 'Active batches', '15'],
  ['प्रशिक्षक', 'Trainers', '12'],
  ['सरासरी उपस्थिती', 'Average attendance', '78%'],
  ['प्रगतीपथावरील जिल्हे', 'Districts on track', '21 / 36'],
];

/* The training-mode totals 1797600000000 inserted. */
const DEMO_MODES = { offlineCount: 800, onlineCount: 200 };

/* [code, status, target, enrolled, trainingActive, completed, certified, attendancePct] — as 1797600000000 inserted them. */
const DEMO_DISTRICTS: [string, string, number, number, number, number, number, number][] = [
  ['NDB', 'TRAINING_ACTIVE', 8, 11, 0, 11, 11, 88],
  ['DHU', 'TRAINING_ACTIVE', 8, 9, 0, 9, 9, 89],
  ['JAL', 'MOBILIZATION', 80, 80, 80, 0, 0, 78],
  ['BUL', 'CENTRE_SELECTION', 8, 5, 0, 5, 5, 90],
  ['AKO', 'TRAINING_ACTIVE', 8, 9, 0, 9, 2, 78],
  ['AMR', 'TRAINING_ACTIVE', 8, 12, 6, 6, 0, 80],
  ['NAG', 'MOBILIZATION', 8, 7, 7, 0, 0, 72],
  ['BHA', 'TRAINING_ACTIVE', 8, 10, 10, 0, 0, 77],
  ['GON', 'TRAINING_ACTIVE', 8, 9, 9, 0, 0, 77],
  ['PAL', 'CENTRE_SELECTION', 8, 4, 4, 0, 0, 66],
  ['NAS', 'TRAINING_ACTIVE', 80, 80, 0, 80, 55, 85],
  ['WAS', 'TRAINING_ACTIVE', 8, 11, 11, 0, 0, 79],
  ['YAV', 'TRAINING_ACTIVE', 8, 8, 8, 0, 0, 78],
  ['WAR', 'TRAINING_ACTIVE', 8, 9, 9, 0, 0, 76],
  ['CHA', 'MOBILIZATION', 8, 6, 6, 0, 0, 71],
  ['GAD', 'ON_HOLD', 8, 9, 9, 0, 0, 80],
  ['MUS', 'TRAINING_ACTIVE', 8, 8, 8, 0, 0, 70],
  ['THA', 'TRAINING_ACTIVE', 80, 80, 40, 40, 27, 82],
  ['CSN', 'MOBILIZATION', 80, 80, 80, 0, 0, 74],
  ['JLN', 'MOBILIZATION', 8, 6, 6, 0, 0, 78],
  ['HIN', 'TRAINING_ACTIVE', 8, 10, 10, 0, 0, 81],
  ['PAR', 'CENTRE_SELECTION', 8, 4, 4, 0, 0, 68],
  ['NAN', 'CRITICAL', 80, 80, 80, 0, 0, 75],
  ['MUC', 'TRAINING_ACTIVE', 7, 7, 7, 0, 0, 71],
  ['RAI', 'TRAINING_ACTIVE', 7, 8, 8, 0, 0, 75],
  ['PUN', 'TRAINING_ACTIVE', 80, 80, 0, 80, 56, 86],
  ['AHL', 'MOBILIZATION', 80, 80, 80, 0, 0, 75],
  ['BEE', 'CRITICAL', 80, 80, 80, 0, 0, 75],
  ['LAT', 'MOBILIZATION', 7, 6, 6, 0, 0, 0],
  ['DHA', 'TRAINING_ACTIVE', 7, 7, 7, 0, 0, 0],
  ['RAT', 'CENTRE_SELECTION', 7, 4, 4, 0, 0, 0],
  ['SAT', 'TRAINING_ACTIVE', 80, 80, 80, 0, 0, 75],
  ['SOL', 'TRAINING_ACTIVE', 7, 9, 9, 0, 0, 0],
  ['SIN', 'TRAINING_ACTIVE', 7, 7, 7, 0, 0, 0],
  ['KOL', 'TRAINING_ACTIVE', 80, 80, 80, 0, 0, 73],
  ['SAN', 'MOBILIZATION', 7, 5, 5, 0, 0, 0],
];

/*
 * [district name, district code, nameMr, nameEn, addressMr, addressEn, managerMr, managerEn, phone] — as
 * 1798300000000 inserted them (e-mail NULL). A district is matched as that migration picked it: by name, else by code.
 */
const DEMO_CENTRES: [string, string, string, string, string, string, string, string, string][] = [
  ['Ahilyanagar', 'AHL', 'संगमनेर ग्रामीण कौशल्य केंद्र', 'Sangamner Rural Skill Centre', 'नगर, अहिल्यानगर, महाराष्ट्र', 'Nagar, Ahilyanagar, Maharashtra', 'कविता चव्हाण', 'Kavita Chavan', '+91 98XXX 51203'],
  ['Beed', 'BEE', 'अंबाजोगाई कौशल्य अकादमी', 'Ambajogai Skill Academy', 'बीड, बीड, महाराष्ट्र', 'Beed, Beed, Maharashtra', 'गणेश सावंत', 'Ganesh Sawant', '+91 98XXX 51204'],
  ['Chhatrapati Sambhajinagar', 'CSN', 'पैठण कौशल्य विकास संस्था', 'Paithan Skill Development Institute', 'छ. संभाजीनगर, छत्रपती संभाजीनगर, महाराष्ट्र', 'Chh. Sambhajinagar, Chhatrapati Sambhajinagar, Maharashtra', 'अंजली गायकवाड', 'Anjali Gaikwad', '+91 98XXX 51206'],
  ['Jalgaon', 'JAL', 'भुसावळ औद्योगिक प्रशिक्षण केंद्र', 'Bhusawal Industrial Training Centre', 'जळगाव, जळगाव, महाराष्ट्र', 'Jalgaon, Jalgaon, Maharashtra', 'नितीन वाघ', 'Nitin Wagh', '+91 98XXX 51208'],
  ['Kolhapur', 'KOL', 'करवीर कौशल्य उत्कृष्टता केंद्र', 'Karvir Skill Excellence Centre', 'करवीर, कोल्हापूर, महाराष्ट्र', 'Karvir, Kolhapur, Maharashtra', 'रेखा माने', 'Rekha Mane', '+91 98XXX 51209'],
  ['Nanded', 'NAN', 'नांदेड डिजिटल कौशल्य केंद्र', 'Nanded Digital Skills Centre', 'नांदेड, नांदेड, महाराष्ट्र', 'Nanded, Nanded, Maharashtra', 'प्रकाश साळुंखे', 'Prakash Salunkhe', '+91 98XXX 51207'],
  ['Nashik', 'NAS', 'नाशिक तांत्रिक प्रशिक्षण संस्था', 'Nashik Institute of Technical Training', 'नाशिक, नाशिक, महाराष्ट्र', 'Nashik, Nashik, Maharashtra', 'मनीषा जोशी', 'Manisha Joshi', '+91 98XXX 51201'],
  ['Pune', 'PUN', 'हवेली कौशल्य विकास केंद्र', 'Haveli Skill Development Centre', 'हवेली, पुणे, महाराष्ट्र', 'Haveli, Pune, Maharashtra', 'सुनील पवार', 'Sunil Pawar', '+91 98XXX 51200'],
  ['Satara', 'SAT', 'कराड तांत्रिक प्रशिक्षण संस्था', 'Karad Technical Training Institute', 'सातारा, सातारा, महाराष्ट्र', 'Satara, Satara, Maharashtra', 'दीपक भोसले', 'Deepak Bhosale', '+91 98XXX 51205'],
  ['Thane', 'THA', 'कल्याण व्यावसायिक प्रशिक्षण केंद्र', 'Kalyan Vocational Training Centre', 'ठाणे, ठाणे, महाराष्ट्र', 'Thane, Thane, Maharashtra', 'रवींद्र मोरे', 'Ravindra More', '+91 98XXX 51202'],
];

/* Counts only: what was removed (or zeroed) and what stays. */
export interface RemoveDemoDatasetSummary {
  cards: { removed: number; kept: number };
  stats: { removed: number; kept: number };
  districts: { zeroed: number; kept: number };
  modesZeroed: boolean;
  sectionHidden: boolean;
  centres: { removed: number; kept: number };
}

/* An UPDATE ... RETURNING through the query runner yields [rows, affected]; this reads the affected count. */
const affected = (result: unknown): number => (Array.isArray(result) && typeof result[1] === 'number' ? result[1] : 0);
const count = async (q: QueryRunner, sql: string): Promise<number> => Number((await q.query(sql))[0].n);

export class RemoveDemoDataset1798800000000 implements MigrationInterface {
  name = 'RemoveDemoDataset1798800000000';

  /* What the last up() did; read by the tests. */
  summary: RemoveDemoDatasetSummary | null = null;

  public async up(q: QueryRunner): Promise<void> {
    /* migration:run wraps each migration in a transaction; run on its own (tests, transaction 'none'), it opens one. */
    const own = !q.isTransactionActive;
    if (own) await q.startTransaction();
    try {
      this.summary = await this.clean(q);
      if (own) await q.commitTransaction();
    } catch (err) {
      if (own) await q.rollbackTransaction();
      throw err;
    }
    // eslint-disable-next-line no-console
    console.info(`[${this.name}] demo dataset removed (counts only):`, JSON.stringify(this.summary));
  }

  private async clean(q: QueryRunner): Promise<RemoveDemoDatasetSummary> {
    const summary: RemoveDemoDatasetSummary = {
      cards: { removed: 0, kept: 0 },
      stats: { removed: 0, kept: 0 },
      districts: { zeroed: 0, kept: 0 },
      modesZeroed: false,
      sectionHidden: false,
      centres: { removed: 0, kept: 0 },
    };

    /* Live Dashboard — KPI cards. */
    for (const [labelMr, labelEn, value, detailMr, detailEn, link, tone] of DEMO_CARDS) {
      summary.cards.removed += affected(
        await q.query(
          `UPDATE "live_dashboard_cards" SET "isDelete" = true, "isActive" = false
           WHERE "isDelete" = false AND "labelMr" = $1 AND "labelEn" = $2 AND "value" = $3
             AND "detailMr" = $4 AND "detailEn" = $5 AND "link" = $6 AND "tone" = $7
           RETURNING "id"`,
          [labelMr, labelEn, value, detailMr, detailEn, link, tone],
        ),
      );
    }
    summary.cards.kept = await count(q, `SELECT count(*) AS n FROM "live_dashboard_cards" WHERE "isDelete" = false`);

    /* Live Dashboard — the figures beside the donut. */
    for (const [labelMr, labelEn, value] of DEMO_STATS) {
      summary.stats.removed += affected(
        await q.query(
          `UPDATE "live_dashboard_stats" SET "isDelete" = true, "isActive" = false
           WHERE "isDelete" = false AND "labelMr" = $1 AND "labelEn" = $2 AND "value" = $3
           RETURNING "id"`,
          [labelMr, labelEn, value],
        ),
      );
    }
    summary.stats.kept = await count(q, `SELECT count(*) AS n FROM "live_dashboard_stats" WHERE "isDelete" = false`);

    /* Live Dashboard — districts: the row stays (a map tile), its demo status and figures go. */
    for (const [code, status, target, enrolled, trainingActive, completed, certified, attendancePct] of DEMO_DISTRICTS) {
      summary.districts.zeroed += affected(
        await q.query(
          `UPDATE "live_dashboard_districts"
           SET "status" = 'NOT_STARTED', "target" = 0, "enrolled" = 0, "trainingActive" = 0, "completed" = 0, "certified" = 0, "attendancePct" = 0
           WHERE "isDelete" = false AND "districtCode" = $1 AND "status" = $2 AND "target" = $3 AND "enrolled" = $4
             AND "trainingActive" = $5 AND "completed" = $6 AND "certified" = $7 AND "attendancePct" = $8
           RETURNING "id"`,
          [code, status, target, enrolled, trainingActive, completed, certified, attendancePct],
        ),
      );
    }
    /* Kept: districts whose figures an administrator entered (anything but the all-zero NOT_STARTED tile). */
    summary.districts.kept = await count(
      q,
      `SELECT count(*) AS n FROM "live_dashboard_districts"
       WHERE "isDelete" = false AND NOT ("status" = 'NOT_STARTED' AND "target" = 0 AND "enrolled" = 0 AND "trainingActive" = 0
         AND "completed" = 0 AND "certified" = 0 AND "attendancePct" = 0)`,
    );

    /* Live Dashboard — the training-mode totals. */
    summary.modesZeroed =
      affected(
        await q.query(
          `UPDATE "live_dashboard_settings" SET "offlineCount" = 0, "onlineCount" = 0
           WHERE "isDelete" = false AND "offlineCount" = $1 AND "onlineCount" = $2
           RETURNING "id"`,
          [DEMO_MODES.offlineCount, DEMO_MODES.onlineCount],
        ),
      ) > 0;

    /*
     * Live Dashboard — switched off only when this run removed demo figures AND nothing real is left to
     * show (no card, no side figure, no training-mode total, no district figure). An administrator's own
     * content keeps the switch as they set it; a second run removes nothing, so it never switches again.
     */
    const changedDashboard = summary.cards.removed + summary.stats.removed + summary.districts.zeroed > 0 || summary.modesZeroed;
    if (changedDashboard && summary.cards.kept === 0 && summary.stats.kept === 0 && summary.districts.kept === 0) {
      summary.sectionHidden =
        affected(
          await q.query(
            `UPDATE "live_dashboard_settings" SET "showSection" = false
             WHERE "isDelete" = false AND "showSection" = true AND "offlineCount" = 0 AND "onlineCount" = 0
             RETURNING "id"`,
          ),
        ) > 0;
    }

    /* Contact page — the ten demo training centres (district matched as 1798300000000 picked it). */
    for (const [districtName, code, nameMr, nameEn, addressMr, addressEn, managerMr, managerEn, phone] of DEMO_CENTRES) {
      summary.centres.removed += affected(
        await q.query(
          `UPDATE "contact_training_centres" c SET "isDelete" = true, "isActive" = false
           FROM "districts" d
           WHERE c."isDelete" = false AND c."districtId" = d."id" AND (lower(d."name") = lower($1) OR d."code" = $2)
             AND c."nameMr" = $3 AND c."nameEn" = $4 AND c."addressMr" = $5 AND c."addressEn" = $6
             AND c."managerNameMr" = $7 AND c."managerNameEn" = $8 AND c."phone" = $9 AND c."email" IS NULL
           RETURNING c."id"`,
          [districtName, code, nameMr, nameEn, addressMr, addressEn, managerMr, managerEn, phone],
        ),
      );
    }
    summary.centres.kept = await count(q, `SELECT count(*) AS n FROM "contact_training_centres" WHERE "isDelete" = false`);

    return summary;
  }

  /*
   * Deliberately a no-op: reverting must never put invented figures or made-up centres back on the
   * website. The soft-deleted rows stay in their tables (isDelete = true) for the record.
   */
  public async down(): Promise<void> {
    /* no-op by design */
  }
}
