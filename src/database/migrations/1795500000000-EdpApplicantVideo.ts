import type { MigrationInterface, QueryRunner } from 'typeorm';

/*
 * The EDP portal's "Applicant Video with Aadhaar" upload (optional): a Document Types master entry, non-mandatory, so
 * the Amrut admin panel's own form is unaffected. Which types the portal lists, their order, labels and whether each
 * is required are the portal's own list (EDP_DOCUMENTS). An existing row with the same code or name is left as it is.
 */
export class EdpApplicantVideo1795500000000 implements MigrationInterface {
  name = 'EdpApplicantVideo1795500000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `INSERT INTO "document_types" ("code", "name", "isMandatory", "description")
       SELECT $1::varchar, $2::varchar, false, $3::varchar
       WHERE NOT EXISTS (SELECT 1 FROM "document_types" WHERE "code" = $1::varchar OR lower("name") = lower($2::varchar))`,
      ['APPLICANT_VIDEO', 'Applicant Video with Aadhaar', 'Applicant holding the Aadhaar card (EDP portal, optional)'],
    );
  }

  public async down(): Promise<void> {
    /* Left in place: uploaded files or student records may reference the type by then. */
  }
}
