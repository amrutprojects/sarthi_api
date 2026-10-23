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

const BoardMembers = z.object({
  heading: Bilingual,
  subtitle: Bilingual.nullable(),
  /* null when the notice under the cards is switched off. */
  notice: z.object({ title: Bilingual.nullable(), body: Bilingual }).nullable(),
  /* Visible members only, already in display order. */
  members: z.array(
    z.object({
      id: z.string().uuid(),
      /* null while the officeholder's name is still to be supplied; the website prints its placeholder. */
      name: z.string().nullable(),
      category: Bilingual,
      designation: Bilingual,
      description: Bilingual.nullable(),
      subtitle: Bilingual.nullable(),
      /* Relative to the API base URL, e.g. /public/board-members/photos/<uuid>.jpg; null when there is no photo. */
      photoUrl: z.string().nullable(),
    }),
  ),
});

documentEndpoint({
  method: 'get',
  path: '/public/board-members',
  tag,
  summary: 'Leadership & Governing Board section',
  description:
    'The "मान्यवर व संचालक मंडळ" section of the home and About pages: its heading, subtitle and notice, and the visible members ' +
    'in display order, in Marathi and English. Managed in the admin panel under CMS → Board Members Management. `data` is null ' +
    'when the section has not been configured.',
  permission: 'public',
  response: envelope(BoardMembers.nullable()),
});

const Ecosystem = z.object({
  heading: Bilingual,
  subtitle: Bilingual.nullable(),
  /* false: the website leaves the section out (programmes is then empty). */
  showSection: z.boolean(),
  /* Visible cards only, already in display order. */
  programmes: z.array(
    z.object({
      id: z.string().uuid(),
      name: Bilingual,
      description: Bilingual,
      /* An identifier from the website's icon set, e.g. "award". */
      icon: z.string(),
      /* A page of this site ("/programme") or an http(s) address; null when the card has no destination. */
      link: z.string().nullable(),
      /* The card's own label, or the section's default when it has none. */
      linkLabel: Bilingual,
    }),
  ),
});

documentEndpoint({
  method: 'get',
  path: '/public/ecosystem',
  tag,
  summary: 'The AMRUT Ecosystem (अमृत प्रणाली) cards',
  description:
    'The अमृत प्रणाली section of the home and About pages: its heading and subtitle and the visible programme cards in display ' +
    'order, in Marathi and English. Managed in the admin panel under CMS → The AMRUT Ecosystem. `data` is null when the section ' +
    'has not been configured.',
  permission: 'public',
  response: envelope(Ecosystem.nullable()),
});

const Schemes = z.object({
  heading: Bilingual,
  subtitle: Bilingual.nullable(),
  /* false: the website leaves the section out (schemes is then empty). */
  showSection: z.boolean(),
  /* Active schemes only, already in display order. */
  schemes: z.array(
    z.object({
      id: z.string().uuid(),
      title: Bilingual,
      description: Bilingual,
      /* The tag above the title, e.g. "This programme"; null when the scheme has none. */
      badge: Bilingual.nullable(),
      /* The last date as a calendar day, 'YYYY-MM-DD'; null when the scheme has none. Expired schemes are still listed. */
      deadline: z.string().nullable(),
      /* A page of this site ("/programme") or an http(s) address; null when the button has no destination. */
      link: z.string().nullable(),
      /* The scheme's own button label, or the section's default when it has none. */
      buttonLabel: Bilingual,
      /* true: the highlighted card style. */
      featured: z.boolean(),
    }),
  ),
});

documentEndpoint({
  method: 'get',
  path: '/public/schemes',
  tag,
  summary: 'AMRUT Schemes (अमृत योजना विभाग) cards',
  description:
    'The AMRUT Schemes section of the home page: its heading and subtitle and the active scheme cards in display order, in ' +
    'Marathi and English. Managed in the admin panel under CMS → AMRUT Schemes Management. `data` is null when the section ' +
    'has not been configured.',
  permission: 'public',
  response: envelope(Schemes.nullable()),
});

documentEndpoint({
  method: 'get',
  path: '/public/board-members/photos/:file',
  tag,
  summary: "A visible board member's photo",
  description:
    'The image named by a `photoUrl` from /public/board-members (JPEG, PNG or WebP). Served only while it belongs to a visible, ' +
    'non-deleted member; 404 otherwise. File names are immutable, so the response may be cached.',
  permission: 'public',
  request: { params: z.object({ file: z.string().describe('<uuid>.jpg | .png | .webp') }) },
  response: { file: 'image/jpeg' },
  errors: [404],
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

const About = z.object({
  heading: Bilingual,
  subtitle: Bilingual.nullable(),
  /* Plain text; line breaks separate paragraphs. */
  description: Bilingual,
  /* false: the website leaves the section out (facts and cards are then empty). */
  showSection: z.boolean(),
  /* Visible information rows only, in display order. */
  facts: z.array(z.object({ id: z.string().uuid(), label: Bilingual, value: Bilingual })),
  /* Visible cards only (Our Mission, Our Vision, Our Values, …), in display order. */
  cards: z.array(z.object({ id: z.string().uuid(), heading: Bilingual, description: Bilingual })),
});

documentEndpoint({
  method: 'get',
  path: '/public/about',
  tag,
  summary: 'About AMRUT section',
  description:
    'The "About AMRUT" (अमृत विषयी माहिती) section of the home page, also used by the About page: its heading, description, ' +
    'information rows and cards, in Marathi and English. Managed in the admin panel under CMS → About AMRUT Management. ' +
    '`data` is null when the section has not been configured.',
  permission: 'public',
  response: envelope(About.nullable()),
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
