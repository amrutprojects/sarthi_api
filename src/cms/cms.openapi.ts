import { z } from 'zod';
import { documentEndpoint, envelope } from '../shared/openapi/registry';
import { parentIdParams } from '../shared/validation/common.validation';

/*
 * API contract for the CMS read feeds the public website consumes.
 *
 * Scope note: only the `/public/*` endpoints are documented here, not the authenticated `/cms/*`
 * ones. That is not an oversight — the contract test walks `apiRouter.stack` exactly one level
 * deep, so it sees routers mounted directly on it (publicGeographyRouter, publicContactRouter) but
 * not routes nested inside `cmsRouter`, which mounts its own sub-routers. Documenting the `/cms/*`
 * endpoints here would therefore FAIL the test's second assertion ("documents no route that does
 * not exist"), because the walker cannot find them to match against.
 */

const tag = 'CMS (public)';

/* Shared option shape: just enough to render a dropdown option and post back an id. */
const GeoOption = z.object({
  id: z.string().uuid(),
  name: z.string(),
  code: z.string().nullable(),
});

const Bilingual = z.object({ mr: z.string(), en: z.string() });

documentEndpoint({
  method: 'get',
  path: '/public/geography/states',
  tag,
  summary: 'Active states, for the public application form',
  description: 'Only active, non-deleted records. Managed in the admin panel under CMS → State Master.',
  permission: 'public',
  response: envelope(z.array(GeoOption)),
});

documentEndpoint({
  method: 'get',
  path: '/public/geography/states/:stateId/districts',
  tag,
  summary: 'Active districts of one state',
  description: 'The second level of the State → District → Taluka cascade. 404 when the state does not exist.',
  permission: 'public',
  request: { params: parentIdParams('stateId') },
  response: envelope(z.array(GeoOption.extend({ stateId: z.string().uuid() }))),
  errors: [404],
});

documentEndpoint({
  method: 'get',
  path: '/public/geography/districts/:districtId/talukas',
  tag,
  summary: 'Active talukas of one district',
  description: 'The third level of the cascade. 404 when the district does not exist.',
  permission: 'public',
  request: { params: parentIdParams('districtId') },
  response: envelope(z.array(GeoOption.extend({ districtId: z.string().uuid() }))),
  errors: [404],
});

documentEndpoint({
  method: 'get',
  path: '/public/contact',
  tag,
  summary: 'Published Contact page content',
  description:
    'The banner and the organisation cards shown on the public Contact page, in Marathi and English. ' +
    '`data` is null when the page is unpublished or has not been configured — a normal state, not an ' +
    'error: the website then renders its own bundled copy.',
  permission: 'public',
  response: envelope(
    z
      .object({
        pageTitle: Bilingual,
        pageSubtitle: Bilingual,
        organizations: z.array(
          z.object({
            orgType: z.enum(['AMRUT', 'IMPLEMENTATION_PARTNER']),
            name: Bilingual,
            role: Bilingual.optional(),
            address: Bilingual.optional(),
            email: z.string().email().optional(),
            phone: z.string().optional(),
            websiteUrl: z.string().url().optional(),
            helpdeskHours: Bilingual.optional(),
          }),
        ),
      })
      .nullable(),
  ),
});

documentEndpoint({
  method: 'get',
  path: '/public/footer',
  tag,
  summary: 'Published site footer',
  description: 'Footer columns and links for the public website, in Marathi and English. `data` is null when unpublished.',
  permission: 'public',
  response: envelope(z.object({}).passthrough().nullable()),
});

documentEndpoint({
  method: 'get',
  path: '/public/modules',
  tag,
  summary: 'Published programme modules page',
  description: 'Programme modules, hours and elective domains for the public website. `data` is null when unpublished.',
  permission: 'public',
  response: envelope(z.object({}).passthrough().nullable()),
});

documentEndpoint({
  method: 'get',
  path: '/public/faqs',
  tag,
  summary: 'Active FAQs',
  description: 'The questions on the public FAQ page, in Marathi and English, in display order. Only active, non-deleted questions. Managed in the admin panel under CMS → FAQ Management.',
  permission: 'public',
  response: envelope(z.array(z.object({ question: Bilingual, answer: Bilingual }))),
});

documentEndpoint({
  method: 'get',
  path: '/public/eligibility',
  tag,
  summary: 'Eligibility page content',
  description:
    'The text, eligibility criteria and required documents on the public Eligibility page, in Marathi and English. ' +
    'Each list holds only active, non-deleted entries, in display order; an empty list means every entry of that kind is ' +
    'deactivated. `data` is null when the page has not been configured — the website then renders its own bundled copy. ' +
    'Managed in the admin panel under CMS → Eligibility Page Management.',
  permission: 'public',
  response: envelope(
    z
      .object({
        pageTitle: Bilingual,
        pageSubtitle: Bilingual,
        criteriaHeading: Bilingual,
        documentsHeading: Bilingual,
        noteTitle: Bilingual,
        noteBody: Bilingual,
        criteria: z.array(z.object({ label: Bilingual, value: Bilingual })),
        documents: z.array(Bilingual),
      })
      .nullable(),
  ),
});
