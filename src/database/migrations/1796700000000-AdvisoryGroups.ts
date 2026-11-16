import type { MigrationInterface, QueryRunner } from 'typeorm';

/*
 * Advisory Committee: groups — headings the website lists members under, such as "ACADEMY OF
 * MAHARASHTRA RESEARCH, UPLIFTMENT AND TRAINING (AMRUT)". Optional: a member without a group is shown
 * first, under no heading.
 *
 * - "advisory_groups": a name required in both languages (it is printed as the heading for every
 *   visitor), a display order, and the usual flags — "isActive" = shown on the website; a hidden group
 *   hides its heading AND its members.
 * - One live group per English name (case-insensitive), so two headings cannot read the same.
 * - "advisory_members"."groupId" is the member's group, NULL for none. Groups are soft-deleted, and the
 *   service ungroups a deleted group's members in the same transaction; ON DELETE SET NULL only covers a
 *   hard delete by hand.
 *
 * Creates a table and a nullable column; no existing row changes, so every member starts ungrouped
 * and the website looks exactly as before. No groups are seeded.
 */
export class AdvisoryGroups1796700000000 implements MigrationInterface {
  name = 'AdvisoryGroups1796700000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE "advisory_groups" (
        "id"           uuid         NOT NULL DEFAULT gen_random_uuid(),
        "createdAt"    timestamptz  NOT NULL DEFAULT now(),
        "updatedAt"    timestamptz  NOT NULL DEFAULT now(),
        "isDelete"     boolean      NOT NULL DEFAULT false,
        "isActive"     boolean      NOT NULL DEFAULT true,
        "nameMr"       varchar(200) NOT NULL,
        "nameEn"       varchar(200) NOT NULL,
        "displayOrder" integer      NOT NULL DEFAULT 0,
        CONSTRAINT "PK_advisory_groups" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_advisory_groups_name_mr" CHECK (btrim("nameMr") <> ''),
        CONSTRAINT "CHK_advisory_groups_name_en" CHECK (btrim("nameEn") <> ''),
        CONSTRAINT "CHK_advisory_groups_order" CHECK ("displayOrder" >= 0)
      )`);
    await q.query(`CREATE UNIQUE INDEX "UQ_advisory_groups_name" ON "advisory_groups" (lower("nameEn")) WHERE "isDelete" = false`);
    await q.query(
      `CREATE TRIGGER "TRG_advisory_groups_updated_at" BEFORE UPDATE ON "advisory_groups" FOR EACH ROW EXECUTE FUNCTION "set_updated_at"()`,
    );

    await q.query(`ALTER TABLE "advisory_members" ADD COLUMN "groupId" uuid NULL`);
    await q.query(
      `ALTER TABLE "advisory_members" ADD CONSTRAINT "FK_advisory_members_group"
         FOREIGN KEY ("groupId") REFERENCES "advisory_groups"("id") ON DELETE SET NULL`,
    );
    await q.query(`CREATE INDEX "IDX_advisory_members_groupId" ON "advisory_members" ("groupId")`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS "IDX_advisory_members_groupId"`);
    await q.query(`ALTER TABLE "advisory_members" DROP CONSTRAINT IF EXISTS "FK_advisory_members_group"`);
    await q.query(`ALTER TABLE "advisory_members" DROP COLUMN IF EXISTS "groupId"`);
    await q.query(`DROP TABLE IF EXISTS "advisory_groups"`);
  }
}
