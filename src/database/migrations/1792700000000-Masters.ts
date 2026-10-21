import type { MigrationInterface, QueryRunner } from 'typeorm';

/*
 * Reference-data masters: regions (= course centres), castes, document_types and educations.
 * - Code and name are unique across every row, soft-deleted ones included, so a deleted record's values stay reserved.
 * - Seeded with the lists the import used until now (frozen here, so later edits to the constants do not change this
 *   migration): the 36 centres, the 27 castes (codes C01–C27 in source order) and the 13 document types. No education
 *   list has been supplied, so educations starts empty.
 * - students gains nullable regionId / casteId / educationId foreign keys (ON DELETE RESTRICT), backfilled by
 *   matching the existing text values. The text columns stay, so history still displays.
 */
const CENTRES: [string, string][] = [
  ['NDB', 'Nandurbar'],
  ['DHU', 'Dhule'],
  ['JAL', 'Jalgaon'],
  ['BUL', 'Buldhana'],
  ['AKO', 'Akola'],
  ['AMR', 'Amravati'],
  ['NAG', 'Nagpur'],
  ['BHA', 'Bhandara'],
  ['GON', 'Gondia'],
  ['PAL', 'Palghar'],
  ['NAS', 'Nashik'],
  ['WAS', 'Washim'],
  ['YAV', 'Yavatmal'],
  ['WAR', 'Wardha'],
  ['CHA', 'Chandrapur'],
  ['GAD', 'Gadchiroli'],
  ['MUS', 'Mumbai Suburban'],
  ['THA', 'Thane'],
  ['CSN', 'Chhatrapati Sambhajinagar'],
  ['JLN', 'Jalna'],
  ['HIN', 'Hingoli'],
  ['PAR', 'Parbhani'],
  ['NAN', 'Nanded'],
  ['MUC', 'Mumbai City'],
  ['RAI', 'Raigad'],
  ['PUN', 'Pune'],
  ['AHL', 'Ahilyanagar'],
  ['BEE', 'Beed'],
  ['LAT', 'Latur'],
  ['DHA', 'Dharashiv'],
  ['RAT', 'Ratnagiri'],
  ['SAT', 'Satara'],
  ['SOL', 'Solapur'],
  ['SIN', 'Sindhudurg'],
  ['KOL', 'Kolhapur'],
  ['SAN', 'Sangli'],
];

const CASTES = [
  'मराठी',
  'राजपूत',
  'अय्यंगार',
  'बनिया',
  'बंगाली',
  'ठाकूर',
  'राजपुरोहित',
  'हिंदू नेपाळी',
  'नायडू',
  'सेनगुप्तर',
  'कानबी',
  'ब्राह्मण',
  'भूमिहार',
  'यलमार',
  'सिंधी',
  'त्यागी',
  'जाट',
  'नायर',
  'कायस्थ',
  'कम्मा',
  'पटेल',
  'पाटीदार',
  'गुजराथी',
  'कोमटी/वैश्य',
  'लोहाणा',
  'हिंदू वेरशैव लिंगायत',
  'अग्रवाल',
];

/* [code, name, mandatory, description]; PAN, Aadhaar and LC (Leaving Certificate) are among them. */
const DOCUMENT_TYPES: [string, string, boolean, string | null][] = [
  ['PHOTO', 'Photo', true, null],
  ['SIGNATURE', 'Signature', true, null],
  ['INCOME_EWS', 'Income Certificate / EWS', true, null],
  ['DOMICILE', 'Domicile Certificate', true, null],
  ['AADHAAR_CARD', 'Aadhaar Card', true, 'Aadhaar'],
  ['PAN_CARD', 'PAN Card', false, 'PAN'],
  ['SCHOOL_LEAVING', 'School Leaving / Transfer Certificate', true, 'LC (Leaving Certificate)'],
  ['NAME_CHANGE', 'Change in Name (Gazette / Marriage Certificate)', false, null],
  ['EDU_CERT', 'Highest Education Qualification Certificate', true, null],
  ['OTHER', 'Other Required Document', false, null],
  ['FITNESS', 'Physical Fitness Certificate', true, null],
  ['SELF_DECLARATION', 'Self-Declaration Form', true, null],
  ['CASTE_CERT', 'Caste Certificate', true, null],
];

const TABLES: { table: string; codeLen: number; nameLen: number; extra?: string }[] = [
  { table: 'regions', codeLen: 20, nameLen: 150 },
  { table: 'castes', codeLen: 20, nameLen: 150 },
  { table: 'document_types', codeLen: 20, nameLen: 150, extra: `"isMandatory" boolean NOT NULL DEFAULT false,` },
  { table: 'educations', codeLen: 20, nameLen: 150 },
];

const FKS: [column: string, table: string][] = [
  ['regionId', 'regions'],
  ['casteId', 'castes'],
  ['educationId', 'educations'],
];

export class Masters1792700000000 implements MigrationInterface {
  name = 'Masters1792700000000';

  public async up(q: QueryRunner): Promise<void> {
    for (const t of TABLES) {
      await q.query(`
        CREATE TABLE "${t.table}" (
          "id"          uuid        NOT NULL DEFAULT gen_random_uuid(),
          "createdAt"   timestamptz NOT NULL DEFAULT now(),
          "updatedAt"   timestamptz NOT NULL DEFAULT now(),
          "isDelete"    boolean     NOT NULL DEFAULT false,
          "isActive"    boolean     NOT NULL DEFAULT true,
          "code"        varchar(${t.codeLen}) NOT NULL,
          "name"        varchar(${t.nameLen}) NOT NULL,
          "description" varchar(500) NULL,
          ${t.extra ?? ''}
          CONSTRAINT "PK_${t.table}" PRIMARY KEY ("id"),
          CONSTRAINT "CHK_${t.table}_code_upper" CHECK ("code" = upper("code"))
        )`);
      /* No isDelete filter: values of soft-deleted records stay reserved. */
      await q.query(`CREATE UNIQUE INDEX "UQ_${t.table}_code" ON "${t.table}" ("code")`);
      await q.query(`CREATE UNIQUE INDEX "UQ_${t.table}_name_lower" ON "${t.table}" (lower("name"))`);
      /* Dropdowns: active, non-deleted, by name. */
      await q.query(`CREATE INDEX "IDX_${t.table}_options" ON "${t.table}" ("name") WHERE "isDelete" = false AND "isActive" = true`);
    }
    /* Region codes are stored in students.centreCode varchar(10); caste names in students.caste varchar(80). */
    await q.query(`ALTER TABLE "regions" ADD CONSTRAINT "CHK_regions_code_len" CHECK (char_length("code") <= 10)`);
    await q.query(`ALTER TABLE "castes" ADD CONSTRAINT "CHK_castes_name_len" CHECK (char_length("name") <= 80)`);

    for (const [code, name] of CENTRES) await q.query(`INSERT INTO "regions" ("code", "name") VALUES ($1, $2)`, [code, name]);
    for (const [i, name] of CASTES.entries())
      await q.query(`INSERT INTO "castes" ("code", "name") VALUES ($1, $2)`, ['C' + String(i + 1).padStart(2, '0'), name.normalize('NFC')]);
    for (const [code, name, mandatory, description] of DOCUMENT_TYPES)
      await q.query(`INSERT INTO "document_types" ("code", "name", "isMandatory", "description") VALUES ($1, $2, $3, $4)`, [
        code,
        name,
        mandatory,
        description,
      ]);

    for (const [col, table] of FKS) {
      await q.query(`ALTER TABLE "students" ADD COLUMN "${col}" uuid NULL`);
      await q.query(
        `ALTER TABLE "students" ADD CONSTRAINT "FK_students_${col}" FOREIGN KEY ("${col}") REFERENCES "${table}"("id") ON DELETE RESTRICT`,
      );
      await q.query(`CREATE INDEX "IDX_students_${col}" ON "students" ("${col}")`);
    }
    await q.query(`UPDATE "students" s SET "regionId" = r."id" FROM "regions" r WHERE upper(s."centreCode") = r."code"`);
    await q.query(`UPDATE "students" s SET "casteId" = c."id" FROM "castes" c WHERE lower(s."caste") = lower(c."name")`);
    await q.query(
      `UPDATE "students" s SET "educationId" = e."id" FROM "educations" e WHERE lower(s."educationQualification") = lower(e."name")`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const [col] of FKS) await q.query(`ALTER TABLE "students" DROP COLUMN "${col}"`);
    for (const t of [...TABLES].reverse()) await q.query(`DROP TABLE "${t.table}"`);
  }
}
