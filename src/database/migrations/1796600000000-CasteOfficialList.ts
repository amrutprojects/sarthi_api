import type { MigrationInterface, QueryRunner } from 'typeorm';

/*
 * Castes: the official AMRUT target-group list, in its order, with English names.
 *
 * "सद्यस्थितीत अमृतच्या लक्षित गटात अशा एकूण 26 जातींचा समावेश आहे." The caste master held 27 names in another
 * order, two of them outside the list (मराठी, ठाकूर) and five spelled differently. After this migration the active
 * castes are exactly the 26 below, in this order, and every list of castes (the registration form's dropdown, the
 * website's eligibility page) follows it.
 *
 * - castes gains "nameEn" varchar(150) NULL (the English website shows "Brahmin (ब्राह्मण)") and "displayOrder"
 *   integer (1–26 for the list; the options endpoint sorts by it instead of by name).
 * - Each listed caste is matched to an existing row by its exact name (case-insensitive, NFC), or else by its earlier
 *   spelling, which is then corrected. Codes are kept (a code in use cannot change). A matching soft-deleted row is
 *   restored rather than duplicated: its name stays reserved, so a new row could not take it. A caste with no row is
 *   inserted with the next free C-number code.
 * - Every other caste is made INACTIVE, not deleted: students registered with it keep their link (casteId) and their
 *   recorded name, and an administrator can still see it in the master — after the list (display order 27 onward, by
 *   code), so the admin screen, which opens in display order, starts with the official 26.
 * - students.caste (the name as registered) is not rewritten for a corrected spelling, as with the Masters migration:
 *   the text columns keep history; casteId points at the corrected row.
 *
 * The list is frozen here, so later edits to student.constants do not change this migration. down() drops the two
 * columns; the renames, the inserted row and the deactivations are not reverted (the previous state is not recorded).
 */
const OFFICIAL: [name: string, nameEn: string][] = [
  ['ब्राह्मण', 'Brahmin'],
  ['कायस्थ', 'Kayastha'],
  ['कोमटी/ वैश्य', 'Komati / Vaishya'],
  ['मारवाडी', 'Marwari'],
  ['पटेल', 'Patel'],
  ['राजपूत', 'Rajput'],
  ['यलमार', 'Yelmar'],
  ['अय्यंगार', 'Iyengar / Ayyangar'],
  ['राजपुरोहित', 'Rajpurohit'],
  ['पाटीदार', 'Patidar'],
  ['नायर', 'Nair'],
  ['नायडू', 'Naidu'],
  ['कम्मा', 'Kamma'],
  ['कानबी', 'Kanbi'],
  ['सिंधी', 'Sindhi'],
  ['बनिया', 'Bania'],
  ['बंगाली', 'Bengali'],
  ['त्यागी', 'Tyagi'],
  ['सेनगूनथर', 'Sengunthar'],
  ['गुजराती', 'Gujarati'],
  ['जाट', 'Jat'],
  ['लोहाना', 'Lohana'],
  ['हिंदू नेपाळी', 'Hindu Nepali'],
  ['भूमिहार', 'Bhumihar'],
  ['हिंदू / वीरशैव लिंगायत', 'Hindu / Veershaiv Lingayat'],
  ['अग्रवाल', 'Agrawal'],
];

/* The master's earlier spelling of a listed caste (as the Masters migration inserted it). */
const EARLIER: Record<string, string> = {
  'कोमटी/ वैश्य': 'कोमटी/वैश्य',
  सेनगूनथर: 'सेनगुप्तर',
  गुजराती: 'गुजराथी',
  लोहाना: 'लोहाणा',
  'हिंदू / वीरशैव लिंगायत': 'हिंदू वेरशैव लिंगायत',
};

const nfc = (v: string) => v.normalize('NFC');

export class CasteOfficialList1796600000000 implements MigrationInterface {
  name = 'CasteOfficialList1796600000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "castes" ADD COLUMN "nameEn" varchar(150) NULL`);
    await q.query(`ALTER TABLE "castes" ADD COLUMN "displayOrder" integer NOT NULL DEFAULT 0`);
    await q.query(`ALTER TABLE "castes" ADD CONSTRAINT "CHK_castes_displayOrder" CHECK ("displayOrder" >= 0)`);

    const byName = async (name: string): Promise<string | undefined> =>
      (await q.query(`SELECT "id" FROM "castes" WHERE lower("name") = lower($1)`, [nfc(name)]))[0]?.id;

    const kept: string[] = [];
    for (const [i, [name, nameEn]] of OFFICIAL.entries()) {
      let id = await byName(name);
      if (!id && EARLIER[name]) {
        id = await byName(EARLIER[name]);
        if (id) await q.query(`UPDATE "castes" SET "name" = $2 WHERE "id" = $1`, [id, nfc(name)]);
      }
      if (!id) {
        const [{ n }] = await q.query(
          `SELECT COALESCE(MAX(substring("code" from '^C([0-9]+)$')::int), 0) + 1 AS "n" FROM "castes" WHERE "code" ~ '^C[0-9]+$'`,
        );
        const code = 'C' + String(n).padStart(2, '0');
        id = (await q.query(`INSERT INTO "castes" ("code", "name") VALUES ($1, $2) RETURNING "id"`, [code, nfc(name)]))[0].id;
      }
      await q.query(`UPDATE "castes" SET "nameEn" = $2, "displayOrder" = $3, "isActive" = true, "isDelete" = false WHERE "id" = $1`, [
        id,
        nameEn,
        i + 1,
      ]);
      kept.push(id as string);
    }

    /* Not in the list: inactive, kept for the students who reference it, and placed after the list. */
    await q.query(
      `UPDATE "castes" c SET "isActive" = false, "displayOrder" = $2 + o."n"
       FROM (SELECT "id", row_number() OVER (ORDER BY "code") AS "n" FROM "castes" WHERE NOT ("id" = ANY($1::uuid[]))) o
       WHERE c."id" = o."id"`,
      [kept, OFFICIAL.length],
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "castes" DROP CONSTRAINT "CHK_castes_displayOrder"`);
    await q.query(`ALTER TABLE "castes" DROP COLUMN "displayOrder"`);
    await q.query(`ALTER TABLE "castes" DROP COLUMN "nameEn"`);
  }
}
