import { z } from 'zod';
import { documentEndpoint, envelope, pagedEnvelope, registry } from '../../shared/openapi/registry';
import { P } from '../roles-permissions';
import { DECIDE_PERMISSIONS, DECISION_ACTIONS, EVENTS, STAGES } from './ipp-approvals.constants';
import {
  approveBatchSchema,
  approveManySchema,
  approveSchema,
  documentSchema,
  headOfficeSchema,
  idSchema,
  listApplicationsSchema,
  listBatchesSchema,
  officerDistrictsSchema,
  rejectSchema,
  retrySchema,
} from './ipp-approvals.validation';

/* OpenAPI of the admin endpoints (docs/ipp-approvals.md). The DTOs are strict: the tests check the answers against them. */
const tag = 'IPP approvals';
const view = P.IPP_APPROVALS_VIEW;
const decide = [...DECIDE_PERMISSIONS];
const settingsView = 'settings.view';
const settingsUpdate = 'settings.update';

const ts = z.string().datetime();
const uuid = z.string().uuid();
const Stage = z.enum(STAGES);
const count = z.number().int();
const ref = z.object({ id: uuid, name: z.string() }).strict();
const perStage = z.object(Object.fromEntries(STAGES.map((s) => [s, count])) as Record<(typeof STAGES)[number], typeof count>).strict();

const EventDtoSchema = z
  .object({
    event: z.enum(EVENTS),
    from: Stage.nullable(),
    to: Stage,
    reason: z.string().nullable(),
    by: z.string(),
    role: z.string().nullable(),
    at: ts,
  })
  .strict();

export const IppApplicationRowDto = registry.register(
  'IppApplicationRow',
  z
    .object({
      id: uuid,
      registrationId: z.string(),
      registrationNumber: z.string().nullable(),
      name: z.string(),
      mobile: z.string(),
      email: z.string(),
      district: ref.describe('Of the batch'),
      category: z.string().nullable(),
      centre: z.string().nullable(),
      technology: z.string().nullable(),
      stage: Stage,
      stageLabel: z.string(),
      stageUpdatedAt: ts,
      batch: z.object({ id: uuid, code: z.string(), name: z.string() }).strict(),
      documents: z.object({ uploaded: count, verified: count }).strict(),
      lastEvent: EventDtoSchema.nullable().describe('The latest one that is not CORRECTED; history has them all'),
      canDecide: z.boolean().describe('By me, now'),
      reasonRequired: z.boolean().describe('Mine to decide now and decided at this level before: approving it again needs a reason'),
    })
    .strict(),
);

const target = z.object({ stage: Stage, label: z.string() }).strict().nullable();
export const IppApplicationDetailDto = registry.register(
  'IppApplicationDetail',
  IppApplicationRowDto.extend({
    aadhaarMasked: z.string().nullable().describe('XXXX-XXXX-1234'),
    formDistrict: z.string().nullable(),
    submittedAt: ts,
    auditor: z
      .object({
        approvedAt: ts.nullable(),
        by: z.string().nullable(),
        reason: z.string().nullable().describe("Why the Auditor approved it; null when approved before reasons were asked"),
      })
      .strict(),
    fields: z.array(
      z
        .object({
          key: z.string(),
          step: z.union([z.literal(1), z.literal(2)]),
          labelEn: z.string(),
          labelMr: z.string(),
          type: z.string(),
          text: z.string(),
        })
        .strict(),
    ),
    documentList: z.array(
      z
        .object({
          code: z.string(),
          name: z.string(),
          nameMr: z.string().nullable(),
          required: z.boolean(),
          kind: z.enum(['DOCUMENT', 'VIDEO']),
          file: z.object({ name: z.string(), mime: z.string(), size: count, uploadedAt: ts }).strict().nullable(),
          verified: z.boolean(),
          verifiedAt: ts.nullable(),
          verifiedBy: z.string().nullable(),
        })
        .strict(),
    ),
    edits: z.array(
      z
        .object({
          at: ts,
          by: z.string().nullable(),
          changes: z.array(z.object({ key: z.string(), label: z.string(), from: z.string(), to: z.string() }).strict()),
        })
        .strict(),
    ),
    history: z.array(EventDtoSchema).describe('Newest first'),
    approveTo: target.describe('Where my approval sends it; null = not mine to decide'),
    rejectTo: target.describe('Where my rejection sends it; null = not mine to decide'),
  }).strict(),
);

export const IppBatchDto = registry.register(
  'IppBatch',
  z
    .object({
      id: uuid,
      code: z.string(),
      name: z.string(),
      district: ref,
      centre: z.object({ code: z.string(), name: z.string() }).strict(),
      size: count,
      startDate: z.string().nullable(),
      endDate: z.string().nullable(),
      deliveryMode: z.enum(['OFFLINE', 'ONLINE', 'BLENDED']),
      technology: z.string().nullable(),
      sentBy: z.string().nullable(),
      receivedAt: ts,
      students: count.describe('Applications the user sees'),
      stages: perStage,
      toDecide: count,
    })
    .strict(),
);

export const IppSummaryDto = registry.register(
  'IppApprovalsSummary',
  z
    .object({
      stages: z.array(Stage).describe('The ones I decide now'),
      districts: z.array(ref).nullable().describe('null = not limited to districts'),
      headOfficeEnabled: z.boolean(),
      toDecide: count,
      sentBack: count.describe('Waiting for me after a rejection'),
      counts: perStage.describe('Of what I see'),
      views: z
        .object({ TO_DECIDE: count, SENT_ON: count, SENT_BACK: count, ALL: count })
        .strict()
        .describe('How many each list (GET /applications?view=…) holds'),
    })
    .strict(),
);

export const IppDecidedManyDto = registry.register(
  'IppDecidedMany',
  z
    .object({
      approved: count,
      skipped: count,
      applications: z.array(z.object({ id: uuid, stage: Stage, stageLabel: z.string() }).strict()),
    })
    .strict(),
);

const headOffice = { enabled: z.boolean(), updatedAt: ts.nullable(), updatedBy: z.string().nullable() };
export const IppHeadOfficeDto = registry.register('IppHeadOffice', z.object(headOffice).strict());
export const IppHeadOfficeChangedDto = registry.register(
  'IppHeadOfficeChanged',
  z.object({ ...headOffice, moved: count.describe('Applications that changed hands') }).strict(),
);

export const IppOfficerDto = registry.register(
  'IppOfficer',
  z.object({ id: uuid, name: z.string(), email: z.string(), isActive: z.boolean(), districts: z.array(ref) }).strict(),
);
export const IppOfficersDto = registry.register(
  'IppOfficers',
  z
    .object({
      officers: z.array(IppOfficerDto),
      withoutOfficer: z
        .array(z.object({ id: uuid, name: z.string(), waiting: count }).strict())
        .describe('Districts with applications at DIVISION and no active officer'),
    })
    .strict(),
);

export const IppLinkDto = registry.register(
  'IppLink',
  z
    .object({
      enabled: z.boolean(),
      configured: z.boolean(),
      host: z.string().nullable(),
      lastSentAt: ts.nullable(),
      lastReceivedAt: ts.nullable(),
      pending: count,
      failed: count,
      items: z
        .array(
          z
            .object({
              id: uuid,
              application: z.object({ id: uuid, registrationId: z.string(), name: z.string() }).strict(),
              action: z.enum(DECISION_ACTIONS),
              from: Stage,
              to: Stage,
              status: z.enum(['PENDING', 'FAILED']),
              attempts: count,
              nextAttemptAt: ts.nullable(),
              lastError: z.string().nullable(),
              createdAt: ts,
            })
            .strict(),
        )
        .describe('Pending and failed decisions, oldest first, at most 100'),
    })
    .strict(),
);

documentEndpoint({
  method: 'get',
  path: '/ipp-approvals/summary',
  tag,
  summary: 'What I decide, and how many forms are where',
  permission: view,
  response: envelope(IppSummaryDto),
});
documentEndpoint({
  method: 'get',
  path: '/ipp-approvals/applications',
  tag,
  summary: 'Student forms I see (default: those mine to decide now)',
  description:
    'A Divisional Officer sees the forms of batches of their districts, COEP and the Head Officer those that reached their level at least once, Super Admins and a user with only ipp-approvals.view all of them.',
  permission: view,
  request: { query: listApplicationsSchema.query },
  response: pagedEnvelope(IppApplicationRowDto),
});
documentEndpoint({
  method: 'get',
  path: '/ipp-approvals/applications/:id',
  tag,
  summary: 'One student form with its documents, corrections and history',
  permission: view,
  request: { params: idSchema.params },
  response: envelope(IppApplicationDetailDto),
  errors: [404],
});
documentEndpoint({
  method: 'get',
  path: '/ipp-approvals/applications/:id/documents/:code',
  tag,
  summary: 'A document of the form, fetched from IPP',
  description:
    'PDF, JPEG, PNG or MP4 of at most 60 MB, as an attachment. 502 IPP_UNAVAILABLE while IPP does not give it, 503 LINK_NOT_CONFIGURED while the link is off. Audited.',
  permission: view,
  request: { params: documentSchema.params },
  response: { file: 'application/octet-stream' },
  errors: [404, 502, 503],
});
documentEndpoint({
  method: 'get',
  path: '/ipp-approvals/batches',
  tag,
  summary: 'Batches with at least one form I see',
  permission: view,
  request: { query: listBatchesSchema.query },
  response: pagedEnvelope(IppBatchDto),
});
documentEndpoint({
  method: 'get',
  path: '/ipp-approvals/batches/:id',
  tag,
  summary: 'One batch',
  permission: view,
  request: { params: idSchema.params },
  response: envelope(IppBatchDto),
  errors: [404],
});
documentEndpoint({
  method: 'get',
  path: '/ipp-approvals/districts',
  tag,
  summary: 'Active districts, for filters and the officers',
  permission: [view, P.IPP_OFFICERS_VIEW],
  response: envelope(z.array(z.object({ id: uuid, name: z.string(), code: z.string() }).strict())),
});
documentEndpoint({
  method: 'post',
  path: '/ipp-approvals/approve',
  tag,
  summary: 'Approve several forms',
  description:
    'One reason (3–500 characters) for all, kept for each form approved; required (422) when any of them is a second approval at my level. What is not mine to decide now (another stage, not visible, unknown) is skipped.',
  permission: decide,
  request: { body: approveManySchema.body },
  response: envelope(IppDecidedManyDto),
  status: 200,
  idempotent: true,
});
documentEndpoint({
  method: 'post',
  path: '/ipp-approvals/batches/:id/approve',
  tag,
  summary: 'Approve all forms of a batch that are mine to decide now',
  description: 'One reason (3–500 characters) for all, kept for each form approved; required (422) when any of them is a second approval at my level.',
  permission: decide,
  request: { params: approveBatchSchema.params, body: approveBatchSchema.body },
  response: envelope(IppDecidedManyDto),
  status: 200,
  idempotent: true,
  errors: [404],
});
documentEndpoint({
  method: 'post',
  path: '/ipp-approvals/applications/:id/approve',
  tag,
  summary: 'Approve one form',
  description:
    'A reason (3–500 characters) is required (422) for a second approval: my level decided it before. 409 NOT_YOURS_TO_DECIDE when it is at another stage, or not mine.',
  permission: decide,
  request: { params: approveSchema.params, body: approveSchema.body },
  response: envelope(IppApplicationDetailDto),
  status: 200,
  errors: [404, 409],
});
documentEndpoint({
  method: 'post',
  path: '/ipp-approvals/applications/:id/reject',
  tag,
  summary: 'Send one form back one level',
  description: 'The reason (3–500 characters) is mandatory. 409 NOT_YOURS_TO_DECIDE when it is at another stage, or not mine.',
  permission: decide,
  request: { params: rejectSchema.params, body: rejectSchema.body },
  response: envelope(IppApplicationDetailDto),
  status: 200,
  errors: [404, 409],
});
documentEndpoint({
  method: 'get',
  path: '/ipp-approvals/head-office',
  tag,
  summary: 'The switch "Head Office approval"',
  permission: [view, settingsView],
  response: envelope(IppHeadOfficeDto),
});
documentEndpoint({
  method: 'put',
  path: '/ipp-approvals/head-office',
  tag,
  summary: 'Switch Head Office approval on or off',
  description: 'Forms waiting at the other final stage move in the same transaction.',
  permission: settingsUpdate,
  request: { body: headOfficeSchema.body },
  response: envelope(IppHeadOfficeChangedDto),
});
documentEndpoint({
  method: 'get',
  path: '/ipp-approvals/officers',
  tag,
  summary: 'Divisional Officers, their districts, and districts waiting without one',
  permission: P.IPP_OFFICERS_VIEW,
  response: envelope(IppOfficersDto),
});
documentEndpoint({
  method: 'put',
  path: '/ipp-approvals/officers/:userId/districts',
  tag,
  summary: 'Replace the districts of a Divisional Officer',
  description: '409 NOT_A_DIVISIONAL_OFFICER; 422 for an unknown or inactive district.',
  permission: P.IPP_OFFICERS_UPDATE,
  request: { params: officerDistrictsSchema.params, body: officerDistrictsSchema.body },
  response: envelope(IppOfficerDto),
  errors: [404, 409],
});
documentEndpoint({
  method: 'get',
  path: '/ipp-approvals/link',
  tag,
  summary: 'The link with IPP and the decisions not sent yet',
  permission: settingsView,
  response: envelope(IppLinkDto),
});
documentEndpoint({
  method: 'post',
  path: '/ipp-approvals/link/retry',
  tag,
  summary: 'Try failed decisions again',
  description: 'The given ones, or all failed ones when ids is left out.',
  permission: settingsUpdate,
  request: { body: retrySchema.body },
  response: envelope(z.object({ retried: count }).strict()),
  status: 200,
});
documentEndpoint({
  method: 'post',
  path: '/ipp-approvals/link/test',
  tag,
  summary: 'Call IPP and say whether it answers',
  description: '200 also when it fails (ok = false).',
  permission: settingsUpdate,
  response: envelope(z.object({ ok: z.boolean(), message: z.string() }).strict()),
  status: 200,
});
