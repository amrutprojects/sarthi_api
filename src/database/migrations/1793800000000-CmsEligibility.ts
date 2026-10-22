import type { MigrationInterface, QueryRunner } from 'typeorm';

/*
 * CMS Eligibility page: eligibility_page_settings (the page's headings and note, one row) and
 * eligibility_items (the eligibility criteria and the required documents, one row each), in
 * Marathi and English.
 *
 * Follows the conventions of the earlier CMS migrations: the common columns, a singleton index on
 * a constant expression for the settings row, partial unique indexes over non-deleted rows,
 * non-blank CHECKs on the bilingual text, and the set_updated_at trigger.
 *
 * The rows below are exactly what the public site displayed before the Eligibility page became
 * CMS-managed (public-site/content/kalash.ts → eligibility and documents, and the strings inlined in
 * eligibility/EligibilityPage.tsx and its two sections), in the same order, so applying this
 * migration changes nothing a visitor sees — it only moves the source of truth into the database,
 * where the admin panel (CMS → Eligibility Page Management) edits it.
 */
const PAGE_TEXT = {
  pageTitleMr: 'पात्रता',
  pageTitleEn: 'Eligibility',
  pageSubtitleMr: 'अमृत कलशसाठी पात्रता निकष व आवश्यक कागदपत्रे.',
  pageSubtitleEn: 'Eligibility criteria and required documents for AMRUT Kalash.',
  criteriaHeadingMr: 'पात्रता निकष',
  criteriaHeadingEn: 'Eligibility criteria',
  documentsHeadingMr: 'आवश्यक कागदपत्रे',
  documentsHeadingEn: 'Required documents',
  noteTitleMr: 'सूचना',
  noteTitleEn: 'Note',
  noteBodyMr:
    'वरील निकष प्रसिद्ध योजना रचनेवर आधारित असून प्रात्यक्षिक आवृत्तीत ते बदलण्यायोग्य प्रणाली-मापदंड म्हणून ठेवले आहेत. अंतिम निकष अमृतच्या मान्यतेनुसार लागू होतील.',
  noteBodyEn:
    'These criteria follow the published scheme structure and are held as configurable system parameters in this demo. Final criteria apply as approved by AMRUT.',
};

const CRITERIA: [labelMr: string, labelEn: string, valueMr: string, valueEn: string][] = [
  ['वय', 'Age', '१८ ते ४५ वर्षे', '18 to 45 years'],
  [
    'शैक्षणिक पात्रता',
    'Qualification',
    '१२ वी उत्तीर्ण किंवा ३ वर्षांचा पदविका (पॉलिटेक्निक) उत्तीर्ण',
    '12th Pass or 3-year Polytechnic Diploma',
  ],
  [
    'लक्षित गट',
    'Target group',
    'खुल्या प्रवर्गातील आर्थिकदृष्ट्या दुर्बल घटक (अमृतचा लक्षित गट)',
    'Economically Weaker Section from Open Category (AMRUT target group)',
  ],
  [
    'कौटुंबिक उत्पन्न',
    'Family income',
    'सर्व स्रोतांतून वार्षिक उत्पन्न रु. ८ लाखांपेक्षा कमी',
    'Annual family income from all sources less than Rs. 8 Lakhs',
  ],
  ['अधिवास', 'Domicile', 'महाराष्ट्राचा अधिवास दाखला आवश्यक', 'Maharashtra Domicile Certificate required'],
];

const DOCUMENTS: [labelMr: string, labelEn: string][] = [
  ['आधार कार्ड', 'Aadhaar card'],
  ['महाराष्ट्र अधिवास दाखला', 'Maharashtra Domicile Certificate'],
  ['१२ वी उत्तीर्ण / पदविका प्रमाणपत्र व गुणपत्रिका', '12th pass or Diploma certificate & marksheet'],
  ['जन्मतारीख व वयाचा पुरावा', 'Date of birth and age proof'],
  ['१ वर्षाचा उत्पन्नाचा दाखला किंवा EWS प्रमाणपत्र', '1-year Income Certificate or EWS Certificate'],
  ['छायाचित्र व स्वाक्षरी', 'Photograph and signature'],
  ['जातीचा स्पष्ट उल्लेख असलेले शासकीय कागदपत्र', 'Government document clearly mentioning caste'],
];

export class CmsEligibility1793800000000 implements MigrationInterface {
  name = 'CmsEligibility1793800000000';

  public async up(q: QueryRunner): Promise<void> {
    const base = `
      "id"        uuid        NOT NULL DEFAULT gen_random_uuid(),
      "createdAt" timestamptz NOT NULL DEFAULT now(),
      "updatedAt" timestamptz NOT NULL DEFAULT now(),
      "isDelete"  boolean     NOT NULL DEFAULT false,
      "isActive"  boolean     NOT NULL DEFAULT true`;

    await q.query(`
      CREATE TABLE "eligibility_page_settings" (${base},
        "pageTitleMr"        varchar(200)  NOT NULL,
        "pageTitleEn"        varchar(200)  NOT NULL,
        "pageSubtitleMr"     varchar(500)  NOT NULL,
        "pageSubtitleEn"     varchar(500)  NOT NULL,
        "criteriaHeadingMr"  varchar(200)  NOT NULL,
        "criteriaHeadingEn"  varchar(200)  NOT NULL,
        "documentsHeadingMr" varchar(200)  NOT NULL,
        "documentsHeadingEn" varchar(200)  NOT NULL,
        "noteTitleMr"        varchar(200)  NOT NULL,
        "noteTitleEn"        varchar(200)  NOT NULL,
        "noteBodyMr"         varchar(2000) NOT NULL,
        "noteBodyEn"         varchar(2000) NOT NULL,
        CONSTRAINT "PK_eligibility_page_settings" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_eligibility_page_settings_page_title_mr" CHECK (btrim("pageTitleMr") <> ''),
        CONSTRAINT "CHK_eligibility_page_settings_page_title_en" CHECK (btrim("pageTitleEn") <> ''),
        CONSTRAINT "CHK_eligibility_page_settings_page_subtitle_mr" CHECK (btrim("pageSubtitleMr") <> ''),
        CONSTRAINT "CHK_eligibility_page_settings_page_subtitle_en" CHECK (btrim("pageSubtitleEn") <> ''),
        CONSTRAINT "CHK_eligibility_page_settings_criteria_heading_mr" CHECK (btrim("criteriaHeadingMr") <> ''),
        CONSTRAINT "CHK_eligibility_page_settings_criteria_heading_en" CHECK (btrim("criteriaHeadingEn") <> ''),
        CONSTRAINT "CHK_eligibility_page_settings_documents_heading_mr" CHECK (btrim("documentsHeadingMr") <> ''),
        CONSTRAINT "CHK_eligibility_page_settings_documents_heading_en" CHECK (btrim("documentsHeadingEn") <> ''),
        CONSTRAINT "CHK_eligibility_page_settings_note_title_mr" CHECK (btrim("noteTitleMr") <> ''),
        CONSTRAINT "CHK_eligibility_page_settings_note_title_en" CHECK (btrim("noteTitleEn") <> ''),
        CONSTRAINT "CHK_eligibility_page_settings_note_body_mr" CHECK (btrim("noteBodyMr") <> ''),
        CONSTRAINT "CHK_eligibility_page_settings_note_body_en" CHECK (btrim("noteBodyEn") <> '')
      )`);

    /*
     * The page text is a singleton: one live configuration, ever. A unique index on a constant
     * expression admits exactly one non-deleted row, as on the Contact, footer and Modules pages.
     */
    await q.query(
      `CREATE UNIQUE INDEX "UQ_eligibility_page_settings_singleton" ON "eligibility_page_settings" ((true)) WHERE "isDelete" = false`,
    );

    await q.query(`
      CREATE TABLE "eligibility_items" (${base},
        "kind"         varchar(16)   NOT NULL,
        "labelMr"      varchar(300)  NOT NULL,
        "labelEn"      varchar(300)  NOT NULL,
        "valueMr"      varchar(1000),
        "valueEn"      varchar(1000),
        "displayOrder" integer       NOT NULL DEFAULT 0,
        CONSTRAINT "PK_eligibility_items" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_eligibility_items_kind" CHECK ("kind" IN ('CRITERION', 'DOCUMENT')),
        CONSTRAINT "CHK_eligibility_items_label_mr" CHECK (btrim("labelMr") <> ''),
        CONSTRAINT "CHK_eligibility_items_label_en" CHECK (btrim("labelEn") <> ''),
        CONSTRAINT "CHK_eligibility_items_order" CHECK ("displayOrder" >= 0),
        /*
         * A criterion is a label/value row ("Age" — "18 to 45 years"), so it needs both halves of
         * its value; a required document is a single line and carries none.
         */
        CONSTRAINT "CHK_eligibility_items_value_by_kind" CHECK (
          ("kind" = 'CRITERION' AND "valueMr" IS NOT NULL AND "valueEn" IS NOT NULL
            AND btrim("valueMr") <> '' AND btrim("valueEn") <> '')
          OR
          ("kind" = 'DOCUMENT' AND "valueMr" IS NULL AND "valueEn" IS NULL)
        )
      )`);

    /* The same criterion or document cannot be listed twice among live rows, in either language. */
    await q.query(
      `CREATE UNIQUE INDEX "UQ_eligibility_items_label_en_active" ON "eligibility_items" ("kind", lower("labelEn")) WHERE "isDelete" = false`,
    );
    await q.query(
      `CREATE UNIQUE INDEX "UQ_eligibility_items_label_mr_active" ON "eligibility_items" ("kind", lower("labelMr")) WHERE "isDelete" = false`,
    );
    await q.query(`CREATE INDEX "IDX_eligibility_items_kind" ON "eligibility_items" ("kind")`);

    for (const t of ['eligibility_page_settings', 'eligibility_items']) {
      await q.query(`CREATE TRIGGER "TRG_${t}_updated_at" BEFORE UPDATE ON "${t}" FOR EACH ROW EXECUTE FUNCTION "set_updated_at"()`);
    }

    await q.query(
      `INSERT INTO "eligibility_page_settings" (
        "pageTitleMr", "pageTitleEn", "pageSubtitleMr", "pageSubtitleEn", "criteriaHeadingMr", "criteriaHeadingEn",
        "documentsHeadingMr", "documentsHeadingEn", "noteTitleMr", "noteTitleEn", "noteBodyMr", "noteBodyEn"
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        PAGE_TEXT.pageTitleMr,
        PAGE_TEXT.pageTitleEn,
        PAGE_TEXT.pageSubtitleMr,
        PAGE_TEXT.pageSubtitleEn,
        PAGE_TEXT.criteriaHeadingMr,
        PAGE_TEXT.criteriaHeadingEn,
        PAGE_TEXT.documentsHeadingMr,
        PAGE_TEXT.documentsHeadingEn,
        PAGE_TEXT.noteTitleMr,
        PAGE_TEXT.noteTitleEn,
        PAGE_TEXT.noteBodyMr,
        PAGE_TEXT.noteBodyEn,
      ],
    );

    for (const [index, [labelMr, labelEn, valueMr, valueEn]] of CRITERIA.entries()) {
      await q.query(
        `INSERT INTO "eligibility_items" ("kind", "labelMr", "labelEn", "valueMr", "valueEn", "displayOrder") VALUES ('CRITERION', $1, $2, $3, $4, $5)`,
        [labelMr, labelEn, valueMr, valueEn, index + 1],
      );
    }

    for (const [index, [labelMr, labelEn]] of DOCUMENTS.entries()) {
      await q.query(`INSERT INTO "eligibility_items" ("kind", "labelMr", "labelEn", "displayOrder") VALUES ('DOCUMENT', $1, $2, $3)`, [
        labelMr,
        labelEn,
        index + 1,
      ]);
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "eligibility_items"`);
    await q.query(`DROP TABLE IF EXISTS "eligibility_page_settings"`);
  }
}
