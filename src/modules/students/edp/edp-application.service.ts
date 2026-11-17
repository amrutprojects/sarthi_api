import path from 'path';
import type { Readable } from 'stream';
import type { Request } from 'express';
import { AppDataSource } from '../../../config/database.config';
import { logger } from '../../../observability/logger';
import { AppError } from '../../../shared/errors/app-error';
import { auditService } from '../../audit';
import { mastersService, type MasterLookup } from '../../masters';
import { aadhaarBlindIndex, decryptAadhaar, encryptAadhaar, maskAadhaar } from '../aadhaar';
import { documentStorage, safeSegment } from '../documents/document-storage';
import { documentFileRule } from '../documents/file-type';
import { StudentDocument } from '../documents/student-document.entity';
import { Student } from '../register/student.entity';
import { prepareFiles } from '../registration/registration-admin.service';
import { REGISTRATION_MESSAGES } from '../registration/registration.service';
import { REGISTRATION_NUMBER_LOCK, REGISTRATION_NUMBER_RE, registrationNumberSql } from '../registration/registration-number';
import { env } from '../../../config/env.config';
import { CENTRES, DOCUMENTS, RELIGIONS, TRACKS } from '../student.constants';
import {
  EDP_APPLICATION_STATUS as STATUS,
  EDP_CGPA_SCALES,
  EDP_DOCUMENTS,
  EDP_ERROR_CODES,
  EDP_FORM_FIELDS,
  EDP_GENDERS,
  EDP_GRADING_TYPES,
  EDP_MARITAL_STATUSES,
  EDP_MESSAGES,
  EDP_QUALIFICATION_CLASSES,
  EDP_STEP1_FIELDS,
  EDP_STEP2_FIELDS,
  edpDocument,
  edpUsesDocumentType,
  type EdpFormField,
} from './edp.constants';
import { EdpAccount as EdpAccountEntity, EdpApplication, EdpApplicationFile, type EdpAccount } from './edp.entities';
import { ensureApplication } from './edp-account.service';
import { basicStep, fullForm, mainStep, type SaveStepBody, type SubmitBody } from './edp.validation';
import { barcodeMap } from '../registration/registration-admin.validation';
import { centreService } from '../../../masters/centre/centre.service';
import { edpSettingsService } from './edp-settings.service';

type Form = Record<EdpFormField, string>;
type FieldError = { field: string; message: string };

/* The district must be active, and the taluka an active one of that district. */
async function checkGeography(districtId: string, talukaId: string): Promise<FieldError[]> {
  const [row]: { district: boolean; taluka: boolean }[] = await AppDataSource.query(
    `SELECT
       EXISTS (SELECT 1 FROM "districts" WHERE "id" = $1 AND "isActive" AND NOT "isDelete") AS "district",
       EXISTS (SELECT 1 FROM "talukas" WHERE "id" = $2 AND "districtId" = $1 AND "isActive" AND NOT "isDelete") AS "taluka"`,
    [districtId, talukaId],
  );
  if (!row.district) return [{ field: 'body.district_id', message: 'District not found or inactive' }];
  if (!row.taluka) return [{ field: 'body.taluka_id', message: 'Select a taluka of the selected district' }];
  return [];
}

/* Values that do not apply are not kept: no disability details without a disability, no CGPA scale for a percentage. */
function dropInapplicable<T extends Partial<Form>>(v: T): T {
  const out = { ...v };
  if (out.disability_status === 'No') {
    out.disability_type = '';
    out.disability_certificate_number = '';
  }
  if (out.grading_type === 'PERCENTAGE') out.cgpa_scale = '';
  return out;
}

const yesNo = (b: boolean | null) => (b === null ? '' : b ? 'Yes' : 'No');

const apps = () => AppDataSource.getRepository(EdpApplication);
const appFiles = () => AppDataSource.getRepository(EdpApplicationFile);
const DOC_LABEL = new Map(DOCUMENTS.map((d) => [d.key, d.label]));

async function loadApplication(accountId: string): Promise<EdpApplication> {
  await ensureApplication(accountId);
  return apps().createQueryBuilder('p').addSelect('p.aadhaarEnc').where('p.accountId = :accountId', { accountId }).getOneOrFail();
}

/* Only a form not yet submitted can be changed: a submission is final (no edit, no resubmission). */
const editable = (p: EdpApplication) => p.status === STATUS.DRAFT;

function assertEditable(p: EdpApplication) {
  if (!editable(p)) throw AppError.conflict(EDP_MESSAGES.ALREADY_SUBMITTED, EDP_ERROR_CODES.ALREADY_SUBMITTED);
}

const zodErrors = (issues: { path: (string | number)[]; message: string }[], prefix = 'body'): FieldError[] =>
  issues.map((i) => ({ field: [prefix, ...i.path].join('.'), message: i.message }));

const digitsOnly = (v: string) => v.replace(/[\s-]/g, '');

function draftForm(p: EdpApplication): Form {
  const form = Object.fromEntries(EDP_FORM_FIELDS.map((f) => [f, typeof p.data?.[f] === 'string' ? p.data[f] : ''])) as Form;
  form.aadhaar_number = p.aadhaarEnc ? decryptAadhaar(p.aadhaarEnc) : '';
  return form;
}

/* The submitted record as it is now in the student register, including any change made in the Amrut admin panel. */
function studentForm(s: Student): Form {
  return {
    first_name: s.firstName,
    last_name: s.lastName,
    father_name: s.fatherName,
    mother_name: s.motherName,
    email: s.email ?? '',
    date_of_birth: s.dateOfBirth ?? '',
    current_address: s.currentAddress,
    aadhaar_number: '',
    mobile_number: s.mobile ?? '',
    religion: s.religion,
    caste_id: s.casteId ?? '',
    region_id: s.regionId ?? '',
    technology: s.trackCode ?? '',
    education_id: s.educationId ?? '',
    gender: s.gender ?? '',
    marital_status: s.maritalStatus ?? '',
    permanent_address: s.permanentAddress ?? '',
    landmark: s.landmark ?? '',
    district_id: s.districtId ?? '',
    taluka_id: s.talukaId ?? '',
    pin_code: s.pinCode ?? '',
    alternate_mobile_number: s.alternateMobile ?? '',
    alternate_email: s.alternateEmail ?? '',
    disability_status: yesNo(s.disabilityStatus),
    disability_type: s.disabilityType ?? '',
    disability_certificate_number: s.disabilityCertificateNumber ?? '',
    centre_id: s.centreId ?? '',
    qualification_name: s.qualificationName ?? '',
    qualification_stream: s.qualificationStream ?? '',
    qualification_board: s.qualificationBoard ?? '',
    qualification_completed_on: s.qualificationCompletedOn ?? '',
    grading_type: s.gradingType ?? '',
    cgpa_scale: s.cgpaScale === null ? '' : String(s.cgpaScale),
    score: s.score === null ? '' : String(Number(s.score)),
    qualification_class: s.qualificationClass ?? '',
  };
}

/* Names of the student's EDP references as they are now (also for a record since deactivated). */

/* EDP registrations (submitted applications, and those submitted earlier into the student register) holding this Aadhaar. */
async function aadhaarTaken(m: { query: (sql: string, params: unknown[]) => Promise<unknown[]> }, bidx: string, applicationId: string) {
  const rows = await m.query(
    `SELECT 1 FROM "edp_applications" a
     WHERE a."isDelete" = false AND a."status" = 'SUBMITTED' AND a."id" <> $2
       AND (a."aadhaarBidx" = $1 OR EXISTS (SELECT 1 FROM "students" s WHERE s."id" = a."studentId" AND s."isDelete" = false AND s."aadhaarBidx" = $1))
     LIMIT 1`,
    [bidx, applicationId],
  );
  return rows.length > 0;
}

/*
 * The EDP registration number: MMDDHHmmssSSSfff from the database clock, as the student register's (registration-number.ts),
 * unique across both (the same advisory lock serialises the two). Must run inside the submitting transaction.
 */
async function allocateEdpNumber(m: { query: (sql: string, params?: unknown[]) => Promise<{ [k: string]: unknown }[]> }) {
  await m.query(`SELECT pg_advisory_xact_lock($1)`, [REGISTRATION_NUMBER_LOCK]);
  for (let attempt = 0; attempt < 200; attempt++) {
    const [row] = await m.query(registrationNumberSql, [env.APP_TIMEZONE]);
    const num = String(row?.num ?? '');
    if (!REGISTRATION_NUMBER_RE.test(num)) throw new Error(`Registration number has an unexpected format: "${num}"`);
    const taken = await m.query(
      `SELECT 1 FROM "students" WHERE "registrationNumber" = $1 UNION ALL SELECT 1 FROM "edp_applications" WHERE "registrationNumber" = $1`,
      [num],
    );
    if (!taken.length) return num;
  }
  throw AppError.conflict('Could not allocate a registration number right now; please try again');
}

/* The candidate's documents folder: registration ID and name, e.g. EDP-000001_Kavya_Jadhav (letters, digits, _ and - only). */
const candidateFolder = (code: string, firstName: string, lastName: string) =>
  safeSegment(`${code}_${firstName}_${lastName}`.replace(/\s+/g, '_')).replace(/_+/g, '_').replace(/_$/, '');

/* A document's label for a file name: letters and digits joined with _, e.g. Applicant_Video_with_Aadhaar. */
const fileLabel = (code: string) => (edpDocument(code)?.label ?? code).replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
const extFor = (mime: string) =>
  ({ 'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/png': '.png', 'video/mp4': '.mp4' })[mime] ?? '';

/* Names of the form's references, as they are now (also for a record since deactivated). */
async function referenceNames(form: Partial<Form>) {
  const id = (v?: string) => (v && /^[0-9a-f-]{36}$/i.test(v) ? v : null);
  const [row]: Record<string, string | null>[] = await AppDataSource.query(
    `SELECT (SELECT "name" FROM "castes" WHERE "id" = $1) AS "caste",
            (SELECT "name" FROM "regions" WHERE "id" = $2) AS "region",
            (SELECT "name" FROM "educations" WHERE "id" = $3) AS "education",
            (SELECT "name" FROM "edp_centres" WHERE "id" = $4) AS "centre",
            (SELECT "name" FROM "districts" WHERE "id" = $5) AS "district",
            (SELECT "name" FROM "talukas" WHERE "id" = $6) AS "taluka"`,
    [id(form.caste_id), id(form.region_id), id(form.education_id), id(form.centre_id), id(form.district_id), id(form.taluka_id)],
  );
  return {
    caste: row.caste,
    course_centre: row.region,
    education: row.education,
    centre: row.centre,
    district: row.district,
    taluka: row.taluka,
    religion: form.religion || null,
    technology: TRACKS.find((t) => t.code === form.technology)?.name ?? (form.technology || null),
    gender: form.gender || null,
    marital_status: form.marital_status || null,
  };
}

/* An application submitted before migration 1795600000000 was copied into the student register; it is read from there. */
const legacySubmission = (p: EdpApplication) => p.status === STATUS.SUBMITTED && !!p.studentId && !p.registrationCode;

/*
 * One submission at a time per application: a session advisory lock on a connection of its own (released if the process
 * dies). A second click while the first is running gets 409 instead of a second registration attempt.
 */
async function withApplicationLock<T>(applicationId: string, fn: () => Promise<T>): Promise<T> {
  const runner = AppDataSource.createQueryRunner('master');
  const key = `edp-application:${applicationId}`;
  try {
    const [{ ok }] = (await runner.query(`SELECT pg_try_advisory_lock(hashtext($1)) AS "ok"`, [key])) as { ok: boolean }[];
    if (!ok) throw AppError.conflict('Your form is already being submitted. Please wait a moment.');
    try {
      return await fn();
    } finally {
      await runner
        .query(`SELECT pg_advisory_unlock(hashtext($1))`, [key])
        .catch((err) => logger.error({ err, applicationId }, 'could not release the EDP application lock'));
    }
  } finally {
    await runner.release();
  }
}

/*
 * The document types the portal lists (EDP_DOCUMENTS order), with its labels and required rule. A type that is
 * missing, deleted or inactive in the Document Types master is not offered.
 */
const portalDocumentTypes = (masters: MasterLookup) =>
  EDP_DOCUMENTS.flatMap((d) => {
    const t = masters.find('documentType', d.code);
    return t && t.code === d.code ? [{ id: t.id, code: t.code, name: d.label, isMandatory: d.required }] : [];
  });

/* Those types for the form. The portal asks for no certificate barcodes (barcode is always null). */
function documentTypes(masters: MasterLookup) {
  return portalDocumentTypes(masters).map((t) => ({
    id: t.id,
    code: t.code,
    name: t.name,
    is_mandatory: t.isMandatory,
    barcode: null,
    /* Accepted file formats and size: PDF / JPG / JPEG / PNG up to 5 MB; the Applicant Video an MP4 up to 50 MB. */
    formats: documentFileRule(t.code).formats,
    max_mb: documentFileRule(t.code).maxMb,
  }));
}

/* Barcodes as typed (step 3 autosave): document type codes only, short values. */
function cleanBarcodes(data: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(data)
      .filter(([k, v]) => /^[A-Z0-9_]{1,40}$/.test(k) && typeof v === 'string' && v.length <= 40)
      .map(([k, v]) => [k, v.trim()]),
  );
}

/* Document checks at submission: every required type needs a file (no certificate barcodes are asked for). */
function checkDocuments(masters: MasterLookup, hasFile: (code: string) => boolean, errors: FieldError[]) {
  for (const t of portalDocumentTypes(masters)) {
    if (t.isMandatory && !hasFile(t.code)) errors.push({ field: `files.${t.code}`, message: `${t.name} is required` });
  }
}

/* A stored file of a type the master no longer offers (deactivated after it was uploaded) must be removed before submitting. */
function checkStoredTypes(files: EdpApplicationFile[], masters: MasterLookup, errors: FieldError[]) {
  for (const f of files) {
    if (!edpUsesDocumentType(f.docType)) continue;
    const type = masters.find('documentType', f.docType);
    if (!type || type.code !== f.docType)
      errors.push({
        field: `files.${f.docType}`,
        message: `${edpDocument(f.docType)?.label ?? DOC_LABEL.get(f.docType) ?? f.docType} is no longer accepted. Please remove it.`,
      });
  }
}

export const edpApplicationService = {
  /*
   * Dropdown values: active, non-deleted master records only (as the admin form), plus the constant lists, and the
   * content the tracking panel edits (EDP_SUPPORT_EMAIL / EDP_SUPPORT_MOBILE and the standard text until then): the
   * contact shown after submitting, the congratulations dialog, and the Help button's details.
   */
  async options() {
    const masters = await mastersService.loadLookup();
    const ref = (key: 'region' | 'caste' | 'education') => masters.list(key).map((r) => ({ id: r.id, code: r.code, name: r.name }));
    const districts: { id: string; name: string; code: string }[] = await AppDataSource.query(
      `SELECT "id", "name", "code" FROM "districts" WHERE "isActive" AND NOT "isDelete" ORDER BY "name" ASC, "id" ASC`,
    );
    return {
      regions: ref('region'),
      castes: ref('caste'),
      educations: ref('education'),
      document_types: documentTypes(masters),
      religions: RELIGIONS,
      tracks: TRACKS.map((t) => ({ code: t.code, name: t.name })),
      support: await edpSettingsService.support(),
      welcome: await edpSettingsService.welcome(),
      help: await edpSettingsService.help(),
      genders: EDP_GENDERS,
      marital_statuses: EDP_MARITAL_STATUSES,
      districts,
      centres: await centreService.portalOptions(),
      grading_types: EDP_GRADING_TYPES,
      cgpa_scales: EDP_CGPA_SCALES,
      qualification_classes: EDP_QUALIFICATION_CLASSES,
    };
  },

  /* Step 2's Technology / 3rd module selection dropdown: the technologies currently allocated to an active centre. */
  async centreTechnologies(centreId: string) {
    const technologies = await centreService.studentTechnologies(centreId);
    if (!technologies) throw AppError.notFound('Center not found or inactive');
    return technologies;
  },

  /*
   * The application as the student sees it: the draft until it is submitted; afterwards (final) the submitted record —
   * the application itself, or for one submitted before migration 1795600000000 its copy in the student register.
   */
  async get(account: EdpAccount) {
    const p = await loadApplication(account.id);
    const masters = await mastersService.loadLookup();
    const docName = (code: string) => edpDocument(code)?.label ?? masters.find('documentType', code)?.name ?? DOC_LABEL.get(code) ?? code;
    const own = await appFiles().find({ where: { applicationId: p.id }, order: { docType: 'ASC' } });
    const fileDto = (f: { docType: string; originalName: string; mimeType: string; sizeBytes: number }, uploadedAt: Date) => ({
      doc_type: f.docType,
      name: docName(f.docType),
      original_name: f.originalName,
      mime_type: f.mimeType,
      size_bytes: f.sizeBytes,
      uploaded_at: uploadedAt,
    });
    const base = {
      status: p.status,
      current_step: p.currentStep,
      steps: { basic_completed: !!p.basicCompletedAt, main_completed: !!p.mainCompletedAt },
      editable: editable(p),
      submitted_at: p.submittedAt,
      barcodes: {},
    };

    if (editable(p)) {
      /* A new form starts with the account's own details; its email is always the account's (it cannot be changed). */
      const form = draftForm(p);
      form.first_name ||= account.firstName;
      form.last_name ||= account.lastName;
      form.mobile_number ||= account.mobile;
      form.email = account.email;
      return {
        ...base,
        form,
        draft_files: own.filter((f) => edpUsesDocumentType(f.docType)).map((f) => fileDto(f, f.updatedAt)),
        submitted_files: [],
        registration: null,
      };
    }

    if (legacySubmission(p)) {
      const student = await AppDataSource.getRepository(Student).findOne({ where: { id: p.studentId!, isDelete: false } });
      const stored = student
        ? (
            await AppDataSource.getRepository(StudentDocument).find({
              where: { studentId: student.id, isDelete: false },
              order: { docType: 'ASC' },
            })
          ).filter((f) => edpUsesDocumentType(f.docType))
        : [];
      const form = student ? studentForm(student) : (Object.fromEntries(EDP_FORM_FIELDS.map((k) => [k, ''])) as Form);
      return {
        ...base,
        form,
        draft_files: [],
        submitted_files: stored.map((f) => ({ ...fileDto(f, f.createdAt), verified: !!f.verifiedAt })),
        registration: student
          ? {
              registration_id: student.code,
              registration_number: student.registrationNumber,
              status: student.status,
              aadhaar_masked: maskAadhaar(student.aadhaarLast4),
              display: {
                ...(await referenceNames(form)),
                caste: student.caste,
                education: student.educationQualification,
                course_centre:
                  masters.byId('region', student.regionId ?? '')?.name ??
                  CENTRES.find((c) => c.code === student.centreCode)?.name ??
                  student.centreCode,
                technology: TRACKS.find((t) => t.code === student.trackCode)?.name ?? student.trackSourceValue,
              },
            }
          : null,
      };
    }

    /* Submitted in the EDP system: the application is the record; the Aadhaar is never shown in full again. */
    const form = draftForm(p);
    form.aadhaar_number = '';
    form.email = account.email;
    return {
      ...base,
      form,
      draft_files: [],
      submitted_files: own.filter((f) => edpUsesDocumentType(f.docType)).map((f) => ({ ...fileDto(f, f.updatedAt), verified: false })),
      registration: {
        registration_id: p.registrationCode,
        registration_number: p.registrationNumber,
        status: p.status,
        aadhaar_masked: maskAadhaar(p.aadhaarLast4),
        display: await referenceNames(form),
      },
    };
  },

  /*
   * Saves one step. complete=false keeps the values as typed (resume later). complete=true checks the step as the admin
   * form does (field rules, active masters, Aadhaar not already registered) and moves on; the values are kept even when
   * the check fails, so nothing typed is lost. Aadhaar is stored encrypted, never in the JSON.
   */
  async saveStep(account: EdpAccount, step: number, body: SaveStepBody) {
    const p = await loadApplication(account.id);
    assertEditable(p);

    if (step === 3) {
      const barcodes = { ...p.barcodes, ...cleanBarcodes(body.data) };
      await apps().update(p.id, { barcodes });
      if (body.complete) {
        const parsed = barcodeMap.safeParse(barcodes);
        if (!parsed.success) throw AppError.validation(zodErrors(parsed.error.issues, 'body.barcodes'));
      }
      return this.get(account);
    }

    const fields: readonly string[] = step === 1 ? EDP_STEP1_FIELDS : EDP_STEP2_FIELDS;
    /* The email is never taken from the request: it is the account's (the address verified with the OTP). */
    const incoming: Record<string, string> = Object.fromEntries(
      Object.entries(body.data).filter(([k]) => fields.includes(k) && k !== 'email'),
    );
    if (step === 1) incoming.email = account.email;
    const { aadhaar_number: aadhaar, ...rest } = incoming;
    const patch: Partial<EdpApplication> = { data: { ...p.data, ...rest } };
    if (aadhaar !== undefined) {
      const d = digitsOnly(aadhaar);
      if (/^\d{12}$/.test(d)) patch.aadhaarEnc = encryptAadhaar(d);
      else if (!d) patch.aadhaarEnc = null;
    }
    await apps().update(p.id, patch);
    if (!body.complete) return this.get(account);

    if (step === 2 && !p.basicCompletedAt) throw AppError.conflict('Please complete Step 1 – Basic Details first.');
    const masters = await mastersService.loadLookup();
    const errors: FieldError[] = [];
    const parsed = (step === 1 ? basicStep : mainStep).safeParse(incoming);
    if (!parsed.success) errors.push(...zodErrors(parsed.error.issues));
    const values = (parsed.success ? parsed.data : {}) as Partial<Form>;
    if (parsed.success && step === 1) {
      if (!masters.byId('caste', values.caste_id!)) errors.push({ field: 'body.caste_id', message: 'Caste not found or inactive' });
      const bidx = aadhaarBlindIndex(digitsOnly(values.aadhaar_number!));
      if (await aadhaarTaken(AppDataSource, bidx, p.id))
        errors.push({ field: 'body.aadhaar_number', message: 'A registration with this Aadhaar number already exists' });
      errors.push(...(await checkGeography(values.district_id!, values.taluka_id!)));
    }
    if (parsed.success && step === 2) {
      if (!masters.byId('region', values.region_id!))
        errors.push({ field: 'body.region_id', message: 'Course district not found or inactive' });
      if (!masters.byId('education', values.education_id!))
        errors.push({ field: 'body.education_id', message: 'Education qualification not found or inactive' });
      errors.push(...(await centreService.checkStudentChoice(values.centre_id!, values.technology!)));
    }
    if (errors.length) throw AppError.validation(errors);

    const { aadhaar_number: _a, ...clean } = dropInapplicable(values);
    const now = new Date();
    await apps().update(p.id, {
      data: { ...p.data, ...rest, ...(clean as Record<string, string>) },
      ...(step === 1 ? { basicCompletedAt: p.basicCompletedAt ?? now } : { mainCompletedAt: p.mainCompletedAt ?? now }),
      currentStep: Math.max(p.currentStep, step + 1),
    });
    return this.get(account);
  },

  /* Step 3 upload: one file per document type, in fields named after the type code (as the admin form); replaces an earlier one. */
  async uploadDocuments(account: EdpAccount, files: Express.Multer.File[]) {
    const p = await loadApplication(account.id);
    assertEditable(p);
    if (!files.length) throw AppError.validation([{ field: 'files', message: 'Choose a file to upload' }]);
    const masters = await mastersService.loadLookup();
    const errors: FieldError[] = [];
    /* Types the portal does not use are refused like an unknown type. */
    for (const f of files)
      if (!edpUsesDocumentType(f.fieldname)) errors.push({ field: `files.${f.fieldname}`, message: 'Unknown or inactive document type' });
    if (errors.length) throw AppError.validation(errors);
    const { prepared } = await prepareFiles(files, masters, {}, errors);
    if (errors.length) throw AppError.validation(errors);
    for (const f of prepared) {
      const key = documentStorage.edpKey(p.id, `${f.code}.${f.ext}`);
      const old = await appFiles().findOne({ where: { applicationId: p.id, docType: f.code } });
      await documentStorage.write(key, f.data);
      await appFiles().upsert(
        {
          applicationId: p.id,
          docType: f.code,
          storageKey: key,
          originalName: f.originalName.slice(0, 255),
          mimeType: f.mimeType,
          sizeBytes: f.data.length,
          sha256: f.sha256,
        },
        ['applicationId', 'docType'],
      );
      if (old && old.storageKey !== key)
        await documentStorage
          .remove(old.storageKey)
          .catch((err) => logger.error({ err, key: old.storageKey }, 'could not delete a replaced EDP draft file'));
    }
    return this.get(account);
  },

  async removeDocument(account: EdpAccount, docType: string) {
    const p = await loadApplication(account.id);
    assertEditable(p);
    const f = await appFiles().findOne({ where: { applicationId: p.id, docType: docType.toUpperCase() } });
    if (!f) throw AppError.notFound('No file has been uploaded for this document');
    await appFiles().delete(f.id);
    await documentStorage
      .remove(f.storageKey)
      .catch((err) => logger.error({ err, key: f.storageKey }, 'could not delete an EDP draft file'));
    return this.get(account);
  },

  /* The student's own file: the application's (draft or submitted), or for an earlier submission the student register's. */
  async documentFile(account: EdpAccount, docType: string): Promise<{ stream: Readable; mimeType: string; name: string }> {
    const p = await loadApplication(account.id);
    const code = docType.toUpperCase();
    if (!edpUsesDocumentType(code)) throw AppError.notFound('No file has been uploaded for this document');
    const draft = !legacySubmission(p) ? await appFiles().findOne({ where: { applicationId: p.id, docType: code } }) : null;
    const stored =
      !draft && legacySubmission(p)
        ? await AppDataSource.getRepository(StudentDocument).findOne({ where: { studentId: p.studentId!, docType: code, isDelete: false } })
        : null;
    const f = draft ?? stored;
    if (!f) throw AppError.notFound('No file has been uploaded for this document');
    return { stream: await documentStorage.read(f.storageKey), mimeType: f.mimeType, name: f.originalName };
  },

  /*
   * Final submission (once): every step checked again, with the documents. The application then becomes the submitted
   * record in the EDP system — nothing is copied to the Amrut admin panel's student register. In one transaction (under
   * a per-Aadhaar lock, so two applications with the same Aadhaar cannot both pass): the duplicate check (another EDP
   * registration with this Aadhaar → 409), the registration ID (EDP-000001) and number, and the documents moved into the
   * candidate's own folder (edp/candidates/<registration ID>_<name>/). If anything fails, the files are moved back.
   */
  async submit(req: Request, account: EdpAccount, _body: SubmitBody) {
    const first = await loadApplication(account.id);
    return withApplicationLock(first.id, async () => {
      const p = await loadApplication(account.id);
      if (p.status !== STATUS.DRAFT) throw AppError.conflict(EDP_MESSAGES.ALREADY_SUBMITTED, EDP_ERROR_CODES.ALREADY_SUBMITTED);
      /* body.barcodes is still accepted (an older page may send it) but not used: the portal asks for no barcodes. */
      const errors: FieldError[] = [];
      const form = { ...draftForm(p), email: account.email };
      const parsed = fullForm.safeParse(form);
      if (!parsed.success) errors.push(...zodErrors(parsed.error.issues));
      else {
        /* The references are checked as they stand now: a centre or allocation may have been deactivated since step 2. */
        errors.push(...(await checkGeography(parsed.data.district_id, parsed.data.taluka_id)));
        errors.push(...(await centreService.checkStudentChoice(parsed.data.centre_id, parsed.data.technology)));
      }
      const masters = await mastersService.loadLookup();
      const files = (await appFiles().find({ where: { applicationId: p.id } })).filter((f) => edpUsesDocumentType(f.docType));
      checkDocuments(masters, (c) => files.some((f) => f.docType === c), errors);
      checkStoredTypes(files, masters, errors);
      if (errors.length || !parsed.success) throw AppError.validation(errors);

      const digits = digitsOnly(parsed.data.aadhaar_number);
      const bidx = aadhaarBlindIndex(digits);
      const { aadhaar_number: _a, ...clean } = dropInapplicable(parsed.data as unknown as Form);
      const moved: { from: string; to: string }[] = [];
      let result: { code: string; number: string; folder: string };
      try {
        result = await AppDataSource.transaction(async (m) => {
          await m.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`edp-aadhaar:${bidx}`]);
          if (await aadhaarTaken(m, bidx, p.id)) throw AppError.conflict(REGISTRATION_MESSAGES.DUPLICATE);
          const [{ n }] = (await m.query(`SELECT nextval('edp_registration_code_seq') AS "n"`)) as { n: string }[];
          const code = 'EDP-' + String(n).padStart(6, '0');
          const number = await allocateEdpNumber(m);
          const folder = candidateFolder(code, parsed.data.first_name, parsed.data.last_name);
          for (const f of files) {
            const to = documentStorage.edpCandidateKey(folder, `${f.docType}${path.extname(f.storageKey)}`);
            await documentStorage.move(f.storageKey, to);
            moved.push({ from: f.storageKey, to });
            await m.getRepository(EdpApplicationFile).update(f.id, { storageKey: to });
          }
          await m.getRepository(EdpApplication).update(p.id, {
            status: STATUS.SUBMITTED,
            submittedAt: new Date(),
            currentStep: 3,
            registrationCode: code,
            registrationNumber: number,
            aadhaarBidx: bidx,
            aadhaarLast4: digits.slice(-4),
            data: clean as Record<string, string>,
            barcodes: {},
          });
          return { code, number, folder };
        });
      } catch (err) {
        for (const mv of moved.reverse())
          await documentStorage.move(mv.to, mv.from).catch((e) => logger.error({ err: e, key: mv.to }, 'could not move an EDP file back'));
        if ((err as { driverError?: { code?: string } }).driverError?.code === '23505')
          throw AppError.conflict(REGISTRATION_MESSAGES.DUPLICATE);
        throw err;
      }
      /* Files of types the portal no longer lists stay out of the candidate's folder and are removed. */
      const leftovers = await appFiles().find({ where: { applicationId: p.id } });
      for (const f of leftovers.filter((x) => !edpUsesDocumentType(x.docType))) {
        await appFiles().delete(f.id);
        await documentStorage
          .remove(f.storageKey)
          .catch((e) => logger.error({ err: e, key: f.storageKey }, 'could not delete an EDP file'));
      }
      await auditService.record(req, {
        action: 'edp.application.submitted',
        resource: 'edp_application',
        resourceId: p.id,
        actorUserId: null,
        details: { code: result.code, registrationNumber: result.number, folder: result.folder, files: files.length },
      });
      return { registration_id: result.code, registration_number: result.number, status: STATUS.SUBMITTED };
    });
  },

  /*
   * The EDP tracking panel's full view of one candidate (any stage): account, steps, every form value with names,
   * the Aadhaar masked, and the documents. A submission from before migration 1795600000000 is read from the student
   * register.
   */
  async adminView(accountId: string) {
    const account = await AppDataSource.getRepository(EdpAccountEntity).findOne({ where: { id: accountId, isDelete: false } });
    if (!account) throw AppError.notFound('Student not found');
    const p = await loadApplication(account.id);
    const masters = await mastersService.loadLookup();
    const docName = (code: string) => edpDocument(code)?.label ?? masters.find('documentType', code)?.name ?? DOC_LABEL.get(code) ?? code;
    let form: Form;
    let aadhaarMasked: string | null;
    let files: { doc_type: string; name: string; original_name: string; mime_type: string; size_bytes: number; uploaded_at: Date }[];
    let registration: { registration_id: string | null; registration_number: string | null } | null = null;
    if (legacySubmission(p)) {
      const student = await AppDataSource.getRepository(Student).findOne({ where: { id: p.studentId!, isDelete: false } });
      form = student ? studentForm(student) : (Object.fromEntries(EDP_FORM_FIELDS.map((k) => [k, ''])) as Form);
      aadhaarMasked = student ? maskAadhaar(student.aadhaarLast4) : null;
      files = student
        ? (await AppDataSource.getRepository(StudentDocument).find({ where: { studentId: student.id, isDelete: false } }))
            .filter((f) => edpUsesDocumentType(f.docType))
            .map((f) => ({
              doc_type: f.docType,
              name: docName(f.docType),
              original_name: f.originalName,
              mime_type: f.mimeType,
              size_bytes: f.sizeBytes,
              uploaded_at: f.createdAt,
            }))
        : [];
      if (student) registration = { registration_id: student.code, registration_number: student.registrationNumber };
    } else {
      form = draftForm(p);
      aadhaarMasked = p.aadhaarLast4
        ? maskAadhaar(p.aadhaarLast4)
        : form.aadhaar_number
          ? maskAadhaar(form.aadhaar_number.slice(-4))
          : null;
      files = (await appFiles().find({ where: { applicationId: p.id } }))
        .filter((f) => edpUsesDocumentType(f.docType))
        .map((f) => ({
          doc_type: f.docType,
          name: docName(f.docType),
          original_name: f.originalName,
          mime_type: f.mimeType,
          size_bytes: f.sizeBytes,
          uploaded_at: f.updatedAt,
        }));
      if (p.registrationCode) registration = { registration_id: p.registrationCode, registration_number: p.registrationNumber };
    }
    form.aadhaar_number = '';
    form.email ||= account.email;
    const order = new Map(EDP_DOCUMENTS.map((d, i) => [d.code, i]));
    files.sort((a, b) => (order.get(a.doc_type) ?? 99) - (order.get(b.doc_type) ?? 99));
    return {
      account: {
        id: account.id,
        name: [account.firstName, account.middleName, account.lastName].filter(Boolean).join(' '),
        email: account.email,
        mobile_number: account.mobile,
        created_at: account.createdAt,
        email_verified_at: account.emailVerifiedAt,
        last_login_at: account.lastLoginAt,
      },
      status: p.status,
      steps: { basic_completed_at: p.basicCompletedAt, main_completed_at: p.mainCompletedAt, submitted_at: p.submittedAt },
      registration,
      aadhaar_masked: aadhaarMasked,
      form,
      display: await referenceNames(form),
      documents: EDP_DOCUMENTS.map((d) => ({
        code: d.code,
        name: d.label,
        required: d.required,
        file: files.find((f) => f.doc_type === d.code) ?? null,
      })),
    };
  },

  /* A candidate's document for the tracking panel (any stage). */
  async adminDocumentFile(
    accountId: string,
    docType: string,
  ): Promise<{ stream: Readable; mimeType: string; name: string; downloadName: string }> {
    const c = await this.candidateFiles(accountId);
    const code = docType.toUpperCase();
    const f = c.files.find((x) => x.docType === code);
    if (!f) throw AppError.notFound('No file has been uploaded for this document');
    return {
      stream: await documentStorage.read(f.storageKey),
      mimeType: f.mimeType,
      name: f.originalName,
      /* e.g. EDP-000001_Kavya_Jadhav_Photo.pdf */
      downloadName: `${c.folder}_${fileLabel(code)}${f.ext}`,
    };
  },

  /*
   * A candidate's documents as one folder (the EDP tracking panel's "Download all"): the folder is named like the
   * candidate's storage folder (registration ID and name; the name alone before submission), and each file after its
   * place in the form and its label, e.g. 01_Photo.pdf. Files are streamed from storage, never all held in memory.
   */
  async adminDocumentsFolder(accountId: string) {
    const c = await this.candidateFiles(accountId);
    if (!c.files.length) throw AppError.notFound('No documents have been uploaded yet');
    const order = new Map(EDP_DOCUMENTS.map((d, i) => [d.code, i]));
    const files = [...c.files].sort((a, b) => (order.get(a.docType) ?? 99) - (order.get(b.docType) ?? 99));
    return {
      folder: c.folder,
      entries: files.map((f) => ({
        path: `${c.folder}/${String((order.get(f.docType) ?? 98) + 1).padStart(2, '0')}_${fileLabel(f.docType)}${f.ext}`,
        open: () => documentStorage.read(f.storageKey),
      })),
    };
  },

  /* A candidate's stored portal documents (the application's, or for an earlier submission the student register's) and folder name. */
  async candidateFiles(accountId: string) {
    const account = await AppDataSource.getRepository(EdpAccountEntity).findOne({ where: { id: accountId, isDelete: false } });
    if (!account) throw AppError.notFound('Student not found');
    const p = await loadApplication(account.id);
    type Stored = { docType: string; storageKey: string; mimeType: string; originalName: string };
    let stored: Stored[];
    let folder: string;
    if (legacySubmission(p)) {
      const student = await AppDataSource.getRepository(Student).findOne({ where: { id: p.studentId!, isDelete: false } });
      stored = student
        ? await AppDataSource.getRepository(StudentDocument).find({ where: { studentId: student.id, isDelete: false } })
        : [];
      folder = candidateFolder(student?.code ?? 'EDP', student?.firstName ?? account.firstName, student?.lastName ?? account.lastName);
    } else {
      stored = await appFiles().find({ where: { applicationId: p.id } });
      const form = draftForm(p);
      const first = form.first_name || account.firstName;
      const last = form.last_name || account.lastName;
      folder = p.registrationCode ? candidateFolder(p.registrationCode, first, last) : candidateFolder('DRAFT', first, last);
    }
    return {
      folder,
      files: stored
        .filter((f) => edpUsesDocumentType(f.docType))
        .map((f) => ({ ...f, ext: path.extname(f.storageKey) || extFor(f.mimeType) })),
    };
  },
};
