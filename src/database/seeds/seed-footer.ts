import type { DataSource, EntityManager } from 'typeorm';
import { FooterLink, FooterSection, FooterSettings } from '../../cms/footer/footer.model';

export interface FooterSeedSummary {
  created: boolean;
  columnsCreated: number;
  linksCreated: number;
}

/*
 * Initial footer content.
 *
 * The values below are exactly what the public site displayed before the footer became CMS-managed
 * (public-site/content/org.ts and content/strings.ts, collected as BUNDLED_FOOTER in
 * public-site/data/footer.ts), so seeding changes nothing a visitor sees — it only moves the source
 * of truth into the database.
 *
 * Marathi first, as on the AMRUT portal.
 */
const SETTINGS = {
  aboutHeadingMr: 'अमृत - महाराष्ट्र संशोधन, उन्नती व प्रशिक्षण प्रबोधिनी',
  aboutHeadingEn: 'AMRUT - Academy of Maharashtra Research, Upliftment and Training',
  aboutBodyMr:
    'राज्यातील खुल्या प्रवर्गातील आर्थिकदृष्ट्या दुर्बल घटकातील विद्यार्थी, युवक-युवती व इतर उमेदवारांचा विकास घडविण्यासाठी महाराष्ट्र शासनाने "अमृत" - महाराष्ट्र संशोधन, उन्नती व प्रशिक्षण प्रबोधिनी या स्वायत्त संस्थेची स्थापना केली आहे. अमृतच्या नियामक मंडळाचे अध्यक्ष मा. प्रधान सचिव, इतर मागास बहुजन कल्याण विभाग हे असून, मंडळाच्या मान्यतेने विविध योजना कार्यान्वित केल्या जातात.',
  aboutBodyEn:
    "AMRUT - the Academy of Maharashtra Research, Upliftment and Training - is an autonomous body established by the Government of Maharashtra to develop students, youth and other candidates from economically weaker sections of the open category. Its Governing Board is chaired by the Hon. Principal Secretary, Other Backward Bahujan Welfare Department, and schemes are implemented with the Board's approval.",
  partnerLabelMr: 'अंमलबजावणी भागीदार',
  partnerLabelEn: 'Implementation Partner',
  partnerName: 'SUMAGO INFOTECH PVT LTD',
  contactHeadingMr: 'संपर्क माहिती',
  contactHeadingEn: 'Contact Information',
  contactAddressMr: '५ वा मजला, अमृत इमारत, भीमसेन जोशी सभागृहाजवळ, प्रभाग क्र. ८, पीएमआरडीए, औंध, पुणे, महाराष्ट्र ४११०६७.',
  contactAddressEn: '5th Floor, AMRUT Building, near Bhimsen Joshi Sabhagruh, Ward No. 8, PMRDA, Aundh, Pune, Maharashtra 411067.',
  contactEmail: 'info@mahaamrut.org.in',
  contactPhone: '+91 97301 51450',
  /* `{year}` is substituted by the website, so the copyright cannot go stale. */
  copyrightMr: '© {year} AMRUT × SUMAGO INFOTECH PVT LTD.',
  copyrightEn: '© {year} AMRUT × SUMAGO INFOTECH PVT LTD.',
  disclaimerMr: 'सर्व हक्क राखीव.',
  disclaimerEn: 'All rights reserved.',
};

/*
 * The two middle columns. The second holds the links that exist in the design but have no
 * destination in this build — the original marked them `data-act="notAvailable"`, and the site
 * answers them with a notice rather than a dead link, which is what UNAVAILABLE means here.
 */
const COLUMNS = [
  {
    headingMr: 'अमृत कलश',
    headingEn: 'AMRUT Kalash',
    links: [
      { kind: 'INTERNAL' as const, labelMr: 'अमृत कलश', labelEn: 'AMRUT Kalash', href: '/programme' },
      { kind: 'INTERNAL' as const, labelMr: 'मॉड्यूल्स', labelEn: 'Modules', href: '/modules' },
      { kind: 'INTERNAL' as const, labelMr: 'पात्रता', labelEn: 'Eligibility', href: '/eligibility' },
      { kind: 'INTERNAL' as const, labelMr: 'अर्ज कसा करावा', labelEn: 'How to Apply', href: '/apply' },
    ],
  },
  {
    headingMr: 'महत्वपूर्ण दुवे',
    headingEn: 'Important Links',
    links: [
      { kind: 'UNAVAILABLE' as const, labelMr: 'ई-बुक', labelEn: 'e-Book', href: null },
      { kind: 'UNAVAILABLE' as const, labelMr: 'परिपत्रक', labelEn: 'Circulars', href: null },
      { kind: 'UNAVAILABLE' as const, labelMr: 'अभिप्राय', labelEn: 'Feedback', href: null },
      { kind: 'UNAVAILABLE' as const, labelMr: 'माहितीचा अधिकार', labelEn: 'RTI', href: null },
      { kind: 'UNAVAILABLE' as const, labelMr: 'शासन निर्णय', labelEn: 'Government Resolutions', href: null },
      { kind: 'INTERNAL' as const, labelMr: 'प्रश्नोत्तरे', labelEn: 'FAQs', href: '/faq' },
    ],
  },
];

/*
 * Idempotent, and deliberately all-or-nothing about it: if a configuration row already exists this
 * does NOTHING AT ALL — it does not refresh the text, re-add a missing column or "repair" an edited
 * value. Seeding is a first-run step, and after that the content belongs to whoever edits it in the
 * admin panel. Re-running `npm run seed` on a live database must never undo an administrator's work.
 *
 * Runs in one transaction so a half-seeded footer can never be committed.
 */
export async function seedFooter(ds: DataSource): Promise<FooterSeedSummary> {
  return ds.transaction(async (m: EntityManager) => {
    const settingsRepo = m.getRepository(FooterSettings);

    const existing = await settingsRepo.findOne({ where: { isDelete: false } });
    if (existing) return { created: false, columnsCreated: 0, linksCreated: 0 };

    const settings = await settingsRepo.save(settingsRepo.create({ ...SETTINGS, isPublished: true }));

    const sectionRepo = m.getRepository(FooterSection);
    const linkRepo = m.getRepository(FooterLink);
    let linksCreated = 0;

    for (const [index, column] of COLUMNS.entries()) {
      const section = await sectionRepo.save(
        sectionRepo.create({
          settingsId: settings.id,
          kind: 'LINK_COLUMN',
          headingMr: column.headingMr,
          headingEn: column.headingEn,
          displayOrder: index,
        }),
      );
      await linkRepo.insert(column.links.map((l, order) => ({ ...l, sectionId: section.id, displayOrder: order })));
      linksCreated += column.links.length;
    }

    /*
     * The CONTACT row owns the extra lines an administrator adds beneath the phone number. It is
     * created empty so the admin screen has somewhere to add them without a schema change.
     */
    await sectionRepo.save(
      sectionRepo.create({
        settingsId: settings.id,
        kind: 'CONTACT',
        headingMr: null,
        headingEn: null,
        displayOrder: COLUMNS.length,
      }),
    );

    return { created: true, columnsCreated: COLUMNS.length, linksCreated };
  });
}
