import { z } from 'zod';
import { documentEndpoint, envelope, pagedEnvelope } from '../../../shared/openapi/registry';
import { EDP_FOLLOW_UP_STATUS, EDP_STAGES } from './edp.constants';
import { parentIdParams } from '../../../shared/validation/common.validation';
import {
  centreIdSchema,
  centreStatusSchema,
  createCentreSchema,
  listCentresSchema,
  updateCentreSchema,
} from '../../../masters/centre/centre.validator';
import {
  applicantParams,
  docTypeParams,
  fileDownloadQuery,
  emailBody,
  followUpBody,
  loginBody,
  manageListQuery,
  newUserBody,
  otpBody,
  resetPasswordBody,
  resetTokenBody,
  saveStepBody,
  signupBody,
  stepParams,
  submitBody,
  supportBody,
  userStatusBody,
} from './edp.validation';

/*
 * ENTREPRENEURSHIP DEVELOPMENT PROGRAM portal (edp.sumago.ai) and its tracking panel. Student endpoints take the portal
 * token (`Authorization: Bearer`, from verify-otp or login); /edp/manage endpoints take the tracking panel's token. Neither
 * is an Amrut admin panel session.
 */
const tag = 'EDP portal';
const manageTag = 'EDP tracking panel';
const studentAuth = 'Portal token (`Authorization: Bearer` from /edp/auth/verify-otp or /edp/auth/login).';
const adminAuth = 'Tracking panel token (`Authorization: Bearer` from /edp/manage/auth/login).';

const Account = z.object({
  id: z.string().uuid(),
  first_name: z.string(),
  middle_name: z.string().nullable(),
  last_name: z.string(),
  email: z.string(),
  mobile_number: z.string(),
  email_verified: z.boolean(),
});
const Session = z.object({ token: z.string(), expires_at: z.string(), account: Account });
const OtpTiming = z.object({ email: z.string(), otp_expires_in: z.number().int(), resend_after: z.number().int() });
const Ref = z.object({ id: z.string().uuid(), code: z.string(), name: z.string() });
const Options = z.object({
  regions: z.array(Ref),
  castes: z.array(Ref),
  educations: z.array(Ref),
  document_types: z.array(
    Ref.extend({
      is_mandatory: z.boolean(),
      barcode: z.enum(['required', 'optional']).nullable().describe('Always null: the portal asks for no certificate barcodes'),
      formats: z.array(z.string()).describe('Accepted file formats, e.g. ["PDF","JPG","JPEG","PNG"] or ["MP4"]'),
      max_mb: z.number().int().describe('Largest accepted file, in MB'),
    }),
  ),
  genders: z.array(z.string()),
  marital_statuses: z.array(z.string()),
  districts: z.array(Ref),
  centres: z.array(Ref.extend({ district_name: z.string() })),
  grading_types: z.array(z.object({ code: z.string(), name: z.string() })),
  cgpa_scales: z.array(z.number()),
  qualification_classes: z.array(z.string()),
  religions: z.array(z.string()),
  tracks: z.array(z.object({ code: z.string(), name: z.string() })),
  support: z
    .object({ message: z.string(), email: z.string().nullable(), mobile: z.string().nullable() })
    .describe('Contact for queries, shown after submitting (EDP_SUPPORT_EMAIL / EDP_SUPPORT_MOBILE); null = not set'),
});
const FileDto = z.object({
  doc_type: z.string(),
  name: z.string(),
  original_name: z.string(),
  mime_type: z.string(),
  size_bytes: z.number().int(),
  uploaded_at: z.string(),
});
const Application = z.object({
  status: z.enum(['DRAFT', 'SUBMITTED']).describe('SUBMITTED is final: the form cannot be changed afterwards'),
  current_step: z.number().int(),
  steps: z.object({ basic_completed: z.boolean(), main_completed: z.boolean() }),
  editable: z.boolean(),
  submitted_at: z.string().nullable(),
  form: z.record(z.string()),
  barcodes: z.record(z.string()),
  draft_files: z.array(FileDto),
  submitted_files: z.array(FileDto.extend({ verified: z.boolean() })),
  registration: z
    .object({
      registration_id: z.string(),
      registration_number: z.string().nullable(),
      status: z.string(),
      aadhaar_masked: z.string().nullable(),
      display: z.record(z.string().nullable()),
    })
    .nullable(),
});
const Submitted = z.object({ registration_id: z.string(), registration_number: z.string().nullable(), status: z.string() });

documentEndpoint({
  method: 'post',
  path: '/edp/auth/register',
  tag,
  summary: 'Create a portal account and email a one-time code',
  description:
    'Stores the account unverified and emails a 6-digit OTP (valid EDP_OTP_TTL_SECONDS, default 5 minutes; a new one can be requested after EDP_OTP_RESEND_SECONDS, default: once the current one has expired). Signing up again before verifying replaces the details and password; while the earlier OTP still works no new one is sent and its remaining timing is returned. A verified email → 409. Rate limited per IP.',
  permission: 'public',
  request: { body: signupBody },
  response: envelope(OtpTiming),
  errors: [409, 503],
});
documentEndpoint({
  method: 'post',
  path: '/edp/auth/verify-otp',
  tag,
  summary: 'Verify the emailed OTP; the account is created and signed in',
  description:
    'Needs the password chosen at sign-up with the code (the code proves the inbox, the password who signed up). Expired → 400 `OTP_EXPIRED` (checked first); wrong code → 400 `OTP_INCORRECT` ("Incorrect OTP"); another password → 400 `SIGNUP_PASSWORD_MISMATCH`; 5 wrong attempts → 429 `OTP_TOO_MANY_ATTEMPTS`.',
  permission: 'public',
  request: { body: otpBody },
  response: envelope(Session),
  status: 200,
  errors: [400, 409],
});
documentEndpoint({
  method: 'post',
  path: '/edp/auth/resend-otp',
  tag,
  summary: 'Email a new OTP (by default once the current one has expired); only the newest OTP works',
  description: 'Too soon → 429 `OTP_RESEND_TOO_SOON` ("Please wait 4 min 47 s before requesting a new OTP.").',
  permission: 'public',
  request: { body: emailBody },
  response: envelope(OtpTiming),
  status: 200,
  errors: [404, 409, 503],
});
documentEndpoint({
  method: 'post',
  path: '/edp/auth/otp-status',
  tag,
  summary: "The pending OTP's remaining lifetime and the wait before a new one (seconds; 0 = expired / now)",
  description: 'For the OTP page: its countdowns follow the server after a reload or a login, when it cannot know when the OTP was sent.',
  permission: 'public',
  request: { body: emailBody },
  response: envelope(OtpTiming),
  status: 200,
  errors: [404, 409],
});
documentEndpoint({
  method: 'post',
  path: '/edp/auth/login',
  tag,
  summary: 'Sign in with email and password',
  description: 'An unverified account gets a new OTP and 403 `EMAIL_NOT_VERIFIED`.',
  permission: 'public',
  request: { body: loginBody },
  response: envelope(Session),
  status: 200,
  errors: [401, 403],
});
documentEndpoint({
  method: 'post',
  path: '/edp/auth/forgot-password',
  tag,
  summary: 'Forgot password: email a link to set a new password (valid 30 minutes, usable once)',
  description:
    'Registered email IDs only: no account → 404 `EMAIL_NOT_REGISTERED` ("This email ID is not registered. Kindly check your email ID."); a disabled account → 403. A new link replaces the previous one; at most one a minute and 5 an hour per account (past that → 429 `RESET_TOO_SOON`, no email). The link opens EDP_PORTAL_URL/reset-password.',
  permission: 'public',
  request: { body: emailBody },
  response: envelope(z.object({ email: z.string(), link_valid_minutes: z.number().int(), resend_after: z.number().int() })),
  status: 200,
  errors: [403, 404, 503],
});
documentEndpoint({
  method: 'post',
  path: '/edp/auth/reset-password/check',
  tag,
  summary: 'Whether a password reset link can still be used, and for which email',
  description: 'Unknown or used link → 400 `RESET_LINK_INVALID`; past its 30 minutes → 400 `RESET_LINK_EXPIRED`.',
  permission: 'public',
  request: { body: resetTokenBody },
  response: envelope(z.object({ email: z.string() })),
  status: 200,
  errors: [400],
});
documentEndpoint({
  method: 'post',
  path: '/edp/auth/reset-password',
  tag,
  summary: 'Set a new password from a reset link (sign-up password rules)',
  description:
    'The link then stops working and portal sessions signed in before the change are refused (every device is signed out). An account whose email was not verified yet becomes verified. Errors as /reset-password/check.',
  permission: 'public',
  request: { body: resetPasswordBody },
  response: envelope(z.object({ email: z.string() })),
  status: 200,
  errors: [400],
});
documentEndpoint({
  method: 'get',
  path: '/edp/options',
  tag,
  summary: 'Dropdown values: active masters only, plus religions, tracks, document types and the contact for queries',
  permission: 'public',
  response: envelope(Options),
});
documentEndpoint({
  method: 'get',
  path: '/edp/me',
  tag,
  summary: 'The signed-in account',
  description: studentAuth,
  permission: null,
  response: envelope(Account),
});
documentEndpoint({
  method: 'get',
  path: '/edp/application',
  tag,
  summary: 'The application: draft and step, or the submitted record as it is now in the student register',
  description: studentAuth,
  permission: null,
  response: envelope(Application),
});
documentEndpoint({
  method: 'put',
  path: '/edp/application/steps/:step',
  tag,
  summary: 'Save a step (1 Basic Details, 2 Main Form, 3 barcodes); complete=true checks it and moves on',
  description: studentAuth,
  permission: null,
  request: { params: stepParams, body: saveStepBody },
  response: envelope(Application),
  errors: [409],
});
documentEndpoint({
  method: 'post',
  path: '/edp/application/documents',
  tag,
  summary: 'Upload documents (step 3): one file per field named after the document type code',
  description: `${studentAuth} PDF, JPG, JPEG or PNG, at most 5 MB each; replaces an earlier file of the same type.`,
  permission: null,
  request: { multipart: z.object({ PHOTO: z.string().openapi({ format: 'binary' }).optional() }) },
  response: envelope(Application),
  status: 200,
  errors: [409],
});
documentEndpoint({
  method: 'delete',
  path: '/edp/application/documents/:docType',
  tag,
  summary: 'Remove an uploaded document (before submission)',
  description: studentAuth,
  permission: null,
  request: { params: docTypeParams },
  response: envelope(Application),
  errors: [404, 409],
});
documentEndpoint({
  method: 'get',
  path: '/edp/application/documents/:docType/file',
  tag,
  summary: "Download the student's own document",
  description: studentAuth,
  permission: null,
  request: { params: docTypeParams },
  response: { file: 'application/octet-stream' },
  errors: [404],
});
documentEndpoint({
  method: 'post',
  path: '/edp/application/submit',
  tag,
  summary: 'Submit the form: creates the registration in the student register (Amrut admin panel Student Registrations)',
  description: `${studentAuth} Same checks as the admin form; same Aadhaar as an existing student → 409. The submission is final: afterwards the form cannot be changed (409 \`ALREADY_SUBMITTED\`).`,
  permission: null,
  request: { body: submitBody },
  response: envelope(Submitted),
  errors: [409],
});

const Stage = z.enum(Object.keys(EDP_STAGES) as [string, ...string[]]);
const FollowUp = z.object({
  status: z.enum(Object.keys(EDP_FOLLOW_UP_STATUS) as [string, ...string[]]),
  status_label: z.string(),
  note: z.string().nullable(),
  at: z.string(),
  by: z.string().nullable().describe('Name of the EDP admin who recorded it'),
});
documentEndpoint({
  method: 'post',
  path: '/edp/manage/auth/login',
  tag: manageTag,
  summary: 'Tracking panel sign-in',
  permission: 'public',
  request: { body: loginBody },
  response: envelope(
    z.object({ token: z.string(), expires_at: z.string(), admin: z.object({ id: z.string(), name: z.string(), email: z.string() }) }),
  ),
  status: 200,
  errors: [401],
});
documentEndpoint({
  method: 'get',
  path: '/edp/manage/me',
  tag: manageTag,
  summary: 'The signed-in tracking panel admin',
  description: adminAuth,
  permission: null,
  response: envelope(z.object({ id: z.string(), name: z.string(), email: z.string() })),
});
documentEndpoint({
  method: 'get',
  path: '/edp/manage/summary',
  tag: manageTag,
  summary: 'Students per stage',
  description: adminAuth,
  permission: null,
  response: envelope(
    z.object({
      total: z.number().int(),
      counts: z.record(z.number().int()),
      stages: z.array(z.object({ code: Stage, label: z.string(), count: z.number().int() })),
      follow_ups: z.record(z.number().int()).describe('Students per current follow-up status; NONE = not followed up yet'),
    }),
  ),
});
documentEndpoint({
  method: 'get',
  path: '/edp/manage/applicants',
  tag: manageTag,
  summary: 'Every portal account with its stage and step dates (newest first)',
  description: adminAuth,
  permission: null,
  request: { query: manageListQuery },
  response: pagedEnvelope(
    z.object({
      id: z.string().uuid(),
      name: z.string(),
      email: z.string(),
      mobile_number: z.string(),
      stage: Stage,
      stage_label: z.string(),
      account_created_at: z.string(),
      otp_verified_at: z.string().nullable(),
      last_login_at: z.string().nullable(),
      basic_completed_at: z.string().nullable(),
      main_completed_at: z.string().nullable(),
      submitted_at: z.string().nullable(),
      registration_id: z.string().nullable(),
      registration_number: z.string().nullable(),
      last_activity_at: z.string(),
      follow_up: FollowUp.nullable().describe('The latest follow-up; null = not followed up yet'),
    }),
  ),
});
documentEndpoint({
  method: 'get',
  path: '/edp/manage/applicants/:id/follow-ups',
  tag: manageTag,
  summary: "A student's follow-ups, newest first",
  description: adminAuth,
  permission: null,
  request: { params: applicantParams },
  response: envelope(z.array(FollowUp)),
  errors: [404],
});
documentEndpoint({
  method: 'post',
  path: '/edp/manage/applicants/:id/follow-ups',
  tag: manageTag,
  summary: 'Record a follow-up (status + optional note); it becomes the current follow-up status',
  description: `${adminAuth} Statuses: ${Object.entries(EDP_FOLLOW_UP_STATUS)
    .map(([k, v]) => `\`${k}\` (${v})`)
    .join(', ')}. Returns the whole history, newest first.`,
  permission: null,
  request: { params: applicantParams, body: followUpBody },
  response: envelope(z.array(FollowUp)),
  errors: [404],
});

/* Dependent dropdowns of the form, and the Center Master of the tracking panel (same centres as /cms/centres). */
const Option = z.object({ id: z.string().uuid(), name: z.string(), code: z.string().nullable() });
const TechnologyOption = z.object({ code: z.string().describe('Track code, T01–T12'), name: z.string() });
const Centre = z.object({
  id: z.string().uuid(),
  name: z.string(),
  code: z.string(),
  stateId: z.string().uuid(),
  stateName: z.string(),
  districtId: z.string().uuid(),
  districtName: z.string(),
  talukaId: z.string().uuid().nullable(),
  talukaName: z.string().nullable(),
  address: z.string().nullable(),
  pinCode: z.string().nullable(),
  contactPerson: z.string().nullable(),
  contactNumber: z.string().nullable(),
  email: z.string().nullable(),
  technologies: z.array(TechnologyOption.extend({ usable: z.boolean() })),
  isActive: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
documentEndpoint({
  method: 'get',
  path: '/edp/districts/:districtId/talukas',
  tag,
  summary: 'Active talukas of a district (Basic Details: Taluka dropdown)',
  permission: 'public',
  request: { params: parentIdParams('districtId') },
  response: envelope(z.array(Option)),
  errors: [404],
});
documentEndpoint({
  method: 'get',
  path: '/edp/centres/:centreId/technologies',
  tag,
  summary: 'Technologies (3rd module selections) currently allocated to an active centre (Main Form: Technology dropdown)',
  description: 'Empty list when the centre has no usable allocation; 404 when the centre is unknown or inactive.',
  permission: 'public',
  request: { params: parentIdParams('centreId') },
  response: envelope(z.array(TechnologyOption)),
  errors: [404],
});
documentEndpoint({
  method: 'get',
  path: '/edp/manage/centres',
  tag: manageTag,
  summary: 'Center Master: centres with their district and allocated technologies',
  description: adminAuth,
  permission: null,
  request: { query: listCentresSchema.query },
  response: pagedEnvelope(Centre),
});
documentEndpoint({
  method: 'get',
  path: '/edp/manage/technology-options',
  tag: manageTag,
  summary: 'Technologies (T01–T12) a centre may be allocated: active tracks',
  description: adminAuth,
  permission: null,
  response: envelope(z.array(TechnologyOption)),
});
documentEndpoint({
  method: 'post',
  path: '/edp/manage/centres',
  tag: manageTag,
  summary: 'Create a centre (with its technologies)',
  description: adminAuth,
  permission: null,
  request: { body: createCentreSchema.body },
  response: envelope(Centre),
  status: 201,
  errors: [400, 409],
});
documentEndpoint({
  method: 'get',
  path: '/edp/manage/centres/:id',
  tag: manageTag,
  summary: 'A centre',
  description: adminAuth,
  permission: null,
  request: { params: centreIdSchema.params },
  response: envelope(Centre),
  errors: [404],
});
documentEndpoint({
  method: 'patch',
  path: '/edp/manage/centres/:id',
  tag: manageTag,
  summary: 'Update a centre; technologyCodes, when sent, replaces its technologies',
  description: adminAuth,
  permission: null,
  request: { params: updateCentreSchema.params, body: updateCentreSchema.body },
  response: envelope(Centre),
  errors: [400, 404, 409],
});
documentEndpoint({
  method: 'patch',
  path: '/edp/manage/centres/:id/status',
  tag: manageTag,
  summary: 'Activate or deactivate a centre',
  description: adminAuth,
  permission: null,
  request: { params: centreStatusSchema.params, body: centreStatusSchema.body },
  response: envelope(Centre),
  errors: [404],
});

documentEndpoint({
  method: 'get',
  path: '/edp/manage/applicants/:id',
  tag: manageTag,
  summary: 'One candidate in full (View): account, steps, every form value with names, Aadhaar masked, documents',
  description: adminAuth,
  permission: null,
  request: { params: applicantParams },
  response: envelope(
    z.object({
      account: z.object({
        id: z.string().uuid(),
        name: z.string(),
        email: z.string(),
        mobile_number: z.string(),
        created_at: z.string(),
        email_verified_at: z.string().nullable(),
        last_login_at: z.string().nullable(),
      }),
      status: z.enum(['DRAFT', 'SUBMITTED']),
      steps: z.object({
        basic_completed_at: z.string().nullable(),
        main_completed_at: z.string().nullable(),
        submitted_at: z.string().nullable(),
      }),
      registration: z.object({ registration_id: z.string().nullable(), registration_number: z.string().nullable() }).nullable(),
      aadhaar_masked: z.string().nullable(),
      form: z.record(z.string()).describe('Every form field (aadhaar_number is always empty here)'),
      display: z.record(z.string().nullable()).describe('Names of the referenced values (caste, centre, district, technology, …)'),
      documents: z.array(
        z.object({
          code: z.string(),
          name: z.string(),
          required: z.boolean(),
          file: FileDto.nullable(),
        }),
      ),
    }),
  ),
  errors: [404],
});
documentEndpoint({
  method: 'get',
  path: '/edp/manage/applicants/:id/documents/:docType/file',
  tag: manageTag,
  summary: "A candidate's uploaded document (inline; ?download=1 saves it as <registration ID>_<name>_<document>.<ext>)",
  description: adminAuth,
  permission: null,
  request: { params: applicantParams.merge(docTypeParams), query: fileDownloadQuery },
  response: { file: 'application/octet-stream' },
  errors: [404],
});
documentEndpoint({
  method: 'get',
  path: '/edp/manage/applicants/:id/documents.zip',
  tag: manageTag,
  summary: "All of a candidate's documents as one ZIP holding one folder (<registration ID>_<name>/01_Photo.pdf, …)",
  description: adminAuth,
  permission: null,
  request: { params: applicantParams },
  response: { file: 'application/zip' },
  errors: [404],
});

const EdpUser = z.object({
  id: z.string().uuid(),
  name: z.string(),
  email: z.string(),
  role: z.enum(['ADMIN', 'VIEWER']),
  is_active: z.boolean(),
  last_login_at: z.string().nullable(),
  created_at: z.string(),
});
const adminOnly = `${adminAuth} ADMIN role only (a VIEWER gets 403).`;
documentEndpoint({
  method: 'get',
  path: '/edp/manage/users',
  tag: manageTag,
  summary: 'Tracking panel users (ADMIN / VIEWER), newest first',
  description: adminOnly,
  permission: null,
  response: envelope(z.array(EdpUser)),
  errors: [403],
});
documentEndpoint({
  method: 'post',
  path: '/edp/manage/users',
  tag: manageTag,
  summary: 'Add a tracking panel user: ADMIN (full access) or VIEWER (view and download only)',
  description: adminOnly,
  permission: null,
  request: { body: newUserBody },
  response: envelope(EdpUser),
  status: 201,
  errors: [403, 409],
});
documentEndpoint({
  method: 'patch',
  path: '/edp/manage/users/:id/status',
  tag: manageTag,
  summary: 'Activate or deactivate a tracking panel user (not your own account)',
  description: adminOnly,
  permission: null,
  request: { params: applicantParams, body: userStatusBody },
  response: envelope(EdpUser),
  errors: [403, 404, 409],
});

const Support = z.object({
  message: z.string().describe('May use {email} and {mobile}'),
  email: z.string().nullable(),
  mobile: z.string().nullable(),
  updated_at: z.string().nullable(),
  updated_by: z.string().nullable(),
});
documentEndpoint({
  method: 'get',
  path: '/edp/manage/settings/support',
  tag: manageTag,
  summary: 'The support contact line shown to students (message, email, mobile)',
  description: adminAuth,
  permission: null,
  response: envelope(Support),
});
documentEndpoint({
  method: 'put',
  path: '/edp/manage/settings/support',
  tag: manageTag,
  summary: 'Save the support contact line shown to students and in the portal emails',
  description: `${adminAuth} ADMIN role only (a VIEWER gets 403).`,
  permission: null,
  request: { body: supportBody },
  response: envelope(Support),
  errors: [403],
});
