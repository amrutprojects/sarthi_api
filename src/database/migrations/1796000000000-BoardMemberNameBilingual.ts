import type { MigrationInterface, QueryRunner } from 'typeorm';

/*
 * Leadership & Governing Board: a member's name in Marathi and English.
 *
 * The name was one column, printed as written in both languages. It becomes a pair like the badge and
 * the designation: "name" is renamed "nameEn" and "nameMr" is added beside it.
 *
 * Every existing name is copied into "nameMr", so the website prints exactly what it printed before
 * until an administrator writes the Marathi spelling. The one name the seed wrote gets the Marathi
 * spelling the seed now writes; only exactly that seeded row is matched.
 *
 * Both halves are NULL (the name is still to be supplied) or both are filled: the site has no
 * per-field language fallback, so a name in one language only would leave the card nameless for half
 * the visitors.
 *
 * The unique index on (name, designation) follows the rename and keeps comparing the English name.
 */
export class BoardMemberNameBilingual1796000000000 implements MigrationInterface {
  name = 'BoardMemberNameBilingual1796000000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "board_members" RENAME COLUMN "name" TO "nameEn"`);
    await q.query(`ALTER TABLE "board_members" DROP CONSTRAINT "CHK_board_members_name"`);
    await q.query(`ALTER TABLE "board_members" ADD COLUMN "nameMr" varchar(120) NULL`);

    await q.query(`UPDATE "board_members" SET "nameMr" = "nameEn", "updatedAt" = now() WHERE "nameEn" IS NOT NULL`);
    await q.query(`
      UPDATE "board_members" SET "nameMr" = 'राजेंद्र सुमागो'
      WHERE "nameEn" = 'Rajendra Sumago' AND "designationEn" = 'Project Director, SUMAGO INFOTECH PVT LTD'`);

    await q.query(
      `ALTER TABLE "board_members" ADD CONSTRAINT "CHK_board_members_name_mr" CHECK ("nameMr" IS NULL OR btrim("nameMr") <> '')`,
    );
    await q.query(
      `ALTER TABLE "board_members" ADD CONSTRAINT "CHK_board_members_name_en" CHECK ("nameEn" IS NULL OR btrim("nameEn") <> '')`,
    );
    await q.query(
      `ALTER TABLE "board_members" ADD CONSTRAINT "CHK_board_members_name_pair" CHECK (("nameMr" IS NULL) = ("nameEn" IS NULL))`,
    );
  }

  /* The Marathi names are dropped; the English name stays as the single name. */
  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "board_members" DROP CONSTRAINT "CHK_board_members_name_pair"`);
    await q.query(`ALTER TABLE "board_members" DROP CONSTRAINT "CHK_board_members_name_en"`);
    await q.query(`ALTER TABLE "board_members" DROP CONSTRAINT "CHK_board_members_name_mr"`);
    await q.query(`ALTER TABLE "board_members" DROP COLUMN "nameMr"`);
    await q.query(`ALTER TABLE "board_members" RENAME COLUMN "nameEn" TO "name"`);
    await q.query(`ALTER TABLE "board_members" ADD CONSTRAINT "CHK_board_members_name" CHECK ("name" IS NULL OR btrim("name") <> '')`);
  }
}
