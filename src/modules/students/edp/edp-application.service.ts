import crypto from 'crypto';
import path from 'path';
import type { Readable } from 'stream';
import bcrypt from 'bcrypt';
import type { Request } from 'express';
import { appConfig } from '../../../config/app.config';
import { AppDataSource } from '../../../config/database.config';
import { logger } from '../../../observability/logger';
import { AppError } from '../../../shared/errors/app-error';
import { auditService } from '../../audit';
import { mastersService, type MasterLookup } from '../../masters';
import { aadhaarBlindIndex, decryptAadhaar, encryptAadhaar, maskAadhaar } from '../aadhaar';
import { documentStorage } from '../documents/document-storage';
import { StudentDocument } from '../documents/student-document.entity';
import { Student } from '../register/student.entity';
import { prepareFiles } from '../registration/registration-admin.service';
import { registrationService, type PreparedDocument } from '../registration/registration.service';
import { CENTRES, DOCUMENTS, RELIGIONS, TRACKS } from '../student.constants';
import {
  EDP_APPLICATION_STATUS as STATUS,
  EDP_BASIC_FIELDS,
  EDP_ERROR_CODES,
  EDP_FORM_FIELDS,
  EDP_MAIN_FIELDS,
  EDP_MESSAGES,
  EDP_SYSTEM_USER,
  edpUsesDocumentType,
  type EdpFormField,
} from './edp.constants';
import { EdpApplication, EdpApplicationFile, type EdpAccount } from './edp.entities';
import { ensureApplication } from './edp-account.service';
import { basicStep, fullForm, mainStep, type SaveStepBody, type SubmitBody } from './edp.validation';
import { barcodeMap } from '../registration/registration-admin.validation';

type Form = Record<EdpFormField, string>;
type FieldError = { field: string; message: string };

const apps = () => AppDataSource.getRepository(EdpApplication);
const appFiles = () => AppDataSource.getRepository(EdpApplicationFile);
const BARCODE = new Map(DOCUMENTS.map((d) => [d.key, d.barcode ?? null]));
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
  };
}

async function readAll(key: string): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of (await documentStorage.read(key)) as AsyncIterable<Buffer | string>) chunks.push(Buffer.from(c));
  return Buffer.concat(chunks);
}

/*
 * The Amrut admin panel user recorded as uploader of the portal's documents (student_documents.uploadedById must name a
 * user). Created on first use, inactive with an unusable password: it can never sign in.
 */
async function systemUserId(): Promise<string> {
  const find = async () =>
    (
      (await AppDataSource.query(`SELECT "id" FROM "users" WHERE "email" = $1 AND "isDelete" = false`, [EDP_SYSTEM_USER.email])) as {
        id: string;
      }[]
    )[0]?.id;
  const existing = await find();
  if (existing) return existing;
  const unusable = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), appConfig.bcryptRounds);
  await AppDataSource.query(
    `INSERT INTO "users" ("name", "email", "passwordHash", "isActive") VALUES ($1, $2, $3, false)
     ON CONFLICT ("email") WHERE "isDelete" = false DO NOTHING`,
    [EDP_SYSTEM_USER.name, EDP_SYSTEM_USER.email, unusable],
  );
  return (await find())!;
}

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

/* The active document types the portal uses (master order), i.e. without EDP_EXCLUDED_DOCUMENT_TYPES. */
const portalDocumentTypes = (masters: MasterLookup) => masters.list('documentType').filter((t) => edpUsesDocumentType(t.code));

/* Those types with the barcode rule of each (Income / EWS and Domicile: required). */
function documentTypes(masters: MasterLookup) {
  return portalDocumentTypes(masters).map((t) => ({
    id: t.id,
    code: t.code,
    name: t.name,
    is_mandatory: !!t.isMandatory,
    barcode: BARCODE.get(t.code) ?? null,
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

/* Document checks at submission: mandatory types need a file, a required barcode is needed with its file. */
function checkDocuments(
  masters: MasterLookup,
  hasFile: (code: string) => boolean,
  barcodeOf: (code: string) => string | null,
  errors: FieldError[],
) {
  for (const t of portalDocumentTypes(masters)) {
    if (t.isMandatory && !hasFile(t.code)) errors.push({ field: `files.${t.code}`, message: `${t.name} is required` });
    if (hasFile(t.code) && BARCODE.get(t.code) === 'required' && !barcodeOf(t.code))
      errors.push({ field: `body.barcodes.${t.code}`, message: `${t.name} barcode is required` });
  }
}

async function preparedFromDraft(
  files: EdpApplicationFile[],
  masters: MasterLookup,
  barcodes: Record<string, string>,
  errors: FieldError[],
) {
  const prepared: PreparedDocument[] = [];
  for (const f of files) {
    /* A file of a type the portal no longer uses (uploaded before it was dropped) is not sent with the form. */
    if (!edpUsesDocumentType(f.docType)) continue;
    const type = masters.find('documentType', f.docType);
    if (!type || type.code !== f.docType) {
      errors.push({
        field: `files.${f.docType}`,
        message: `${DOC_LABEL.get(f.docType) ?? f.docType} is no longer accepted. Please remove it.`,
      });
      continue;
    }
    prepared.push({
      code: type.code,
      documentTypeId: type.id,
      data: await readAll(f.storageKey),
      ext: path.extname(f.storageKey).slice(1),
      mimeType: f.mimeType,
      originalName: f.originalName,
      sha256: f.sha256,
      barcode: barcodes[type.code]?.trim() || null,
    });
  }
  return prepared;
}

async function clearDraftFiles(applicationId: string) {
  const files = await appFiles().find({ where: { applicationId } });
  if (!files.length) return;
  await appFiles().delete(files.map((f) => f.id));
  for (const f of files)
    await documentStorage
      .remove(f.storageKey)
      .catch((err) => logger.error({ err, key: f.storageKey }, 'could not delete an EDP draft file'));
}

export const edpApplicationService = {
  /*
   * Dropdown values: active, non-deleted master records only (as the admin form), plus the constant lists, and the contact
   * shown after submitting (EDP_SUPPORT_EMAIL / EDP_SUPPORT_MOBILE; null when not set).
   */
  async options() {
    const masters = await mastersService.loadLookup();
    const ref = (key: 'region' | 'caste' | 'education') => masters.list(key).map((r) => ({ id: r.id, code: r.code, name: r.name }));
    return {
      regions: ref('region'),
      castes: ref('caste'),
      educations: ref('education'),
      document_types: documentTypes(masters),
      religions: RELIGIONS,
      tracks: TRACKS.map((t) => ({ code: t.code, name: t.name })),
      support: appConfig.edp.support,
    };
  },

  /*
   * The application as the student sees it. Until it is submitted, `form` is the draft; once submitted (final) it is read
   * from the student register, so a change made in the Amrut admin panel shows here.
   */
  async get(account: EdpAccount) {
    const p = await loadApplication(account.id);
    const masters = await mastersService.loadLookup();
    const student = p.studentId
      ? await AppDataSource.getRepository(Student).findOne({ where: { id: p.studentId, isDelete: false } })
      : null;
    /* Only the document types the portal uses are shown (a record may hold others, e.g. entered in the admin panel). */
    const stored = (
      student
        ? await AppDataSource.getRepository(StudentDocument).find({
            where: { studentId: student.id, isDelete: false },
            order: { docType: 'ASC' },
          })
        : []
    ).filter((f) => edpUsesDocumentType(f.docType));
    const draftFiles = (editable(p) ? await appFiles().find({ where: { applicationId: p.id }, order: { docType: 'ASC' } }) : []).filter(
      (f) => edpUsesDocumentType(f.docType),
    );

    let form: Form;
    if (editable(p)) {
      /* A new form starts with the account's own details; its email is always the account's (it cannot be changed). */
      form = draftForm(p);
      form.first_name ||= account.firstName;
      form.last_name ||= account.lastName;
      form.mobile_number ||= account.mobile;
      form.email = account.email;
    } else form = student ? studentForm(student) : (Object.fromEntries(EDP_FORM_FIELDS.map((f) => [f, ''])) as Form);
    const studentBarcodes = Object.fromEntries(
      Object.entries(student?.documents ?? {})
        .filter(([code, d]) => d.barcode && edpUsesDocumentType(code))
        .map(([code, d]) => [code, d.barcode as string]),
    );
    const docName = (code: string) => masters.find('documentType', code)?.name ?? DOC_LABEL.get(code) ?? code;

    return {
      status: p.status,
      current_step: p.currentStep,
      steps: { basic_completed: !!p.basicCompletedAt, main_completed: !!p.mainCompletedAt },
      editable: editable(p),
      submitted_at: p.submittedAt,
      form,
      barcodes: editable(p) ? p.barcodes : studentBarcodes,
      draft_files: draftFiles.map((f) => ({
        doc_type: f.docType,
        name: docName(f.docType),
        original_name: f.originalName,
        mime_type: f.mimeType,
        size_bytes: f.sizeBytes,
        uploaded_at: f.updatedAt,
      })),
      submitted_files: stored.map((f) => ({
        doc_type: f.docType,
        name: docName(f.docType),
        original_name: f.originalName,
        mime_type: f.mimeType,
        size_bytes: f.sizeBytes,
        uploaded_at: f.createdAt,
        verified: !!f.verifiedAt,
      })),
      registration: student
        ? {
            registration_id: student.code,
            registration_number: student.registrationNumber,
            status: student.status,
            aadhaar_masked: maskAadhaar(student.aadhaarLast4),
            /* As stored (also for a value whose master record has since been deactivated). */
            display: {
              religion: student.religion,
              caste: student.caste,
              course_centre:
                masters.byId('region', student.regionId ?? '')?.name ??
                CENTRES.find((c) => c.code === student.centreCode)?.name ??
                student.centreCode,
              education: student.educationQualification,
              technology: TRACKS.find((t) => t.code === student.trackCode)?.name ?? student.trackSourceValue,
            },
          }
        : null,
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

    const fields: readonly string[] = step === 1 ? EDP_BASIC_FIELDS : EDP_MAIN_FIELDS;
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
      const taken: { id: string }[] = await AppDataSource.query(
        `SELECT "id" FROM "students" WHERE "aadhaarBidx" = $1 AND "isDelete" = false AND ($2::uuid IS NULL OR "id" <> $2::uuid) LIMIT 1`,
        [bidx, p.studentId],
      );
      if (taken.length) errors.push({ field: 'body.aadhaar_number', message: 'A registration with this Aadhaar number already exists' });
    }
    if (parsed.success && step === 2) {
      if (!masters.byId('region', values.region_id!))
        errors.push({ field: 'body.region_id', message: 'Course centre not found or inactive' });
      if (!masters.byId('education', values.education_id!))
        errors.push({ field: 'body.education_id', message: 'Education qualification not found or inactive' });
    }
    if (errors.length) throw AppError.validation(errors);

    const { aadhaar_number: _a, ...clean } = values;
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

  /* The student's own file: the one uploaded for the draft, else the one stored with the submitted registration. */
  async documentFile(account: EdpAccount, docType: string): Promise<{ stream: Readable; mimeType: string; name: string }> {
    const p = await loadApplication(account.id);
    const code = docType.toUpperCase();
    if (!edpUsesDocumentType(code)) throw AppError.notFound('No file has been uploaded for this document');
    const draft = editable(p) ? await appFiles().findOne({ where: { applicationId: p.id, docType: code } }) : null;
    const stored =
      !draft && p.studentId
        ? await AppDataSource.getRepository(StudentDocument).findOne({ where: { studentId: p.studentId, docType: code, isDelete: false } })
        : null;
    const f = draft ?? stored;
    if (!f) throw AppError.notFound('No file has been uploaded for this document');
    return { stream: await documentStorage.read(f.storageKey), mimeType: f.mimeType, name: f.originalName };
  },

  /*
   * Final submission: every step checked again, the documents with the admin form's rules, then the registration is
   * created through the same path as the admin form (registrationService.register: validation, duplicate Aadhaar → 409,
   * registration number, files stored with it). It then appears in the Amrut admin panel's Student Registrations.
   */
  async submit(req: Request, account: EdpAccount, body: SubmitBody) {
    const first = await loadApplication(account.id);
    return withApplicationLock(first.id, async () => {
      const p = await loadApplication(account.id);
      if (p.status !== STATUS.DRAFT) throw AppError.conflict(EDP_MESSAGES.ALREADY_SUBMITTED, EDP_ERROR_CODES.ALREADY_SUBMITTED);
      const barcodes = { ...p.barcodes, ...(body.barcodes ?? {}) };
      if (body.barcodes) await apps().update(p.id, { barcodes });

      const errors: FieldError[] = [];
      const parsed = fullForm.safeParse({ ...draftForm(p), email: account.email });
      if (!parsed.success) errors.push(...zodErrors(parsed.error.issues));
      const masters = await mastersService.loadLookup();
      const files = await appFiles().find({ where: { applicationId: p.id } });
      checkDocuments(
        masters,
        (c) => files.some((f) => f.docType === c),
        (c) => barcodes[c]?.trim() || null,
        errors,
      );
      const prepared = await preparedFromDraft(files, masters, barcodes, errors);
      if (errors.length || !parsed.success) throw AppError.validation(errors);

      const result = await registrationService.register(
        req,
        { ...parsed.data, declaration_accepted: true },
        { actorUserId: await systemUserId(), files: prepared, channel: 'EDP' },
      );
      const now = new Date();
      await apps().update(p.id, {
        status: STATUS.SUBMITTED,
        studentId: result.studentId,
        submittedAt: now,
        currentStep: 3,
        data: {},
        aadhaarEnc: null,
        barcodes: {},
      });
      await clearDraftFiles(p.id);
      await auditService.record(req, {
        action: 'edp.application.submitted',
        resource: 'edp_application',
        resourceId: p.id,
        actorUserId: null,
        details: { studentId: result.studentId, code: result.registration_id, files: prepared.length },
      });
      return { registration_id: result.registration_id, registration_number: result.registration_number, status: result.status };
    });
  },
};
