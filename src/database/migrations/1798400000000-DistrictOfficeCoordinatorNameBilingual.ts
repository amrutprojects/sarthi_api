import type { MigrationInterface, QueryRunner } from 'typeorm';

/*
 * District Office: the District Coordinator's name in Marathi and English.
 *
 * The name was one column, printed as written in both languages. It becomes a pair like the office
 * address and hours beside it (and the training centre manager's name): "collectorName" is renamed
 * "collectorNameEn" and "collectorNameMr" is added.
 *
 * Every existing name is copied into "collectorNameMr", so the website prints exactly what it printed
 * before until an administrator writes the Marathi spelling.
 *
 * The name stays optional, but as a pair: both halves or neither (CHK_contact_district_offices_collector_pair),
 * the same rule as the address and hours. "collectorName" had no CHECK constraint of its own to carry over.
 */
export class DistrictOfficeCoordinatorNameBilingual1798400000000 implements MigrationInterface {
  name = 'DistrictOfficeCoordinatorNameBilingual1798400000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "contact_district_offices" RENAME COLUMN "collectorName" TO "collectorNameEn"`);
    await q.query(`ALTER TABLE "contact_district_offices" ADD COLUMN "collectorNameMr" varchar(150) NULL`);

    await q.query(`UPDATE "contact_district_offices" SET "collectorNameMr" = "collectorNameEn" WHERE "collectorNameEn" IS NOT NULL`);

    await q.query(
      `ALTER TABLE "contact_district_offices" ADD CONSTRAINT "CHK_contact_district_offices_collector_pair" ` +
        `CHECK (("collectorNameMr" IS NULL) = ("collectorNameEn" IS NULL))`,
    );
  }

  /* The Marathi name is dropped; the English name stays as the single name. */
  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "contact_district_offices" DROP CONSTRAINT "CHK_contact_district_offices_collector_pair"`);
    await q.query(`ALTER TABLE "contact_district_offices" DROP COLUMN "collectorNameMr"`);
    await q.query(`ALTER TABLE "contact_district_offices" RENAME COLUMN "collectorNameEn" TO "collectorName"`);
  }
}
