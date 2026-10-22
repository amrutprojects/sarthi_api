import type { MigrationInterface, QueryRunner } from 'typeorm';

/*
 * CMS FAQ page: faqs, one row per question, in Marathi and English.
 *
 * Follows the conventions of the earlier CMS migrations: the common columns, partial unique indexes
 * over non-deleted rows, non-blank CHECKs on the bilingual text, and the set_updated_at trigger.
 *
 * The seven questions below are exactly what the public site displayed before the FAQ page became
 * CMS-managed (public-site/content/kalash.ts → faqs), in the same order, so applying this migration
 * changes nothing a visitor sees — it only moves the source of truth into the database, where the
 * admin panel (CMS → FAQ Management) edits it.
 */
const FAQS: [questionMr: string, questionEn: string, answerMr: string, answerEn: string][] = [
  [
    'अमृत कलश म्हणजे काय?',
    'What is AMRUT Kalash?',
    'अमृत व सुमागो इन्फोटेक यांच्या संयुक्त विद्यमाने राबविला जाणारा ४८० तासांचा, ४ मॉड्यूल्सचा कौशल्य विकास डिप्लोमा कार्यक्रम.',
    'A 480-hour, four-module skill development diploma programme run by AMRUT in collaboration with SUMAGO INFOTECH PVT LTD',
  ],
  [
    'कार्यक्रमाचा कालावधी किती आहे?',
    'How long does the programme take?',
    'आदर्श कालावधी ६ महिने. प्रवेशित उमेदवाराच्या उमेदवारीची वैधता १२ महिने असते, त्यामुळे महाविद्यालयीन परीक्षा किंवा अन्य अडचणींमुळे विलंब झाल्यास अतिरिक्त महिने मिळू शकतात.',
    'Ideally 6 months. The validity of an admitted candidature is 12 months, so candidates delayed by college exams or other exigencies get a reasonable number of extra months.',
  ],
  [
    'शुल्क किती आहे?',
    'What does it cost?',
    'प्रवेश निश्चित करण्यासाठी रु. २,०००/- ची परतावा योग्य अनामत रक्कम भरावी लागते. चौथे मॉड्यूल पूर्ण झाल्यावर ती परत केली जाते.',
    'A refundable security deposit of Rs. 2,000/- confirms admission. It is refunded after the fourth module is completed.',
  ],
  [
    'ऑफलाइन व ऑनलाइन प्रशिक्षणात काय फरक आहे?',
    'What is the difference between offline and online training?',
    'ऑफलाइन प्रशिक्षण मान्यताप्राप्त केंद्रावर केंद्र व्यवस्थापकाच्या देखरेखीखाली होते. ऑनलाइन प्रशिक्षण सुमागो ऑनलाइन ट्रेनिंग मॅनेजमेंट टीमद्वारे केंद्रीयरीत्या चालविले जाते. उमेदवार यापैकी एकाच पद्धतीत नोंदविला जातो.',
    'Offline training runs at an approved centre under a Centre Manager. Online training is run centrally by the SUMAGO Online Training Management Team. A candidate is enrolled in exactly one mode.',
  ],
  [
    'किमान उपस्थिती किती आवश्यक आहे?',
    'What is the minimum attendance?',
    'मूल्यमापनासाठी पात्र होण्याकरिता किमान ७५% उपस्थिती आवश्यक आहे (हे प्रमाण बदलण्यायोग्य आहे).',
    'A minimum of 75% attendance is required to be eligible for assessment (this threshold is configurable).',
  ],
  [
    'प्रमाणपत्राची पडताळणी कशी करावी?',
    'How can a certificate be verified?',
    'प्रमाणपत्र क्रमांक टाकून किंवा QR कोड स्कॅन करून सार्वजनिक पडताळणी पृष्ठावर तपासता येते.',
    'Through the public verification page, using the certificate number or by scanning its QR code.',
  ],
  [
    'मॉड्यूल ३ मध्ये कोणते क्षेत्र निवडता येते?',
    'Which domains can I choose in Module 3?',
    'डेटा व्यवस्थापन, लेखाकाम, प्रगत लेखाकाम, डिझायनिंग, वेब डिझायनिंग, हार्डवेअर व नेटवर्किंग, प्रोग्रामिंग, व्यवस्थापन, BFSI आणि डिजिटल मार्केटिंग - एकूण १० पर्याय.',
    'Ten electives: Data Management, Accounting, Advanced Accounting, Designing, Web Designing, Hardware & Networking, Programming, Management, BFSI and Digital Marketing.',
  ],
];

export class CmsFaqs1793700000000 implements MigrationInterface {
  name = 'CmsFaqs1793700000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE "faqs" (
        "id"           uuid          NOT NULL DEFAULT gen_random_uuid(),
        "createdAt"    timestamptz   NOT NULL DEFAULT now(),
        "updatedAt"    timestamptz   NOT NULL DEFAULT now(),
        "isDelete"     boolean       NOT NULL DEFAULT false,
        "isActive"     boolean       NOT NULL DEFAULT true,
        "questionMr"   varchar(500)  NOT NULL,
        "questionEn"   varchar(500)  NOT NULL,
        "answerMr"     varchar(2000) NOT NULL,
        "answerEn"     varchar(2000) NOT NULL,
        "displayOrder" integer       NOT NULL DEFAULT 0,
        CONSTRAINT "PK_faqs" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_faqs_question_mr" CHECK (btrim("questionMr") <> ''),
        CONSTRAINT "CHK_faqs_question_en" CHECK (btrim("questionEn") <> ''),
        CONSTRAINT "CHK_faqs_answer_mr" CHECK (btrim("answerMr") <> ''),
        CONSTRAINT "CHK_faqs_answer_en" CHECK (btrim("answerEn") <> ''),
        CONSTRAINT "CHK_faqs_order" CHECK ("displayOrder" >= 0)
      )`);

    /* The same question cannot be listed twice among live rows, in either language. */
    await q.query(`CREATE UNIQUE INDEX "UQ_faqs_question_en_active" ON "faqs" (lower("questionEn")) WHERE "isDelete" = false`);
    await q.query(`CREATE UNIQUE INDEX "UQ_faqs_question_mr_active" ON "faqs" (lower("questionMr")) WHERE "isDelete" = false`);
    await q.query(`CREATE TRIGGER "TRG_faqs_updated_at" BEFORE UPDATE ON "faqs" FOR EACH ROW EXECUTE FUNCTION "set_updated_at"()`);

    for (const [index, [questionMr, questionEn, answerMr, answerEn]] of FAQS.entries()) {
      await q.query(`INSERT INTO "faqs" ("questionMr", "questionEn", "answerMr", "answerEn", "displayOrder") VALUES ($1, $2, $3, $4, $5)`, [
        questionMr,
        questionEn,
        answerMr,
        answerEn,
        index + 1,
      ]);
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "faqs"`);
  }
}
