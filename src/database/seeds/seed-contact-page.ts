import type { DataSource, EntityManager } from 'typeorm';
import { ContactOrganization, ContactPageSettings } from '../../cms/contact/contact.model';

export interface ContactSeedSummary {
  created: boolean;
  organizationsCreated: number;
}

/*
 * Initial Contact page content.
 *
 * The values below are exactly what the public site displayed before it became CMS-managed
 * (public-site/content/org.ts and content/strings.ts), so seeding changes nothing a visitor sees —
 * it only moves the source of truth into the database.
 *
 * Marathi first, as on the AMRUT portal. The organisation names are the same string in both
 * languages today, which is what the page renders now; an administrator can translate them later
 * and the Marathi view will follow.
 */
const PAGE = {
  pageTitleMr: 'संपर्क',
  pageTitleEn: 'Contact',
  pageSubtitleMr: 'संपर्क माहिती',
  pageSubtitleEn: 'Contact Information',
};

const ORGANIZATIONS = [
  {
    orgType: 'AMRUT' as const,
    nameMr: 'AMRUT',
    nameEn: 'AMRUT',
    addressMr: '५ वा मजला, अमृत इमारत, भीमसेन जोशी सभागृहाजवळ, प्रभाग क्र. ८, पीएमआरडीए, औंध, पुणे, महाराष्ट्र ४११०६७.',
    addressEn: '5th Floor, AMRUT Building, near Bhimsen Joshi Sabhagruh, Ward No. 8, PMRDA, Aundh, Pune, Maharashtra 411067.',
    email: 'info@mahaamrut.org.in',
    phone: '+91 97301 51450',
    websiteUrl: 'https://mahaamrut.org.in/',
    roleMr: null,
    roleEn: null,
    helpdeskHoursMr: null,
    helpdeskHoursEn: null,
    displayOrder: 0,
  },
  {
    orgType: 'IMPLEMENTATION_PARTNER' as const,
    nameMr: 'SUMAGO INFOTECH PVT LTD',
    nameEn: 'SUMAGO INFOTECH PVT LTD',
    roleMr: 'अंमलबजावणी व तंत्रज्ञान भागीदार',
    roleEn: 'Implementation & technology partner',
    email: 'programme@sumago.demo',
    helpdeskHoursMr: 'सोम–शनि, १०:०० – १८:००',
    helpdeskHoursEn: 'Mon–Sat, 10:00 – 18:00',
    addressMr: null,
    addressEn: null,
    phone: null,
    websiteUrl: null,
    displayOrder: 1,
  },
];

/*
 * Idempotent, and deliberately all-or-nothing about it: if a configuration row already exists this
 * does NOTHING AT ALL — it does not refresh the banner, re-add a missing card or "repair" an edited
 * value. Seeding is a first-run step, and after that the content belongs to whoever edits it in the
 * admin panel. Re-running `npm run seed` on a live database must never undo an administrator's work.
 *
 * Runs in one transaction so a half-seeded page can never be committed.
 */
export async function seedContactPage(ds: DataSource): Promise<ContactSeedSummary> {
  return ds.transaction(async (m: EntityManager) => {
    const settingsRepo = m.getRepository(ContactPageSettings);

    const existing = await settingsRepo.findOne({ where: { isDelete: false } });
    if (existing) return { created: false, organizationsCreated: 0 };

    const settings = await settingsRepo.save(settingsRepo.create({ ...PAGE, isPublished: true }));
    await m.getRepository(ContactOrganization).insert(ORGANIZATIONS.map((o) => ({ ...o, settingsId: settings.id })));

    return { created: true, organizationsCreated: ORGANIZATIONS.length };
  });
}
