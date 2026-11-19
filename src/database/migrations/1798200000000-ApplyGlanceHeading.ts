import type { MigrationInterface, QueryRunner } from 'typeorm';

/*
 * Apply page: the card beside the application steps is retitled from "At a glance" (लक्षात ठेवा) to
 * "For Your Information" (तुमच्या माहितीसाठी).
 *
 * Only the heading the CmsApplyPage migration inserted is matched: a heading an administrator wrote
 * in CMS -> Apply Page Management is left as it is.
 */
const OLD = { mr: 'लक्षात ठेवा', en: 'At a glance' };
const NEW = { mr: 'तुमच्या माहितीसाठी', en: 'For Your Information' };

export class ApplyGlanceHeading1798200000000 implements MigrationInterface {
  name = 'ApplyGlanceHeading1798200000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `UPDATE "apply_page_settings" SET "glanceHeadingMr" = $3, "glanceHeadingEn" = $4
       WHERE "glanceHeadingMr" = $1 AND "glanceHeadingEn" = $2`,
      [OLD.mr, OLD.en, NEW.mr, NEW.en],
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(
      `UPDATE "apply_page_settings" SET "glanceHeadingMr" = $3, "glanceHeadingEn" = $4
       WHERE "glanceHeadingMr" = $1 AND "glanceHeadingEn" = $2`,
      [NEW.mr, NEW.en, OLD.mr, OLD.en],
    );
  }
}
