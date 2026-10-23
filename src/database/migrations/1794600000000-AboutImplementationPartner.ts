import type { MigrationInterface, QueryRunner } from 'typeorm';

/*
 * About AMRUT: the "Implementation partner" row of the information card becomes a CMS record.
 *
 * Until now the About page printed this row from the website's bundled strings (org.partnerName and
 * org.partnerRole), so it was missing from About AMRUT Management. This adds it to about_facts with
 * exactly the words the page showed, at the end of the list, so it is edited, reordered, hidden and
 * deleted like every other row and also shows in the home page's About AMRUT section.
 *
 * Data only, and deliberately narrow:
 * - it runs once per database (a migration, not the seed), so a row an administrator later deletes
 *   stays deleted — re-running the seed on a deploy never brings it back;
 * - it does nothing on a database whose About section has not been seeded yet (a fresh install):
 *   seed-about-amrut.ts writes the row there, in its place after Headquarters;
 * - it does nothing when a row with this label already exists, so it can never add a duplicate.
 */
const LABEL_MR = 'अंमलबजावणी भागीदार';
const LABEL_EN = 'Implementation partner';
const VALUE_MR = 'SUMAGO INFOTECH PVT LTD — अंमलबजावणी व तंत्रज्ञान भागीदार';
const VALUE_EN = 'SUMAGO INFOTECH PVT LTD — Implementation & technology partner';

export class AboutImplementationPartner1794600000000 implements MigrationInterface {
  name = 'AboutImplementationPartner1794600000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `INSERT INTO "about_facts" ("labelMr", "labelEn", "valueMr", "valueEn", "displayOrder")
       SELECT $1::varchar, $2::varchar, $3::varchar, $4::varchar, COALESCE((SELECT MAX("displayOrder") FROM "about_facts" WHERE "isDelete" = false), 0) + 1
       WHERE EXISTS (SELECT 1 FROM "about_section" WHERE "isDelete" = false)
         AND NOT EXISTS (
           SELECT 1 FROM "about_facts"
           WHERE "isDelete" = false AND (lower("labelMr") = lower($1::varchar) OR lower("labelEn") = lower($2::varchar))
         )`,
      [LABEL_MR, LABEL_EN, VALUE_MR, VALUE_EN],
    );
  }

  /* Removes the row only while it still holds exactly what this migration wrote; an edited row is kept. */
  public async down(q: QueryRunner): Promise<void> {
    await q.query(
      `DELETE FROM "about_facts" WHERE "labelMr" = $1 AND "labelEn" = $2 AND "valueMr" = $3 AND "valueEn" = $4`,
      [LABEL_MR, LABEL_EN, VALUE_MR, VALUE_EN],
    );
  }
}
