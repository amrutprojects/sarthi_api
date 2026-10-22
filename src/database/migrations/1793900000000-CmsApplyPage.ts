import type { MigrationInterface, QueryRunner } from 'typeorm';

/*
 * CMS Apply page ("How to Apply"): apply_page_settings (the page's headings, note and call to
 * action, one row) and apply_page_items (the application steps and the "At a glance" rows, one row
 * each), in Marathi and English.
 *
 * Follows the conventions of the earlier CMS migrations: the common columns, a singleton index on
 * a constant expression for the settings row, partial unique indexes over non-deleted rows,
 * non-blank CHECKs on the bilingual text, and the set_updated_at trigger.
 *
 * The rows below are exactly what the public site displayed before the Apply page became
 * CMS-managed (public-site/content/kalash.ts → applySteps, applyLeadDays and securityDeposit, and the
 * strings inlined in apply/ApplyPage.tsx and its three sections), in the same order, so applying this
 * migration changes nothing a visitor sees — it only moves the source of truth into the database,
 * where the admin panel (CMS → Apply Page Management) edits it.
 *
 * The "Documents to keep ready" list is deliberately not seeded here: the public feed serves the
 * Eligibility page's required documents (eligibility_items, kind DOCUMENT), which are the same list.
 */
const PAGE_TEXT = {
  pageTitleMr: 'अर्ज कसा करावा',
  pageTitleEn: 'How to Apply',
  pageSubtitleMr: 'नोंदणीपासून प्रवेशापर्यंतची संपूर्ण प्रक्रिया.',
  pageSubtitleEn: 'The complete process from registration to admission.',
  /* The callout under the steps, as StepLadder rendered it with applyLeadDays = 30 (Latin digits in both languages). */
  noteTitleMr: 'महत्त्वाचे',
  noteTitleEn: 'Important',
  noteBodyMr: 'इच्छित बॅच सुरू होण्याच्या किमान 30 दिवस आधी अर्ज करावा.',
  noteBodyEn: 'Apply at least 30 days before the commencement of your desired batch.',
  glanceHeadingMr: 'लक्षात ठेवा',
  glanceHeadingEn: 'At a glance',
  documentsHeadingMr: 'आवश्यक कागदपत्रे',
  documentsHeadingEn: 'Documents to keep ready',
  ctaTextMr: 'अर्ज अधिकृत अमृत पोर्टलवर स्वीकारले जातात. नोंदणी करण्यासाठी खालील बटणावर क्लिक करा.',
  ctaTextEn: 'Applications are accepted on the official AMRUT portal. Use the button below to register.',
  ctaLabelMr: 'Apply Now',
  ctaLabelEn: 'Apply Now',
  ctaUrl: 'https://app.mahaamrut.org.in/amrut-new/signup',
  ctaHintMr: 'ही लिंक नवीन टॅबमध्ये उघडेल — app.mahaamrut.org.in',
  ctaHintEn: 'Opens in a new tab — app.mahaamrut.org.in',
};

/* kalash.applySteps: n → label (the step title), d → value (the step description). */
const STEPS: [titleMr: string, titleEn: string, descriptionMr: string, descriptionEn: string][] = [
  [
    'ऑनलाइन अर्ज',
    'Online application',
    'इच्छित बॅचसाठी अमृत कलश पोर्टलवर ऑनलाइन अर्ज करा व पात्रतेच्या कागदपत्रांच्या स्कॅन प्रती अपलोड करा. पसंतीचे केंद्र निवडा.',
    'Apply online on the AMRUT Kalash portal for your desired batch, upload scanned proofs of eligibility and indicate your preferred centre.',
  ],
  [
    'स्थानिक मदत (ऐच्छिक)',
    'Local support (optional)',
    'आवश्यक असल्यास जवळच्या अधिकृत अध्ययन केंद्राची (ALC) मदत घेता येईल.',
    'Candidates may seek local support for the online application from a nearby Authorized Learning Centre (ALC).',
  ],
  [
    'केंद्राकडून पडताळणी',
    'Centre verification',
    'निवडलेले ALC उमेदवाराची माहिती व कागदपत्रे तपासून पात्रतेची पुष्टी करते.',
    "The selected ALC verifies the candidate's data and supporting documents and confirms eligibility.",
  ],
  [
    'जिल्हा समन्वयक तपासणी',
    'District coordinator review',
    'संबंधित जिल्हा/क्लस्टर समन्वयक आपल्या लॉगिनमधून प्रत्येक उमेदवाराची माहिती पडताळतो.',
    'The respective district / cluster coordinator verifies each candidate from their login.',
  ],
  [
    'अमृतकडून अंतिम मान्यता',
    'Final approval by AMRUT',
    'अमृत प्राधिकरण आपल्या लॉगिनमधून उमेदवाराच्या तपशिलास अंतिम मान्यता देते.',
    'AMRUT authorities give final approval to the candidate details from their login.',
  ],
  [
    'अनामत रक्कम व प्रवेश',
    'Security deposit & admission',
    'मान्यताप्राप्त उमेदवार संबंधित ALC मार्फत रु. २,०००/- ची परतावा योग्य अनामत रक्कम भरतो; त्यानंतर पहिल्या मॉड्यूलसाठी लॉगिन क्रेडेन्शियल्स दिली जातात.',
    'The approved candidate pays a refundable security deposit of Rs. 2,000/- through the ALC, after which login credentials are issued for Module 1.',
  ],
];

/* The "At a glance" card, as AtAGlance rendered it (row 1 from securityDeposit = 2000, formatted en-IN). */
const FACTS: [labelMr: string, labelEn: string, valueMr: string, valueEn: string][] = [
  ['अनामत रक्कम', 'Security deposit', '₹2,000 (परतावा योग्य)', '₹2,000 (refundable)'],
  ['परतावा', 'Refund', 'चौथे मॉड्यूल पूर्ण झाल्यावर', 'After completing Module 4'],
  ['लॉगिन', 'Login', 'रक्कम भरल्यावर मॉड्यूल १ साठी दिले जाते', 'Issued for Module 1 after payment'],
  ['पडताळणी', 'Verification', 'केंद्र → जिल्हा समन्वयक → अमृत', 'Centre → District coordinator → AMRUT'],
];

export class CmsApplyPage1793900000000 implements MigrationInterface {
  name = 'CmsApplyPage1793900000000';

  public async up(q: QueryRunner): Promise<void> {
    const base = `
      "id"        uuid        NOT NULL DEFAULT gen_random_uuid(),
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now(),
      "isDelete"  boolean     NOT NULL DEFAULT false,
      "isActive"  boolean     NOT NULL DEFAULT true`;

    await q.query(`
      CREATE TABLE "apply_page_settings" (${base},
        "pageTitleMr"        varchar(200)  NOT NULL,
        "pageTitleEn"        varchar(200)  NOT NULL,
        "pageSubtitleMr"     varchar(500)  NOT NULL,
        "pageSubtitleEn"     varchar(500)  NOT NULL,
        "noteTitleMr"        varchar(200)  NOT NULL,
        "noteTitleEn"        varchar(200)  NOT NULL,
        "noteBodyMr"         varchar(2000) NOT NULL,
        "noteBodyEn"         varchar(2000) NOT NULL,
        "glanceHeadingMr"    varchar(200)  NOT NULL,
        "glanceHeadingEn"    varchar(200)  NOT NULL,
        "documentsHeadingMr" varchar(200)  NOT NULL,
        "documentsHeadingEn" varchar(200)  NOT NULL,
        "ctaTextMr"          varchar(1000) NOT NULL,
        "ctaTextEn"          varchar(1000) NOT NULL,
        "ctaLabelMr"         varchar(100)  NOT NULL,
        "ctaLabelEn"         varchar(100)  NOT NULL,
        "ctaUrl"             varchar(500)  NOT NULL,
        "ctaHintMr"          varchar(300)  NOT NULL,
        "ctaHintEn"          varchar(300)  NOT NULL,
        CONSTRAINT "PK_apply_page_settings" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_apply_page_settings_page_title_mr" CHECK (btrim("pageTitleMr") <> ''),
        CONSTRAINT "CHK_apply_page_settings_page_title_en" CHECK (btrim("pageTitleEn") <> ''),
        CONSTRAINT "CHK_apply_page_settings_page_subtitle_mr" CHECK (btrim("pageSubtitleMr") <> ''),
        CONSTRAINT "CHK_apply_page_settings_page_subtitle_en" CHECK (btrim("pageSubtitleEn") <> ''),
        CONSTRAINT "CHK_apply_page_settings_note_title_mr" CHECK (btrim("noteTitleMr") <> ''),
        CONSTRAINT "CHK_apply_page_settings_note_title_en" CHECK (btrim("noteTitleEn") <> ''),
        CONSTRAINT "CHK_apply_page_settings_note_body_mr" CHECK (btrim("noteBodyMr") <> ''),
        CONSTRAINT "CHK_apply_page_settings_note_body_en" CHECK (btrim("noteBodyEn") <> ''),
        CONSTRAINT "CHK_apply_page_settings_glance_heading_mr" CHECK (btrim("glanceHeadingMr") <> ''),
        CONSTRAINT "CHK_apply_page_settings_glance_heading_en" CHECK (btrim("glanceHeadingEn") <> ''),
        CONSTRAINT "CHK_apply_page_settings_documents_heading_mr" CHECK (btrim("documentsHeadingMr") <> ''),
        CONSTRAINT "CHK_apply_page_settings_documents_heading_en" CHECK (btrim("documentsHeadingEn") <> ''),
        CONSTRAINT "CHK_apply_page_settings_cta_text_mr" CHECK (btrim("ctaTextMr") <> ''),
        CONSTRAINT "CHK_apply_page_settings_cta_text_en" CHECK (btrim("ctaTextEn") <> ''),
        CONSTRAINT "CHK_apply_page_settings_cta_label_mr" CHECK (btrim("ctaLabelMr") <> ''),
        CONSTRAINT "CHK_apply_page_settings_cta_label_en" CHECK (btrim("ctaLabelEn") <> ''),
        CONSTRAINT "CHK_apply_page_settings_cta_hint_mr" CHECK (btrim("ctaHintMr") <> ''),
        CONSTRAINT "CHK_apply_page_settings_cta_hint_en" CHECK (btrim("ctaHintEn") <> ''),
        /* The link goes straight into an href on the website: https only, with a host. */
        CONSTRAINT "CHK_apply_page_settings_cta_url" CHECK ("ctaUrl" ~ '^https://[^\\s/]+')
      )`);

    /*
     * The page text is a singleton: one live configuration, ever. A unique index on a constant
     * expression admits exactly one non-deleted row, as on the Contact, footer, Modules and
     * Eligibility pages.
     */
    await q.query(`CREATE UNIQUE INDEX "UQ_apply_page_settings_singleton" ON "apply_page_settings" ((true)) WHERE "isDelete" = false`);

    await q.query(`
      CREATE TABLE "apply_page_items" (${base},
        "kind"         varchar(16)   NOT NULL,
        "labelMr"      varchar(300)  NOT NULL,
        "labelEn"      varchar(300)  NOT NULL,
        "valueMr"      varchar(2000) NOT NULL,
        "valueEn"      varchar(2000) NOT NULL,
        "displayOrder" integer       NOT NULL DEFAULT 0,
        CONSTRAINT "PK_apply_page_items" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_apply_page_items_kind" CHECK ("kind" IN ('STEP', 'FACT')),
        CONSTRAINT "CHK_apply_page_items_label_mr" CHECK (btrim("labelMr") <> ''),
        CONSTRAINT "CHK_apply_page_items_label_en" CHECK (btrim("labelEn") <> ''),
        /* Both kinds carry a value: a step's description, a fact's value. */
        CONSTRAINT "CHK_apply_page_items_value_mr" CHECK (btrim("valueMr") <> ''),
        CONSTRAINT "CHK_apply_page_items_value_en" CHECK (btrim("valueEn") <> ''),
        CONSTRAINT "CHK_apply_page_items_order" CHECK ("displayOrder" >= 0)
      )`);

    /* The same step or "At a glance" row cannot be listed twice among live rows, in either language. */
    await q.query(
      `CREATE UNIQUE INDEX "UQ_apply_page_items_label_en_active" ON "apply_page_items" ("kind", lower("labelEn")) WHERE "isDelete" = false`,
    );
    await q.query(
      `CREATE UNIQUE INDEX "UQ_apply_page_items_label_mr_active" ON "apply_page_items" ("kind", lower("labelMr")) WHERE "isDelete" = false`,
    );
    await q.query(`CREATE INDEX "IDX_apply_page_items_kind" ON "apply_page_items" ("kind")`);

    for (const t of ['apply_page_settings', 'apply_page_items']) {
      await q.query(`CREATE TRIGGER "TRG_${t}_updated_at" BEFORE UPDATE ON "${t}" FOR EACH ROW EXECUTE FUNCTION "set_updated_at"()`);
    }

    await q.query(
      `INSERT INTO "apply_page_settings" (
        "pageTitleMr", "pageTitleEn", "pageSubtitleMr", "pageSubtitleEn", "noteTitleMr", "noteTitleEn", "noteBodyMr", "noteBodyEn",
        "glanceHeadingMr", "glanceHeadingEn", "documentsHeadingMr", "documentsHeadingEn", "ctaTextMr", "ctaTextEn",
        "ctaLabelMr", "ctaLabelEn", "ctaUrl", "ctaHintMr", "ctaHintEn"
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)`,
      [
        PAGE_TEXT.pageTitleMr,
        PAGE_TEXT.pageTitleEn,
        PAGE_TEXT.pageSubtitleMr,
        PAGE_TEXT.pageSubtitleEn,
        PAGE_TEXT.noteTitleMr,
        PAGE_TEXT.noteTitleEn,
        PAGE_TEXT.noteBodyMr,
        PAGE_TEXT.noteBodyEn,
        PAGE_TEXT.glanceHeadingMr,
        PAGE_TEXT.glanceHeadingEn,
        PAGE_TEXT.documentsHeadingMr,
        PAGE_TEXT.documentsHeadingEn,
        PAGE_TEXT.ctaTextMr,
        PAGE_TEXT.ctaTextEn,
        PAGE_TEXT.ctaLabelMr,
        PAGE_TEXT.ctaLabelEn,
        PAGE_TEXT.ctaUrl,
        PAGE_TEXT.ctaHintMr,
        PAGE_TEXT.ctaHintEn,
      ],
    );

    for (const [kind, rows] of [
      ['STEP', STEPS],
      ['FACT', FACTS],
    ] as const) {
      for (const [index, [labelMr, labelEn, valueMr, valueEn]] of rows.entries()) {
        await q.query(
          `INSERT INTO "apply_page_items" ("kind", "labelMr", "labelEn", "valueMr", "valueEn", "displayOrder") VALUES ($1, $2, $3, $4, $5, $6)`,
          [kind, labelMr, labelEn, valueMr, valueEn, index + 1],
        );
      }
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "apply_page_items"`);
    await q.query(`DROP TABLE IF EXISTS "apply_page_settings"`);
  }
}
