import { z } from 'zod';
import { documentEndpoint, envelope } from '../shared/openapi/registry';
import { parentIdParams } from '../shared/validation/common.validation';
import { NAV_MENU_KEYS } from './navmenu/navmenu.types';

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
    'The banner, the organisation cards, the district / cluster coordinators and the per-district office ' +
    '(Collectorate) details shown on the public Contact pages, in Marathi and English. ' +
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
        coordinators: z.array(
          z.object({
            name: z.string(),
            phone: z.string(),
            email: z.string().email().optional(),
            districts: z.array(z.object({ code: z.string(), name: z.string() })),
          }),
        ),
        districtOffices: z.array(
          z.object({
            district: z.object({ code: z.string(), name: z.string() }),
            collectorName: z.string().optional(),
            address: Bilingual.optional(),
            phone: z.string().optional(),
            email: z.string().email().optional(),
            officeHours: Bilingual.optional(),
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
    'The home page band: heading, tagline, objectives and certification line, in Marathi and English. `data` is null only when ' +
    'not configured; an unpublished band has `showSection: false`.',
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
    'Only active objectives, in display order. `data` is null only when the section has not been configured; the website then ' +
    'renders its bundled copy. An unpublished section is not null: `showSection` is false and the website leaves the band out.',
  permission: 'public',
  response: envelope(
    z
      .object({
        /* The publish switch. false: the website leaves the band out (objectives is then empty). */
        showSection: z.boolean(),
        heading: Bilingual,
        subheading: Bilingual,
        tagline: Bilingual,
        certification: Bilingual,
        objectives: z.array(Bilingual),
      })
      .nullable(),
  ),
});

const HomeHero = z.object({
  /* The publish switch. false: the website leaves the whole banner out, glance card included (slides is then empty). */
  showSection: z.boolean(),
  /* false: the website leaves out only the "Programme at a glance" card (its figures come from /public/modules). */
  showGlance: z.boolean(),
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
    'the two buttons shown on every slide, in Marathi and English, and the switches for the banner and its "Programme at a ' +
    'glance" card. `data` is null only when not configured; the website then renders its bundled copy. An unpublished banner ' +
    'is not null: `showSection` is false and the website leaves it out.',
  permission: 'public',
  response: envelope(HomeHero.nullable()),
});

const BoardMembers = z.object({
  /* false: the website leaves the section out, on the home and About pages (members is then empty). */
  showSection: z.boolean(),
  heading: Bilingual,
  subtitle: Bilingual.nullable(),
  /* null when the notice under the cards is switched off. */
  notice: z.object({ title: Bilingual.nullable(), body: Bilingual }).nullable(),
  /* Visible members only, already in display order. */
  members: z.array(
    z.object({
      id: z.string().uuid(),
      /* null while the officeholder's name is still to be supplied; the website then prints no name. */
      name: Bilingual.nullable(),
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

/*
 * A profile list of the "View Profile" dialog: the items in each language, in order. Either language may be
 * empty ([]); the whole list is null when both are. Sent as stored — the website picks the visitor's language
 * and falls back to the other one.
 */
const AdvisoryProfileList = z.object({ mr: z.array(z.string()), en: z.array(z.string()) }).nullable();

const AdvisoryMember = z.object({
  id: z.string().uuid(),
  name: Bilingual,
  /* The position line ("Vice Chancellor, COEP Technological University, Pune"); null when the member has none. */
  designation: Bilingual.nullable(),
  /* Relative to the API base URL, e.g. /public/advisory-committee/photos/<uuid>.jpg; null when there is no photo. */
  photoUrl: z.string().nullable(),
  /* One paragraph. A blank language is null, and the whole is null when both are blank. */
  experience: z.object({ mr: z.string().nullable(), en: z.string().nullable() }).nullable(),
  administrativeRoles: AdvisoryProfileList,
  keyAchievements: AdvisoryProfileList,
  majorContributions: AdvisoryProfileList,
  researchLeadership: AdvisoryProfileList,
  education: AdvisoryProfileList,
});

const AdvisoryCommittee = z.object({
  heading: Bilingual,
  subtitle: Bilingual.nullable(),
  /* Visible members in no group, already in display order — shown first, under no heading. */
  members: z.array(AdvisoryMember),
  /*
   * Visible groups in group display order, each a heading (e.g. the organisation the members belong to) with its
   * visible members in member display order. A group with no visible member is left out; the members of a hidden
   * group appear nowhere.
   */
  groups: z.array(z.object({ id: z.string().uuid(), name: Bilingual, members: z.array(AdvisoryMember) })),
});

documentEndpoint({
  method: 'get',
  path: '/public/advisory-committee',
  tag,
  summary: 'AMRUT Kalash Advisory Committee page',
  description:
    'The "अमृत कलश सल्लागार समिती" page: its heading and subtitle, and the visible trainers and advisors in display order, in ' +
    'Marathi and English, each with the profile behind its "View Profile" button (experience and five lists, any of which may ' +
    'be filled in one language only). Members in no group come in `members`; the rest under their group headings in `groups`. ' +
    'Managed in the admin panel under CMS → Advisory Committee Management. `data` is null when the section has not been configured.',
  permission: 'public',
  response: envelope(AdvisoryCommittee.nullable()),
});

documentEndpoint({
  method: 'get',
  path: '/public/advisory-committee/photos/:file',
  tag,
  summary: "A visible advisory committee member's photo",
  description:
    'The image named by a `photoUrl` from /public/advisory-committee (JPEG, PNG or WebP). Served only while it belongs to a ' +
    'visible, non-deleted member; 404 otherwise. File names are immutable, so the response may be cached.',
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

const Announcements = z.object({
  /* false: the ticker is switched off and the website shows no strip (items is then empty). */
  showSection: z.boolean(),
  /* The pill on the left of the ticker, e.g. "सूचना" / "Announcements". */
  label: Bilingual,
  /* Active announcements only, already in display order. Empty when the ticker is switched off: the website then shows no strip. */
  items: z.array(
    z.object({
      /* Printed in bold. */
      title: Bilingual,
      /* Printed after the title; absent when the announcement has none. */
      detail: Bilingual.optional(),
      /* A page of this site ("/apply") or an http(s) address; absent when the announcement is plain text. */
      link: z.string().optional(),
    }),
  ),
});

documentEndpoint({
  method: 'get',
  path: '/public/announcements',
  tag,
  summary: 'Announcements (सूचना) ticker',
  description:
    'The ticker that scrolls across the top of every website page: its label and the active announcements in display order, ' +
    'in Marathi and English. Managed in the admin panel under CMS → Home Page Management → Announcements. `data` is null when ' +
    'the ticker has not been configured (the website then shows its own bundled notice).',
  permission: 'public',
  response: envelope(Announcements.nullable()),
});

const TopBar = z.object({
  /* false: the website leaves the whole strip out, language switch included (links is then empty). */
  showSection: z.boolean(),
  /* The bold text on the left of the strip, e.g. "महाराष्ट्र शासन" / "Government of Maharashtra". Null when it is blank: the website then shows none. */
  governmentName: Bilingual.nullable(),
  /* Whether the Marathi / English switch on the right of the strip is shown. */
  showLanguageToggle: z.boolean(),
  /* Active links only, already in display order. */
  links: z.array(
    z.object({
      /* The text of the link. */
      label: Bilingual,
      /* A page of this site ("/verify") or an https:// address; an address typed as "www." is already stored with https://. */
      link: z.string(),
    }),
  ),
});

documentEndpoint({
  method: 'get',
  path: '/public/top-bar',
  tag,
  summary: 'Top Bar (strip at the top of every page)',
  description:
    'The strip at the very top of every website page: the government name, the links beside it (e.g. Verify Certificate, Check ' +
    'Application Status) in display order, and whether the language switch is shown, in Marathi and English. Managed in the admin ' +
    'panel under CMS → Home Page Management → Top Bar. `data` is null when the Top Bar has not been configured (the website then ' +
    'shows its own bundled strip).',
  permission: 'public',
  response: envelope(TopBar.nullable()),
});

const BrandBar = z.object({
  /* false: the website leaves the whole bar out. */
  showSection: z.boolean(),
  /* The bold title on the left of the bar, e.g. "AMRUT KALASH". Never blank. */
  title: z.string(),
  /* The organisation's full name, printed as two lines (Marathi above English) in every language. A blank half is a line not shown. */
  fullName: Bilingual,
  /*
   * The "Implementation Partner" block on the right of the bar. Null when the partner name is blank or the
   * partner box is switched off in the admin panel: the website then shows none.
   */
  partner: z
    .object({
      /* The small text above the name, e.g. "अंमलबजावणी भागीदार" / "Implementation Partner". Null when it is blank. */
      label: Bilingual.nullable(),
      name: z.string(),
    })
    .nullable(),
});

documentEndpoint({
  method: 'get',
  path: '/public/brand-bar',
  tag,
  summary: 'Brand Bar (bar under the Top Bar)',
  description:
    'The bar under the Top Bar on every website page: the programme title, the organisation\'s full name in Marathi and English, ' +
    'and the implementation partner. Managed in the admin panel under CMS → Home Page Management → Brand Bar. `data` is null when ' +
    'the Brand Bar has not been configured (the website then shows its own bundled bar). `partner` is null when the partner name ' +
    'is blank or the implementation partner box is switched off (its label and name are kept in the admin panel).',
  permission: 'public',
  response: envelope(BrandBar.nullable()),
});

const NavMenu = z.object({
  /* Every item of the menu bar, always all ten and in menu order. An item that was never switched is shown. */
  items: z.array(
    z.object({
      key: z.enum(NAV_MENU_KEYS),
      /* false: the website leaves the item out of the menu bar and the mobile menu (for `login`, the Login / Register button). */
      show: z.boolean(),
    }),
  ),
});

documentEndpoint({
  method: 'get',
  path: '/public/nav-menu',
  tag,
  summary: 'Navigation Menu (which menu bar items are shown)',
  description:
    'Whether each item of the menu bar under the Brand Bar, and its Login / Register button, is shown on the website. Every item ' +
    'comes back, in menu order; the page of a hidden item still opens by its address. Managed in the admin panel under CMS → ' +
    'Home Page Management → Navigation Menu. Never null: an item that was never switched is shown.',
  permission: 'public',
  response: envelope(NavMenu),
});
