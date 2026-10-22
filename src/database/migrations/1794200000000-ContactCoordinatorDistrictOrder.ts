import type { MigrationInterface, QueryRunner } from 'typeorm';

/*
 * The order of the districts on a coordinator card. The public site lists each cluster's lead district
 * first (Pune, Satara, Kolhapur…), so the order an administrator saves is kept instead of sorting by name.
 */
export class ContactCoordinatorDistrictOrder1794200000000 implements MigrationInterface {
  name = 'ContactCoordinatorDistrictOrder1794200000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "contact_coordinator_districts" ADD COLUMN "displayOrder" integer NOT NULL DEFAULT 0`);
    await q.query(
      `ALTER TABLE "contact_coordinator_districts" ADD CONSTRAINT "CHK_contact_coordinator_districts_order" CHECK ("displayOrder" >= 0)`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "contact_coordinator_districts" DROP COLUMN IF EXISTS "displayOrder"`);
  }
}
