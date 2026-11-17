import type { MigrationInterface, QueryRunner } from 'typeorm';

/*
 * Removes the "demo environment" wording the website and admin panel inherited from the original
 * prototype:
 *
 *   - the ticker's seeded announcement ("DEMO ENVIRONMENT - SAMPLE DATA ...") is soft-deleted, as the
 *     admin panel's Delete would do — with no other announcement the website shows no strip;
 *   - the home page Live Dashboard's note under the section (the same sentence) is cleared — blank in
 *     both languages, which the website reads as "no note";
 *   - the footer's "— demonstration portal." copyright suffix is dropped, and its "Illustrative / demo
 *     data ..." line becomes "All rights reserved.";
 *   - the Eligibility page's note (already switched off by EligibilityNoteSwitch) loses its "in this
 *     demo" clause, so the CMS form no longer shows it either.
 *
 * Only rows that still hold EXACTLY the seeded text are touched: anything an administrator has typed
 * is left as it is. down() puts the seeded text back, again only where up()'s text is still in place.
 */
const ANNOUNCEMENT = {
  mr: 'प्रात्यक्षिक आवृत्ती - नमुना माहिती. ही वास्तविक शासकीय आकडेवारी नाही.',
  en: 'DEMO ENVIRONMENT - SAMPLE DATA. Not actual government programme performance.',
};

const DASHBOARD_DISCLAIMER = ANNOUNCEMENT;

const FOOTER = {
  copyright: {
    old: '© {year} AMRUT × SUMAGO INFOTECH PVT LTD — demonstration portal.',
    new: '© {year} AMRUT × SUMAGO INFOTECH PVT LTD.',
  },
  disclaimer: {
    old: 'Illustrative / demo data. No official emblem, seal or government endorsement is reproduced.',
    newMr: 'सर्व हक्क राखीव.',
    newEn: 'All rights reserved.',
  },
};

const ELIGIBILITY_NOTE = {
  oldMr:
    'वरील निकष प्रसिद्ध योजना रचनेवर आधारित असून प्रात्यक्षिक आवृत्तीत ते बदलण्यायोग्य प्रणाली-मापदंड म्हणून ठेवले आहेत. अंतिम निकष अमृतच्या मान्यतेनुसार लागू होतील.',
  oldEn:
    'These criteria follow the published scheme structure and are held as configurable system parameters in this demo. Final criteria apply as approved by AMRUT.',
  newMr: 'वरील निकष प्रसिद्ध योजना रचनेवर आधारित आहेत. अंतिम निकष अमृतच्या मान्यतेनुसार लागू होतील.',
  newEn: 'These criteria follow the published scheme structure. Final criteria apply as approved by AMRUT.',
};

export class RemoveDemoWording1797900000000 implements MigrationInterface {
  name = 'RemoveDemoWording1797900000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `UPDATE "announcements" SET "isDelete" = true, "isActive" = false
       WHERE "isDelete" = false AND "titleMr" = $1 AND "titleEn" = $2`,
      [ANNOUNCEMENT.mr, ANNOUNCEMENT.en],
    );

    await q.query(
      `UPDATE "live_dashboard_settings" SET "disclaimerMr" = '', "disclaimerEn" = ''
       WHERE "disclaimerMr" = $1 AND "disclaimerEn" = $2`,
      [DASHBOARD_DISCLAIMER.mr, DASHBOARD_DISCLAIMER.en],
    );

    await q.query(
      `UPDATE "footer_settings" SET "copyrightMr" = $2, "copyrightEn" = $2
       WHERE "copyrightMr" = $1 AND "copyrightEn" = $1`,
      [FOOTER.copyright.old, FOOTER.copyright.new],
    );
    await q.query(
      `UPDATE "footer_settings" SET "disclaimerMr" = $2, "disclaimerEn" = $3
       WHERE "disclaimerMr" = $1 AND "disclaimerEn" = $1`,
      [FOOTER.disclaimer.old, FOOTER.disclaimer.newMr, FOOTER.disclaimer.newEn],
    );

    await q.query(
      `UPDATE "eligibility_page_settings" SET "noteBodyMr" = $3, "noteBodyEn" = $4
       WHERE "noteBodyMr" = $1 AND "noteBodyEn" = $2`,
      [ELIGIBILITY_NOTE.oldMr, ELIGIBILITY_NOTE.oldEn, ELIGIBILITY_NOTE.newMr, ELIGIBILITY_NOTE.newEn],
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(
      `UPDATE "eligibility_page_settings" SET "noteBodyMr" = $1, "noteBodyEn" = $2
       WHERE "noteBodyMr" = $3 AND "noteBodyEn" = $4`,
      [ELIGIBILITY_NOTE.oldMr, ELIGIBILITY_NOTE.oldEn, ELIGIBILITY_NOTE.newMr, ELIGIBILITY_NOTE.newEn],
    );

    await q.query(
      `UPDATE "footer_settings" SET "disclaimerMr" = $1, "disclaimerEn" = $1
       WHERE "disclaimerMr" = $2 AND "disclaimerEn" = $3`,
      [FOOTER.disclaimer.old, FOOTER.disclaimer.newMr, FOOTER.disclaimer.newEn],
    );
    await q.query(
      `UPDATE "footer_settings" SET "copyrightMr" = $1, "copyrightEn" = $1
       WHERE "copyrightMr" = $2 AND "copyrightEn" = $2`,
      [FOOTER.copyright.old, FOOTER.copyright.new],
    );

    await q.query(
      `UPDATE "live_dashboard_settings" SET "disclaimerMr" = $1, "disclaimerEn" = $2
       WHERE "disclaimerMr" = '' AND "disclaimerEn" = ''`,
      [DASHBOARD_DISCLAIMER.mr, DASHBOARD_DISCLAIMER.en],
    );

    await q.query(
      `UPDATE "announcements" SET "isDelete" = false, "isActive" = true
       WHERE "isDelete" = true AND "titleMr" = $1 AND "titleEn" = $2`,
      [ANNOUNCEMENT.mr, ANNOUNCEMENT.en],
    );
  }
}
