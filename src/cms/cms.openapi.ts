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
  summary: 'Programme modules page',
  description:
    'Programme modules, hours and elective domains for the public website. The Modules page has no publish switch, ' +
    'so this is always the saved content; each module carries `showElectiveLabel`, which decides whether the site ' +
    'prints the "Elective" badge on an elective card. `data` is null only when the page has not been configured ' +
    '(no active settings row).',
  permission: 'public',
  response: envelope(z.object({}).passthrough().nullable()),
});

documentEndpoint({
  method: 'get',
  path: '/public/highlight',
  tag,
  summary: 'Published home page programme section',
  description:
    'The home page band: heading, tagline, objectives and certification line, in Marathi and English. `data` is null when unpublished.',
  permission: 'public',
  response: envelope(z.object({}).passthrough().nullable()),
});

documentEndpoint({
  method: 'get',
  path: '/public/highlight',
  tag,
  summary: 'Home page programme section',
  description:
    'Heading, subheading, tagline, certification line and objectives of the home page programme band, in Marathi and English. ' +
    'Only active objectives, in display order. `data` is null when the section is unpublished; the website then renders its bundled copy.',
  permission: 'public',
  response: envelope(
    z
      .object({ heading: Bilingual, subheading: Bilingual, tagline: Bilingual, certification: Bilingual, objectives: z.array(Bilingual) })
      .nullable(),
  ),
});

const HomeHero = z.object({
  /* The two buttons printed on every slide; their links are fixed (/programme and /track). */
  readMoreLabel: Bilingual,
  checkStatusLabel: Bilingual,
  /* Visible slides only, already in display order. `ctaLink` is a page of this site, e.g. '/apply'. */
  slides: z.array(
    z.object({
      tag: Bilingual,
      title: Bilingual,
      description: Bilingual,
      ctaLabel: Bilingual,
      ctaLink: z.string(),
    }),
  ),
});

documentEndpoint({
  method: 'get',
  path: '/public/hero',
  tag,
  summary: 'Published home page hero banner',
  description:
    'The rotating banner at the top of the home page: the tag, heading, description and button of each slide, and the labels of ' +
    'the two buttons shown on every slide, in Marathi and English. `data` is null when unpublished or not configured; the ' +
    'website then renders its bundled copy.',
  permission: 'public',
  response: envelope(HomeHero.nullable()),
});

const ProgrammePage = z.object({
  intro: Bilingual,
  objectives: z.array(Bilingual),
  methodology: z.array(z.object({ label: Bilingual, value: Bilingual })),
  assessment: z.array(z.object({ component: Bilingual, min: z.number().int(), max: z.number().int() })),
  assessmentNote: Bilingual,
  certification: z.array(Bilingual),
  trainingModes: z.object({
    title: Bilingual,
    modes: z.array(z.object({ name: Bilingual, description: Bilingual })),
    note: Bilingual,
  }),
  /* The entered figures only; total hours, the module line and the elective count are summed from /public/modules. */
  facts: z.object({
    idealMonths: z.number().int(),
    validityMonths: z.number().int(),
    securityDeposit: z.number().int(),
    applyLeadDays: z.number().int(),
    partnerName: z.string(),
  }),
});

documentEndpoint({
  method: 'get',
  path: '/public/programme',
  tag,
  summary: 'Published Programme page content',
  description:
    'Introduction, objectives, learning methodology, assessment criteria, certification and the programme fact sheet ' +
    'for the public /programme page, ' +
    'in Marathi and English. `data` is null when unpublished; the website then renders its bundled copy.',
  permission: 'public',
  response: envelope(ProgrammePage.nullable()),
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

documentEndpoint({
  method: 'get',
  path: '/public/apply',
  tag,
  summary: 'Apply page content',
  description:
    'The text, application steps, "At a glance" rows and call to action on the public Apply ("How to Apply") page, in ' +
    'Marathi and English, plus the official portal link (https only). Each list holds only active, non-deleted entries, ' +
    'in display order; an empty list means every entry of that kind is deactivated. `documents` is the Eligibility ' +
    "page's active required documents (the same list, managed under CMS → Eligibility Page Management). `data` is null " +
    'when the page has not been configured — the website then renders its own bundled copy. Managed in the admin panel ' +
    'under CMS → Apply Page Management.',
  permission: 'public',
  response: envelope(
    z
      .object({
        pageTitle: Bilingual,
        pageSubtitle: Bilingual,
        noteTitle: Bilingual,
        noteBody: Bilingual,
        glanceHeading: Bilingual,
        documentsHeading: Bilingual,
        ctaText: Bilingual,
        ctaLabel: Bilingual,
        ctaUrl: z.string().url(),
        ctaHint: Bilingual,
        steps: z.array(z.object({ title: Bilingual, description: Bilingual })),
        facts: z.array(z.object({ label: Bilingual, value: Bilingual })),
        documents: z.array(Bilingual),
      })
      .nullable(),
  ),
});

const Impact = z.object({
  heading: Bilingual,
  /* false: the website leaves the section out (stats is then empty). */
  showSection: z.boolean(),
  /* Active cards only, already in display order. `value` is printed exactly as entered, e.g. "1,000+". */
  stats: z.array(z.object({ id: z.string().uuid(), value: z.string(), label: Bilingual })),
});

documentEndpoint({
  method: 'get',
  path: '/public/impact',
  tag,
  summary: "AMRUT's Impact (अमृतचा प्रभाव) figures",
  description:
    "The AMRUT's Impact band of the home page: its heading and the active statistic cards in display order, in Marathi and " +
    'English. Every figure is entered by hand — none is counted automatically. Managed in the admin panel under CMS → AMRUT ' +
    'Impact Management. `data` is null when the section has not been configured.',
  permission: 'public',
  response: envelope(Impact.nullable()),
});
