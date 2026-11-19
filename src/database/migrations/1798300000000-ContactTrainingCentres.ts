import type { MigrationInterface, QueryRunner } from 'typeorm';

/*
 * Contact Page Management: the "Approved training centres" card on each District Office page.
 *
 * Until now the website printed the centres from its bundled dataset. They become a list an
 * administrator adds to, edits, reorders, deactivates and deletes — any number per district — plus
 * a "Show on website" switch for the whole card (contact_page_settings.showTrainingCentres, shown by
 * default and written only by PATCH /cms/contact/training-centres-section).
 *
 * A centre needs its district and its name (both languages). Address and centre manager are pairs,
 * blank in both languages or filled in both; phone and email are optional. The website leaves out
 * whatever is missing rather than inventing it.
 *
 * Existing databases get the ten centres the website shows today, so the District Office pages look
 * the same after `migration:run`. Their e-mail addresses are not copied: the bundled ones are
 * placeholders on a ".demo" domain, and an empty e-mail is simply not printed. A database without the
 * Contact page row yet gets them from the seed instead (seed-contact-training-centres.ts). The rows
 * are written out here rather than imported, so this migration stays what it was when it ran.
 */
/* [district name, district code, nameMr, nameEn, addressMr, addressEn, managerMr, managerEn, phone], as the website prints them. */
const CENTRES: [string, string, string, string, string, string, string, string, string][] = [
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

export class ContactTrainingCentres1798300000000 implements MigrationInterface {
  name = 'ContactTrainingCentres1798300000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "contact_page_settings" ADD COLUMN "showTrainingCentres" boolean NOT NULL DEFAULT true`);

    await q.query(`
      CREATE TABLE "contact_training_centres" (
        "id"            uuid         NOT NULL DEFAULT gen_random_uuid(),
        "createdAt"     timestamptz  NOT NULL DEFAULT now(),
        "updatedAt"     timestamptz  NOT NULL DEFAULT now(),
        "isDelete"      boolean      NOT NULL DEFAULT false,
        "isActive"      boolean      NOT NULL DEFAULT true,
        "settingsId"    uuid         NOT NULL,
        "districtId"    uuid         NOT NULL,
        "nameMr"        varchar(200) NOT NULL,
        "nameEn"        varchar(200) NOT NULL,
        "addressMr"     varchar(500) NULL,
        "addressEn"     varchar(500) NULL,
        "managerNameMr" varchar(150) NULL,
        "managerNameEn" varchar(150) NULL,
        "phone"         varchar(32)  NULL,
        "email"         varchar(255) NULL,
        "displayOrder"  integer      NOT NULL DEFAULT 0,
        CONSTRAINT "PK_contact_training_centres" PRIMARY KEY ("id"),
        CONSTRAINT "FK_contact_training_centres_settings" FOREIGN KEY ("settingsId") REFERENCES "contact_page_settings"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_contact_training_centres_district" FOREIGN KEY ("districtId") REFERENCES "districts"("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_contact_training_centres_name_mr" CHECK (btrim("nameMr") <> ''),
        CONSTRAINT "CHK_contact_training_centres_name_en" CHECK (btrim("nameEn") <> ''),
        CONSTRAINT "CHK_contact_training_centres_address_pair" CHECK (("addressMr" IS NULL) = ("addressEn" IS NULL)),
        CONSTRAINT "CHK_contact_training_centres_manager_pair" CHECK (("managerNameMr" IS NULL) = ("managerNameEn" IS NULL)),
        CONSTRAINT "CHK_contact_training_centres_email" CHECK ("email" IS NULL OR "email" = lower("email")),
        CONSTRAINT "CHK_contact_training_centres_order" CHECK ("displayOrder" >= 0)
      )`);
    await q.query(`CREATE INDEX "IDX_contact_training_centres_settingsId" ON "contact_training_centres" ("settingsId")`);
    await q.query(`CREATE INDEX "IDX_contact_training_centres_districtId" ON "contact_training_centres" ("districtId") WHERE "isDelete" = false`);
    await q.query(
      `CREATE TRIGGER "TRG_contact_training_centres_updated_at" BEFORE UPDATE ON "contact_training_centres" FOR EACH ROW EXECUTE FUNCTION "set_updated_at"()`,
    );

    /* The ten centres, for a database that already has the Contact page. A district is matched by name, else by code. */
    const [settings] = await q.query(`SELECT "id" FROM "contact_page_settings" WHERE "isDelete" = false ORDER BY "createdAt" LIMIT 1`);
    if (!settings) return;
    for (const [districtName, code, nameMr, nameEn, addressMr, addressEn, managerMr, managerEn, phone] of CENTRES) {
      await q.query(
        `INSERT INTO "contact_training_centres"
           ("settingsId", "districtId", "nameMr", "nameEn", "addressMr", "addressEn", "managerNameMr", "managerNameEn", "phone", "displayOrder")
         SELECT $1, d."id", $4, $5, $6, $7, $8, $9, $10, 0
         FROM "districts" d
         WHERE d."isDelete" = false AND (lower(d."name") = lower($2) OR d."code" = $3)
         ORDER BY (lower(d."name") = lower($2)) DESC
         LIMIT 1`,
        [settings.id, districtName, code, nameMr, nameEn, addressMr, addressEn, managerMr, managerEn, phone],
      );
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "contact_training_centres"`);
    await q.query(`ALTER TABLE "contact_page_settings" DROP COLUMN IF EXISTS "showTrainingCentres"`);
  }
}
