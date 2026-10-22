import type { Express } from 'express';
import { AppDataSource } from '../../../src/config/database.config';
import { seedTrainerProfileFields } from '../../../src/database/migrations/1792720000000-LmsFormFields';
import { FORM_FIELD_VALUE_SOURCES, type FormFieldValueSource } from '../../../src/lms/form-field/form-field.values';
import { API, actorWith, auth, request, setupTestApp, superAdmin, teardownTestApp, type TestActor } from '../../helpers/test-app';

/*
 * Form Field Configuration (AMRUT_KALASH_03 L-38 / FR-338 / F-LMS-FFC, DB-305) — /api/v1/lms/form-fields.
 * Fixture: the Trainer Profile's standard fields, seeded by the migration (BRL-349). setupTestApp empties every
 * table between test files, so the migration's seed is applied again here.
 */
const BASE = `${API}/lms/form-fields`;
const EFFECTIVE = `${BASE}/forms/TRAINER_PROFILE/effective`;
const MISSING_ID = '00000000-0000-4000-8000-000000000000';
const STANDARD_COUNT = 26;

let app: Express;
let admin: TestActor;
let viewer: TestActor;
let nobody: TestActor;

interface FieldBody {
  formCode?: string;
  fieldCode?: string;
  label?: string;
  helpText?: string | null;
  translations?: Record<string, unknown>;
  sectionCode?: string;
  sortOrder?: number;
  dataType?: string;
  options?: string[] | null;
  rules?: Record<string, unknown>;
  isVisible?: boolean;
  isRequired?: boolean;
  requiredStage?: string;
  sensitivity?: string;
  isExportable?: boolean;
  isActive?: boolean;
}

const create = (body: FieldBody, token = admin.token) => request(app).post(BASE).set(auth(token)).send({ formCode: 'TRAINER_PROFILE', sectionCode: 'A', ...body });
const patch = (id: string, body: Record<string, unknown>, token = admin.token) => request(app).patch(`${BASE}/${id}`).set(auth(token)).send(body);

async function makeField(body: FieldBody): Promise<{ id: string; fieldCode: string; label: string }> {
  const res = await create(body);
  if (res.status !== 201) throw new Error(`makeField failed (${res.status}): ${JSON.stringify(res.body)}`);
  return res.body.data;
}

async function idOf(fieldCode: string): Promise<string> {
  const rows: { id: string }[] = await AppDataSource.query(
    `SELECT "id" FROM "lms_form_fields" WHERE "formCode" = 'TRAINER_PROFILE' AND "fieldCode" = $1 AND "isDelete" = false`,
    [fieldCode],
  );
  return rows[0].id;
}

const fields = (res: { body: { error: { details?: { field: string }[] } } }) => (res.body.error.details ?? []).map((d) => d.field);

beforeAll(async () => {
  app = await setupTestApp();
  await seedTrainerProfileFields(AppDataSource);
  admin = await superAdmin();
  viewer = await actorWith(['lms-form-fields.view']);
  nobody = await actorWith(['lms-reference.view']);
});
afterAll(teardownTestApp);

describe('Form Field Configuration — seeded Trainer Profile (BRL-349)', () => {
  it('lists every standard field optional and visible except Trainer Name, which is system-locked and compulsory on save', async () => {
    await seedTrainerProfileFields(AppDataSource); /* idempotent */
    const res = await request(app).get(BASE).query({ formCode: 'TRAINER_PROFILE', limit: 100 }).set(auth(viewer.token));
    expect(res.status).toBe(200);
    expect(res.body.meta.total).toBe(STANDARD_COUNT);
    const rows: { fieldCode: string; isRequired: boolean; isVisible: boolean; isSystemLocked: boolean; isCustom: boolean; requiredStage: string }[] = res.body.data;
    expect(rows.every((r) => !r.isCustom && r.isVisible)).toBe(true);
    expect(rows.filter((r) => r.isRequired).map((r) => r.fieldCode)).toEqual(['full_name']);
    expect(rows.filter((r) => r.isSystemLocked).map((r) => r.fieldCode)).toEqual(['full_name']);
    expect(rows.filter((r) => r.requiredStage === 'ON_SAVE').map((r) => r.fieldCode)).toEqual(['full_name']);
    /* Default sort: section then order. */
    expect(rows[0]).toMatchObject({ fieldCode: 'full_name', sectionCode: 'A', sectionLabel: 'Basic personal details', formLabel: 'Trainer Profile' });
    expect(rows[rows.length - 1]).toMatchObject({ fieldCode: 'signed_copy', sectionCode: 'VERIFICATION', sensitivity: 'RESTRICTED', dataType: 'FILE' });
  });

  it('serves the form options: forms with their sections, custom data types with their rules, stages, sensitivities', async () => {
    const res = await request(app).get(`${BASE}/form-options`).set(auth(viewer.token));
    expect(res.status).toBe(200);
    expect(res.body.data.forms).toHaveLength(1);
    expect(res.body.data.forms[0]).toMatchObject({ code: 'TRAINER_PROFILE', specRef: 'F-LMS-TRN' });
    expect(res.body.data.forms[0].sections.map((s: { code: string }) => s.code)).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'VERIFICATION']);
    expect(res.body.data.customDataTypes.map((t: { code: string }) => t.code)).toEqual([
      'TEXT', 'LONG_TEXT', 'NUMBER', 'DATE', 'YES_NO', 'SINGLE_CHOICE', 'MULTIPLE_CHOICE', 'FILE',
    ]);
    expect(res.body.data.customDataTypes).toContainEqual({ code: 'NUMBER', rules: ['min', 'max', 'integer'], hasOptions: false });
    expect(res.body.data.customDataTypes).toContainEqual({ code: 'SINGLE_CHOICE', rules: [], hasOptions: true });
    expect(res.body.data).toMatchObject({ requiredStages: ['ON_SAVE', 'ON_VERIFICATION'], sensitivities: ['INTERNAL', 'PERSONAL', 'RESTRICTED'] });
    expect(res.body.data.fileConstraints).toEqual({ extensions: ['pdf', 'jpg', 'jpeg', 'png'], mimeTypes: ['application/pdf', 'image/jpeg', 'image/png'], maxBytes: 5242880 });
  });

  it('returns the effective configuration: visible active fields by section, in display order', async () => {
    const res = await request(app).get(EFFECTIVE).set(auth(viewer.token));
    expect(res.status).toBe(200);
    expect(res.body.data.form).toEqual({ code: 'TRAINER_PROFILE', label: 'Trainer Profile', specRef: 'F-LMS-TRN' });
    expect(res.body.data.sections.map((s: { code: string }) => s.code)).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'VERIFICATION']);
    const a = res.body.data.sections[0];
    expect(a.fields.map((f: { fieldCode: string }) => f.fieldCode).slice(0, 3)).toEqual(['full_name', 'designation', 'trainer_code']);
    expect(a.fields[0]).toMatchObject({ isRequired: true, requiredStage: 'ON_SAVE', isSystemLocked: true });
    expect(a.fields[1]).toMatchObject({ isRequired: false, requiredStage: null });
    const verification = res.body.data.sections[8];
    expect(verification.fields[1]).toMatchObject({ fieldCode: 'signed_copy', rules: { maxBytes: 5242880 } });
    const g = res.body.data.sections[6];
    expect(g.fields[0]).toMatchObject({ fieldCode: 'competency', isExportable: false });

    expect((await request(app).get(`${BASE}/forms/CENTRE_PROFILE/effective`).set(auth(viewer.token))).status).toBe(422);
  });
});

describe('Form Field Configuration — custom fields', () => {
  it("adds a custom field ('Preferred shift', single choice) at the end of its section, audited as custom_added", async () => {
    const res = await create({
      fieldCode: 'preferred_shift',
      label: '  Preferred   shift ',
      helpText: 'Shift the trainer prefers',
      translations: { mr: { label: 'पसंतीची पाळी' } },
      dataType: 'SINGLE_CHOICE',
      options: ['Morning', 'Afternoon', 'Evening'],
    });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      fieldCode: 'preferred_shift',
      label: 'Preferred shift',
      isCustom: true,
      isSystemLocked: false,
      sectionCode: 'A',
      sortOrder: 10,
      dataType: 'SINGLE_CHOICE',
      options: ['Morning', 'Afternoon', 'Evening'],
      rules: {},
      isVisible: true,
      isRequired: false,
      requiredStage: 'ON_VERIFICATION',
      sensitivity: 'INTERNAL',
      isExportable: true,
      isActive: true,
      storedValues: 0,
      typeLocked: false,
      translations: { mr: { label: 'पसंतीची पाळी' } },
    });
    const audit: { action: string; actorUserId: string; details: { event: string; field: string } }[] = await AppDataSource.query(
      `SELECT "action", "actorUserId", "details" FROM "audit_logs" WHERE "resource" = 'lms-form-field' AND "resourceId" = $1`,
      [res.body.data.id],
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: 'lms.form-field.create', actorUserId: admin.user.id, details: { event: 'config.form_field.custom_added', field: 'preferred_shift' } });

    /* It appears on the form in its section (L-38 acceptance). */
    const eff = await request(app).get(EFFECTIVE).set(auth(viewer.token));
    expect(eff.body.data.sections[0].fields.map((f: { fieldCode: string }) => f.fieldCode)).toContain('preferred_shift');
  });

  it('checks options and rules against the data type, and refuses invalid fields with 422 and the field name', async () => {
    const bad = async (body: FieldBody & Record<string, unknown>, field: string) => {
      const res = await create({ fieldCode: 'valid_key', label: 'Valid label', ...body });
      expect(res.status).toBe(422);
      expect(fields(res)).toContain(field);
    };
    await bad({ formCode: 'CENTRE_PROFILE' }, 'body.formCode');
    await bad({ fieldCode: 'Bad-Key' }, 'body.fieldCode');
    await bad({ fieldCode: '1abc' }, 'body.fieldCode');
    await bad({ label: '   ' }, 'body.label');
    await bad({ label: 'x'.repeat(81) }, 'body.label');
    await bad({ helpText: 'x'.repeat(201) }, 'body.helpText');
    await bad({ translations: { fr: { label: 'Libellé' } } }, 'body.translations.fr');
    await bad({ sectionCode: 'a b' }, 'body.sectionCode');
    await bad({ sortOrder: -1 }, 'body.sortOrder');
    await bad({ dataType: 'EMAIL' }, 'body.dataType');
    await bad({ requiredStage: 'ALWAYS' }, 'body.requiredStage');
    await bad({ sensitivity: 'SECRET' }, 'body.sensitivity');
    await bad({ isSystemLocked: true }, 'body');
    await bad({ dataType: 'SINGLE_CHOICE' }, 'body.options');
    await bad({ dataType: 'MULTIPLE_CHOICE', options: [] }, 'body.options');
    await bad({ dataType: 'SINGLE_CHOICE', options: ['Yes', 'yes'] }, 'body.options');
    await bad({ dataType: 'TEXT', options: ['A'] }, 'body.options');
    /* min / max only for numbers, pattern only for text, selection counts only for multiple choice. */
    await bad({ dataType: 'TEXT', rules: { min: 1 } }, 'body.rules');
    await bad({ dataType: 'NUMBER', rules: { pattern: '^a' } }, 'body.rules');
    await bad({ dataType: 'LONG_TEXT', rules: { pattern: '^a' } }, 'body.rules');
    await bad({ dataType: 'YES_NO', rules: { maxLength: 3 } }, 'body.rules');
    await bad({ dataType: 'TEXT', rules: { pattern: '(' } }, 'body.rules.pattern');
    await bad({ dataType: 'TEXT', rules: { minLength: 10, maxLength: 5 } }, 'body.rules.minLength');
    await bad({ dataType: 'NUMBER', rules: { min: 10, max: 1 } }, 'body.rules.min');
    await bad({ dataType: 'NUMBER', rules: { min: 'one' } }, 'body.rules.min');
    await bad({ dataType: 'DATE', rules: { minDate: '2026-02-30' } }, 'body.rules.minDate');
    await bad({ dataType: 'MULTIPLE_CHOICE', options: ['A', 'B'], rules: { maxSelected: 3 } }, 'body.rules.maxSelected');
    /* F-LMS-FFC-05: a hidden field cannot be compulsory. */
    const hidden = await create({ fieldCode: 'valid_key', label: 'Valid label', isVisible: false, isRequired: true });
    expect(hidden.status).toBe(422);
    expect(hidden.body.error.details).toEqual([{ field: 'body.isRequired', message: 'A hidden field cannot be compulsory.' }]);

    const missing = await request(app).post(BASE).set(auth(admin.token)).send({});
    expect(missing.status).toBe(422);
    expect(fields(missing)).toEqual(expect.arrayContaining(['body.formCode', 'body.fieldCode', 'body.label', 'body.sectionCode']));
  });

  it('accepts typed rules for each type and a custom section', async () => {
    const num = await create({ fieldCode: 'shift_hours', label: 'Shift hours', dataType: 'NUMBER', rules: { min: 0, max: 12, integer: true }, sectionCode: 'x_extra' });
    expect(num.status).toBe(201);
    expect(num.body.data).toMatchObject({ rules: { min: 0, max: 12, integer: true }, sectionCode: 'X_EXTRA', sectionLabel: 'X_EXTRA', sortOrder: 1, options: null });
    const text = await create({ fieldCode: 'pan_number', label: 'PAN', rules: { pattern: '^[A-Z]{5}[0-9]{4}[A-Z]$', maxLength: 10 }, sensitivity: 'RESTRICTED', isExportable: false });
    expect(text.status).toBe(201);
    expect(text.body.data).toMatchObject({ dataType: 'TEXT', sensitivity: 'RESTRICTED', isExportable: false });
    const date = await create({ fieldCode: 'police_check_on', label: 'Police verification date', dataType: 'DATE', rules: { notInFuture: true }, isRequired: true, requiredStage: 'ON_SAVE' });
    expect(date.status).toBe(201);
    const multi = await create({ fieldCode: 'shift_days', label: 'Available days', dataType: 'MULTIPLE_CHOICE', options: ['Mon', 'Tue', 'Wed'], rules: { minSelected: 1, maxSelected: 3 } });
    expect(multi.status).toBe(201);
    const file = await create({ fieldCode: 'nda_copy', label: 'Signed NDA', dataType: 'FILE', sectionCode: 'VERIFICATION' });
    expect(file.status).toBe(201);
    expect(file.body.data.sortOrder).toBe(3);

    const eff = await request(app).get(EFFECTIVE).set(auth(viewer.token));
    const codes = eff.body.data.sections.map((s: { code: string }) => s.code);
    expect(codes[codes.length - 1]).toBe('X_EXTRA');
    expect(eff.body.data.sections[codes.length - 1]).toMatchObject({ isCustomSection: true, fields: [{ fieldCode: 'shift_hours', rules: { min: 0, max: 12, integer: true } }] });
    const nda = eff.body.data.sections.find((s: { code: string }) => s.code === 'VERIFICATION').fields.find((f: { fieldCode: string }) => f.fieldCode === 'nda_copy');
    expect(nda.rules).toEqual({ extensions: ['pdf', 'jpg', 'jpeg', 'png'], mimeTypes: ['application/pdf', 'image/jpeg', 'image/png'], maxBytes: 5242880 });
    const police = eff.body.data.sections[0].fields.find((f: { fieldCode: string }) => f.fieldCode === 'police_check_on');
    expect(police).toMatchObject({ isRequired: true, requiredStage: 'ON_SAVE' });
  });

  it('keeps the field key and the label unique within the form (409 with the field)', async () => {
    const key = await create({ fieldCode: 'designation', label: 'Another label' });
    expect(key.status).toBe(409);
    expect(key.body.error.details).toEqual([{ field: 'fieldCode', message: 'This field key is already used in the form.' }]);
    const lbl = await create({ fieldCode: 'another_key', label: 'TRAINER name' });
    expect(lbl.status).toBe(409);
    expect(lbl.body.error.details).toEqual([{ field: 'label', message: 'This label is already used in the form.' }]);

    const f = await makeField({ fieldCode: 'rename_me', label: 'Rename me' });
    const clash = await patch(f.id, { label: 'Official email' });
    expect(clash.status).toBe(409);
    expect(clash.body.error.details[0]).toMatchObject({ field: 'label' });
    /* Changing only the case of its own label is not a clash. */
    expect((await patch(f.id, { label: 'RENAME ME' })).status).toBe(200);
  });

  it('keeps the label unique within the form in every platform language (F-LMS-FFC-03 per language)', async () => {
    const mrClash = { field: 'translations.mr.label', message: 'This label is already used in the form in Marathi.' };
    const x = await makeField({ fieldCode: 'roster_slot', label: 'Roster slot', translations: { mr: { label: 'पाळी' } } });

    /* The same Marathi label on another field of the form. */
    const mr = await create({ fieldCode: 'roster_slot_two', label: 'Roster slot two', translations: { mr: { label: 'पाळी' } } });
    expect(mr.status).toBe(409);
    expect(mr.body.error.details).toEqual([mrClash]);
    /* An English override cannot take another field's label either. */
    const en = await create({ fieldCode: 'roster_slot_two', label: 'Roster slot two', translations: { en: { label: 'trainer NAME' } } });
    expect(en.status).toBe(409);
    expect(en.body.error.details).toEqual([{ field: 'translations.en.label', message: 'This label is already used in the form in English.' }]);
    /* A translation that is another field's base label (shown in Marathi while it has no translation). */
    const base = await create({ fieldCode: 'roster_slot_two', label: 'Roster slot two', translations: { mr: { label: 'Official email' } } });
    expect(base.status).toBe(409);
    expect(base.body.error.details).toEqual([mrClash]);
    /* A base label that another field shows in Marathi, on a field without a Marathi label. */
    const shown = await create({ fieldCode: 'roster_slot_two', label: 'पाळी' });
    expect(shown.status).toBe(409);
    expect(shown.body.error.details).toEqual([{ field: 'label', message: 'This label is already used in the form in Marathi.' }]);

    /* Update: translations are checked, a re-save of its own labels is not a clash. */
    const y = await makeField({ fieldCode: 'roster_slot_two', label: 'Roster slot two' });
    const upd = await patch(y.id, { translations: { mr: { label: 'पाळी' } } });
    expect(upd.status).toBe(409);
    expect(upd.body.error.details).toEqual([mrClash]);
    expect((await patch(x.id, { label: 'Roster slot', translations: { mr: { label: 'पाळी' } } })).status).toBe(200);
    expect((await patch(y.id, { translations: { mr: { label: 'दुसरी पाळी' } } })).status).toBe(200);

    /* Restore: refused when its Marathi label was taken meanwhile. */
    await request(app).delete(`${BASE}/${y.id}`).set(auth(admin.token)).expect(200);
    await makeField({ fieldCode: 'roster_slot_three', label: 'Roster slot three', translations: { mr: { label: 'दुसरी पाळी' } } });
    const restored = await request(app).post(`${BASE}/${y.id}/restore`).set(auth(admin.token));
    expect(restored.status).toBe(409);
    expect(restored.body.error.details).toEqual([mrClash]);
  });
});

describe('Form Field Configuration — field rules', () => {
  it('makes a standard field compulsory on every save and audits before / after', async () => {
    const id = await idOf('designation');
    const res = await patch(id, { isRequired: true, requiredStage: 'ON_SAVE', label: 'Designation / Role', sortOrder: 2 });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ isRequired: true, requiredStage: 'ON_SAVE', label: 'Designation / Role', isCustom: false });
    const audit: { action: string; details: { event: string; before: Record<string, unknown>; after: Record<string, unknown> } }[] = await AppDataSource.query(
      `SELECT "action", "details" FROM "audit_logs" WHERE "resource" = 'lms-form-field' AND "resourceId" = $1`,
      [id],
    );
    expect(audit).toEqual([
      {
        action: 'lms.form-field.update',
        details: expect.objectContaining({
          event: 'config.form_field.updated',
          form: 'TRAINER_PROFILE',
          field: 'designation',
          before: { isRequired: false, requiredStage: 'ON_VERIFICATION', label: 'Designation' },
          after: { isRequired: true, requiredStage: 'ON_SAVE', label: 'Designation / Role' },
        }),
      },
    ]);

    /* Hidden + compulsory is refused; hiding needs the compulsory rule off first (or in the same request). */
    const hide = await patch(id, { isVisible: false });
    expect(hide.status).toBe(422);
    expect(hide.body.error.details).toEqual([{ field: 'body.isRequired', message: 'A hidden field cannot be compulsory.' }]);
    const both = await patch(id, { isVisible: false, isRequired: false });
    expect(both.status).toBe(200);
    const eff = await request(app).get(EFFECTIVE).set(auth(viewer.token));
    expect(eff.body.data.sections[0].fields.map((f: { fieldCode: string }) => f.fieldCode)).not.toContain('designation');
    await patch(id, { isVisible: true }).expect(200);
  });

  it('keeps Trainer Name visible and compulsory on save (FIELD_SYSTEM_LOCKED) but lets its label change', async () => {
    const id = await idOf('full_name');
    for (const body of [{ isVisible: false }, { isRequired: false }, { requiredStage: 'ON_VERIFICATION' }]) {
      const res = await patch(id, body);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('FIELD_SYSTEM_LOCKED');
      expect(res.body.error.details[0].field).toBe(Object.keys(body)[0]);
    }
    expect((await request(app).patch(`${BASE}/${id}/status`).set(auth(admin.token)).send({ isActive: false })).status).toBe(409);
    const relabel = await patch(id, { label: 'Full name of the trainer', isVisible: true, isRequired: true });
    expect(relabel.status).toBe(200);
    expect(relabel.body.data).toMatchObject({ label: 'Full name of the trainer', isVisible: true, isRequired: true, requiredStage: 'ON_SAVE' });
  });

  it("refuses to change a standard field's type, options, rules or classification (FIELD_STANDARD), but accepts the same values", async () => {
    const id = await idOf('email');
    for (const body of [{ dataType: 'TEXT' }, { options: ['a'] }, { rules: { maxLength: 5 } }, { sensitivity: 'INTERNAL' }, { isExportable: false }]) {
      const res = await patch(id, body);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('FIELD_STANDARD');
    }
    expect((await patch(id, { sensitivity: 'PERSONAL', options: null, rules: {}, isRequired: true })).status).toBe(200);
  });

  it('changes the type of a custom field without values, carrying options between choice types and resetting rules', async () => {
    const f = await makeField({ fieldCode: 'shift_mode', label: 'Shift mode', dataType: 'SINGLE_CHOICE', options: ['Day', 'Night'] });
    const multi = await patch(f.id, { dataType: 'MULTIPLE_CHOICE' });
    expect(multi.status).toBe(200);
    expect(multi.body.data).toMatchObject({ dataType: 'MULTIPLE_CHOICE', options: ['Day', 'Night'] });
    const tooMany = await patch(f.id, { rules: { maxSelected: 3 } });
    expect(tooMany.status).toBe(422);
    expect(fields(tooMany)).toEqual(['body.rules.maxSelected']);
    await patch(f.id, { rules: { maxSelected: 2 } }).expect(200);

    const text = await patch(f.id, { dataType: 'TEXT' });
    expect(text.status).toBe(200);
    expect(text.body.data).toMatchObject({ dataType: 'TEXT', options: null, rules: {} });
    const toChoice = await patch(f.id, { dataType: 'SINGLE_CHOICE' });
    expect(toChoice.status).toBe(422);
    expect(fields(toChoice)).toEqual(['body.options']);
    expect((await patch(f.id, { rules: { min: 3 } })).status).toBe(422);
    expect((await patch(f.id, { rules: { maxLength: 40 }, sensitivity: 'PERSONAL', isExportable: false })).status).toBe(200);
  });

  it('locks the type once values exist (FIELD_TYPE_LOCKED); such a field is archived, not deleted, and archiving keeps it off the form', async () => {
    const f = await makeField({ fieldCode: 'blood_group', label: 'Blood group', dataType: 'SINGLE_CHOICE', options: ['A+', 'B+', 'O+'] });
    const source: FormFieldValueSource = { formCode: 'TRAINER_PROFILE', count: async (_m, code) => (code === 'blood_group' ? 2 : 0) };
    FORM_FIELD_VALUE_SOURCES.push(source);
    try {
      const detail = await request(app).get(`${BASE}/${f.id}`).set(auth(viewer.token));
      expect(detail.body.data).toMatchObject({ storedValues: 2, typeLocked: true });

      const type = await patch(f.id, { dataType: 'TEXT' });
      expect(type.status).toBe(409);
      expect(type.body.error).toMatchObject({ code: 'FIELD_TYPE_LOCKED', details: [{ field: 'dataType', message: 'The type cannot be changed because values already exist.' }] });
      /* Options and rules of the same type can still change. */
      expect((await patch(f.id, { options: ['A+', 'B+', 'O+', 'AB+'] })).status).toBe(200);

      const del = await request(app).delete(`${BASE}/${f.id}`).set(auth(admin.token));
      expect(del.status).toBe(409);
      expect(del.body.error.code).toBe('FIELD_HAS_VALUES');
      expect(del.body.message).toContain('2 records hold a value');

      const archive = await request(app).patch(`${BASE}/${f.id}/status`).set(auth(admin.token)).send({ isActive: false });
      expect(archive.status).toBe(200);
      expect(archive.body.data.isActive).toBe(false);
      const eff = await request(app).get(EFFECTIVE).set(auth(viewer.token));
      expect(eff.body.data.sections[0].fields.map((x: { fieldCode: string }) => x.fieldCode)).not.toContain('blood_group');
      const audit: { details: { event: string } }[] = await AppDataSource.query(
        `SELECT "details" FROM "audit_logs" WHERE "resourceId" = $1 AND "action" = 'lms.form-field.status'`,
        [f.id],
      );
      expect(audit.map((a) => a.details.event)).toEqual(['config.form_field.archived']);
      const back = await request(app).patch(`${BASE}/${f.id}/status`).set(auth(admin.token)).send({ isActive: true });
      expect(back.body.data.isActive).toBe(true);
    } finally {
      FORM_FIELD_VALUE_SOURCES.splice(FORM_FIELD_VALUE_SOURCES.indexOf(source), 1);
    }
  });

  it('answers 404 for an unknown field and 422 for an empty or unknown update', async () => {
    expect((await patch(MISSING_ID, { label: 'X' })).status).toBe(404);
    expect((await request(app).get(`${BASE}/${MISSING_ID}`).set(auth(admin.token))).status).toBe(404);
    const id = await idOf('mobile');
    expect((await patch(id, {})).status).toBe(422);
    expect((await patch(id, { fieldCode: 'phone' })).status).toBe(422);
    expect((await patch(id, { formCode: 'TRAINER_PROFILE' })).status).toBe(422);
    expect((await request(app).put(`${BASE}/${id}`).set(auth(admin.token)).send({ helpText: 'Ten-digit mobile' })).status).toBe(200);
    expect((await request(app).patch(`${BASE}/${id}/status`).set(auth(admin.token)).send({ isActive: 'no' })).status).toBe(422);
  });
});

describe('Form Field Configuration — delete and restore', () => {
  it('never deletes or archives a standard field', async () => {
    const id = await idOf('photo');
    const del = await request(app).delete(`${BASE}/${id}`).set(auth(admin.token));
    expect(del.status).toBe(409);
    expect(del.body.error.code).toBe('FIELD_STANDARD');
    const archive = await request(app).patch(`${BASE}/${id}/status`).set(auth(admin.token)).send({ isActive: false });
    expect(archive.status).toBe(409);
    expect(archive.body.error.code).toBe('FIELD_STANDARD');
  });

  it('soft-deletes a custom field without values and restores it archived', async () => {
    const f = await makeField({ fieldCode: 'delete_me', label: 'Delete me' });
    const del = await request(app).delete(`${BASE}/${f.id}`).set(auth(admin.token));
    expect(del.status).toBe(200);
    expect(del.body.data).toBeNull();
    expect((await request(app).get(`${BASE}/${f.id}`).set(auth(admin.token))).status).toBe(404);
    expect((await request(app).delete(`${BASE}/${f.id}`).set(auth(admin.token))).status).toBe(404);

    const restored = await request(app).post(`${BASE}/${f.id}/restore`).set(auth(admin.token));
    expect(restored.status).toBe(200);
    expect(restored.body.data).toMatchObject({ fieldCode: 'delete_me', isActive: false });
    expect((await request(app).post(`${BASE}/${f.id}/restore`).set(auth(admin.token))).status).toBe(409);
    expect((await request(app).post(`${BASE}/${MISSING_ID}/restore`).set(auth(admin.token))).status).toBe(404);
  });

  it('refuses to restore a custom field whose key or label was taken meanwhile', async () => {
    const f = await makeField({ fieldCode: 'old_holder', label: 'Old holder' });
    await request(app).delete(`${BASE}/${f.id}`).set(auth(admin.token)).expect(200);
    await makeField({ fieldCode: 'new_holder', label: 'Old holder' });
    const res = await request(app).post(`${BASE}/${f.id}/restore`).set(auth(admin.token));
    expect(res.status).toBe(409);
    expect(res.body.error.details[0]).toMatchObject({ field: 'label' });
  });
});

describe('Form Field Configuration — listing', () => {
  it('filters by form, section, compulsory, visible, custom / standard and status; searches label and key; sorts and pages', async () => {
    const list = (q: Record<string, unknown>) => request(app).get(BASE).query({ limit: 100, ...q }).set(auth(viewer.token));

    const custom = await list({ isCustom: 'true' });
    expect(custom.body.data.length).toBeGreaterThan(0);
    expect(custom.body.data.every((f: { isCustom: boolean }) => f.isCustom)).toBe(true);
    const standard = await list({ isCustom: 'false' });
    expect(standard.body.meta.total).toBe(STANDARD_COUNT);

    const sectionD = await list({ sectionCode: 'd' });
    expect(sectionD.body.data.map((f: { fieldCode: string }) => f.fieldCode)).toEqual([
      'exp_total_years', 'exp_training_years', 'exp_industry_years', 'exp_industry_details', 'exp_training_details',
    ]);

    const required = await list({ isRequired: 'true' });
    expect(required.body.data.every((f: { isRequired: boolean }) => f.isRequired)).toBe(true);
    expect(required.body.data.map((f: { fieldCode: string }) => f.fieldCode)).toEqual(expect.arrayContaining(['full_name', 'police_check_on']));

    const archived = await list({ isActive: 'false' });
    expect(archived.body.data.map((f: { fieldCode: string }) => f.fieldCode)).toContain('delete_me');

    const hidden = await list({ isVisible: 'false' });
    expect(hidden.body.data.every((f: { isVisible: boolean }) => !f.isVisible)).toBe(true);

    const search = await list({ search: 'EXPERIENCE' });
    expect(search.body.data.map((f: { fieldCode: string }) => f.fieldCode)).toEqual(expect.arrayContaining(['exp_total_years', 'exp_training_details']));
    const byKey = await list({ search: 'shift_' });
    expect(byKey.body.data.map((f: { fieldCode: string }) => f.fieldCode).sort()).toEqual(['shift_days', 'shift_hours', 'shift_mode']);

    const sorted = await list({ sortBy: 'label', sortOrder: 'desc', formCode: 'TRAINER_PROFILE' });
    const labels = sorted.body.data.map((f: { label: string }) => f.label.toLowerCase());
    expect(labels[0] >= labels[labels.length - 1]).toBe(true);

    const paged = await request(app).get(BASE).query({ limit: 5, page: 2 }).set(auth(viewer.token));
    expect(paged.body.data).toHaveLength(5);
    expect(paged.body.meta).toMatchObject({ page: 2, limit: 5 });

    expect((await list({ sortBy: 'options' })).status).toBe(422);
    expect((await list({ formCode: 'NOPE' })).status).toBe(422);
    expect((await list({ isCustom: 'yes' })).status).toBe(422);
  });

  it('lists only soft-deleted fields with deleted=true, with the same search, filters, sort and paging, to a viewer', async () => {
    const list = (q: Record<string, unknown>) => request(app).get(BASE).query({ limit: 100, ...q }).set(auth(viewer.token));
    const codes = (res: { body: { data: { fieldCode: string }[] } }) => res.body.data.map((f) => f.fieldCode);
    const gone = await makeField({ fieldCode: 'gone_one', label: 'Gone one', sectionCode: 'GONE_ONLY' });
    await request(app).delete(`${BASE}/${gone.id}`).set(auth(admin.token)).expect(200);
    const [{ n }]: { n: number }[] = await AppDataSource.query(`SELECT COUNT(*)::int AS n FROM "lms_form_fields" WHERE "isDelete" = true`);

    const deleted = await list({ deleted: 'true' });
    expect(deleted.status).toBe(200);
    expect(deleted.body.meta.total).toBe(n);
    expect(deleted.body.data.every((f: { isActive: boolean }) => !f.isActive)).toBe(true);
    expect(codes(deleted)).toEqual(expect.arrayContaining(['gone_one', 'old_holder']));

    /* The default (and deleted=false) lists the non-deleted rows only. */
    const [{ live: liveCount }]: { live: number }[] = await AppDataSource.query(`SELECT COUNT(*)::int AS live FROM "lms_form_fields" WHERE "isDelete" = false`);
    for (const q of [{}, { deleted: 'false' }]) {
      const live = await list(q);
      expect(live.body.meta.total).toBe(liveCount);
      expect(codes(live)).not.toContain('gone_one');
      expect(codes(live)).not.toContain('old_holder');
    }

    expect(codes(await list({ deleted: 'true', search: 'HOLDER' }))).toEqual(['old_holder']);
    expect(codes(await list({ deleted: 'true', sectionCode: 'gone_only', isCustom: 'true', formCode: 'TRAINER_PROFILE' }))).toEqual(['gone_one']);
    expect((await list({ deleted: 'true', isActive: 'true' })).body.data).toEqual([]);
    expect((await list({ deleted: 'true', isCustom: 'false' })).body.data).toEqual([]);
    const sorted = codes(await list({ deleted: 'true', sortBy: 'fieldCode', sortOrder: 'desc' }));
    expect(sorted).toEqual([...sorted].sort().reverse());
    const paged = await request(app).get(BASE).query({ deleted: 'true', limit: 1, page: 2, sortBy: 'fieldCode' }).set(auth(viewer.token));
    expect(paged.body.data).toHaveLength(1);
    expect(paged.body.meta).toMatchObject({ page: 2, limit: 1, total: n });
    expect(paged.body.data[0].fieldCode).toBe([...sorted].sort()[1]);
    expect((await list({ deleted: 'yes' })).status).toBe(422);
    expect((await request(app).get(BASE).query({ deleted: 'true' }).set(auth(nobody.token))).status).toBe(403);

    /* Restored, it leaves the deleted list and comes back archived. */
    await request(app).post(`${BASE}/${gone.id}/restore`).set(auth(admin.token)).expect(200);
    expect(codes(await list({ deleted: 'true' }))).not.toContain('gone_one');
    const back = await list({ search: 'gone_one' });
    expect(back.body.data).toEqual([expect.objectContaining({ fieldCode: 'gone_one', isActive: false })]);
  });
});

describe('Form Field Configuration — sections of a form', () => {
  const SECTIONS = `${BASE}/forms/TRAINER_PROFILE/sections`;

  it('lists the standard sections, then every custom section a non-deleted field uses (hidden and archived included), with field counts', async () => {
    await makeField({ fieldCode: 'hidden_note', label: 'Hidden note', sectionCode: 'HIDDEN_ONLY', isVisible: false });
    const archived = await makeField({ fieldCode: 'archived_note', label: 'Archived note', sectionCode: 'ARCHIVED_ONLY' });
    await request(app).patch(`${BASE}/${archived.id}/status`).set(auth(admin.token)).send({ isActive: false }).expect(200);
    const deleted = await makeField({ fieldCode: 'deleted_note', label: 'Deleted note', sectionCode: 'DELETED_ONLY' });
    await request(app).delete(`${BASE}/${deleted.id}`).set(auth(admin.token)).expect(200);

    const res = await request(app).get(SECTIONS).set(auth(viewer.token));
    expect(res.status).toBe(200);
    const sections: { code: string; label: string | null; isStandard: boolean; fieldCount: number }[] = res.body.data;
    const codes = sections.map((s) => s.code);
    expect(codes.slice(0, 9)).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'VERIFICATION']);
    expect(sections[0]).toMatchObject({ code: 'A', label: 'Basic personal details', isStandard: true });
    expect(sections[3]).toEqual({ code: 'D', label: 'Experience', isStandard: true, fieldCount: 5 });
    /* Custom sections after the form's own, A to Z, without a label; one whose only field is deleted is gone. */
    const custom = sections.slice(9);
    expect(custom.every((s) => !s.isStandard && s.label === null)).toBe(true);
    expect(custom.map((s) => s.code)).toEqual([...custom.map((s) => s.code)].sort((a, b) => a.localeCompare(b)));
    expect(custom).toEqual(
      expect.arrayContaining([
        { code: 'HIDDEN_ONLY', label: null, isStandard: false, fieldCount: 1 },
        { code: 'ARCHIVED_ONLY', label: null, isStandard: false, fieldCount: 1 },
        { code: 'X_EXTRA', label: null, isStandard: false, fieldCount: 1 },
      ]),
    );
    expect(codes).not.toContain('DELETED_ONLY');

    /* The effective form leaves out the sections whose fields are all hidden or archived. */
    const eff = await request(app).get(EFFECTIVE).set(auth(viewer.token));
    const effective = eff.body.data.sections.map((s: { code: string }) => s.code);
    expect(effective).not.toContain('HIDDEN_ONLY');
    expect(effective).not.toContain('ARCHIVED_ONLY');

    /* Each count is the number of non-deleted fields the listing has in that section. */
    for (const s of sections) {
      const listed = await request(app).get(BASE).query({ formCode: 'TRAINER_PROFILE', sectionCode: s.code, limit: 1 }).set(auth(viewer.token));
      expect({ code: s.code, total: listed.body.meta.total }).toEqual({ code: s.code, total: s.fieldCount });
    }
  });

  it('answers any of the view / create / update permissions, and 422 for a form that is not configurable', async () => {
    for (const codes of [['lms-form-fields.create'], ['lms-form-fields.update']]) {
      const actor = await actorWith(codes);
      expect((await request(app).get(SECTIONS).set(auth(actor.token))).status).toBe(200);
    }
    expect((await request(app).get(SECTIONS)).status).toBe(401);
    expect((await request(app).get(SECTIONS).set(auth(nobody.token))).status).toBe(403);
    expect((await request(app).get(`${BASE}/forms/CENTRE_PROFILE/sections`).set(auth(viewer.token))).status).toBe(422);
  });
});

describe('Form Field Configuration — permissions', () => {
  it('requires a session', async () => {
    expect((await request(app).get(BASE)).status).toBe(401);
    expect((await request(app).get(EFFECTIVE)).status).toBe(401);
  });

  it('lets a viewer read but not write', async () => {
    const id = await idOf('languages');
    expect((await request(app).get(`${BASE}/${id}`).set(auth(viewer.token))).status).toBe(200);
    expect((await create({ fieldCode: 'viewer_made', label: 'Viewer made' }, viewer.token)).status).toBe(403);
    expect((await patch(id, { isRequired: true }, viewer.token)).status).toBe(403);
    expect((await request(app).put(`${BASE}/${id}`).set(auth(viewer.token)).send({ isRequired: true })).status).toBe(403);
    expect((await request(app).patch(`${BASE}/${id}/status`).set(auth(viewer.token)).send({ isActive: false })).status).toBe(403);
    expect((await request(app).delete(`${BASE}/${id}`).set(auth(viewer.token))).status).toBe(403);
    expect((await request(app).post(`${BASE}/${id}/restore`).set(auth(viewer.token))).status).toBe(403);
  });

  it('refuses every route to a user without a form-field permission', async () => {
    expect((await request(app).get(BASE).set(auth(nobody.token))).status).toBe(403);
    expect((await request(app).get(`${BASE}/form-options`).set(auth(nobody.token))).status).toBe(403);
    expect((await request(app).get(EFFECTIVE).set(auth(nobody.token))).status).toBe(403);
    expect((await request(app).get(`${BASE}/${await idOf('tools')}`).set(auth(nobody.token))).status).toBe(403);
  });

  it('a creator without update rights can add a custom field but not change rules', async () => {
    const creator = await actorWith(['lms-form-fields.view', 'lms-form-fields.create']);
    const res = await create({ fieldCode: 'creator_made', label: 'Creator made' }, creator.token);
    expect(res.status).toBe(201);
    expect((await patch(res.body.data.id, { isRequired: true }, creator.token)).status).toBe(403);
    expect((await request(app).get(`${BASE}/form-options`).set(auth(creator.token))).status).toBe(200);
  });
});
