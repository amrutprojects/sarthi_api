import type { DataSource, EntityManager } from 'typeorm';
import { AmrutScheme, AmrutSchemesSection } from '../../cms/schemes/schemes.model';

export interface AmrutSchemesSeedSummary {
  created: boolean;
  schemesCreated: number;
}

/*
 * The अमृत योजना विभाग section, exactly as the website showed it.
 *
 * Taken VERBATIM from the website's former bundled copy — public-site/content/schemes.ts for the
 * cards, and the global strings (schemes, schemesSub, readMore) for the heading, subtitle and button
 * label — so seeding changes nothing a visitor sees; it only moves the source of truth into the
 * database. Every title, description and last date is unchanged, in the same order.
 *
 * Two representational changes: the link was written as a hash route ('#/programme') and is stored
 * as the page itself ('/programme'), which is what the website already resolved it to; and the
 * "हा कार्यक्रम" / "This programme" tag, which the site printed on any `featured` card, is now that
 * card's own badge text. Only AMRUT Kalash had a destination, a badge and the highlighted style; the
 * others keep none.
 */
const SECTION = {
  headingMr: 'अमृत योजना विभाग',
  headingEn: 'AMRUT Schemes',
  subtitleMr: 'अमृत संस्थेद्वारे राबवल्या जाणाऱ्या विविध प्रशिक्षण व विकास योजना.',
  subtitleEn: 'Training and development schemes implemented by AMRUT.',
  buttonLabelMr: 'अधिक जाणून घ्या',
  buttonLabelEn: 'Learn more',
  showSection: true,
};

const SCHEMES = [
  {
    titleMr: 'अमृत कलश - कौशल्य प्रशिक्षण',
    titleEn: 'AMRUT Kalash - Skill Training',
    descriptionMr:
      'महाराष्ट्रातील खुल्या प्रवर्गातील आर्थिकदृष्ट्या दुर्बल घटकातील युवकांना २१ व्या शतकातील रोजगारक्षम कौशल्ये, संगणक कौशल्ये व इंग्रजी संभाषण कौशल्ये यांचे प्रशिक्षण देऊन रोजगार व स्वयंरोजगारक्षम बनविणे.',
    descriptionEn:
      'Equipping economically weaker youth from the open category with 21st-century job-readiness skills, digital skills and English communication skills for employment and self-employment.',
    badgeMr: 'हा कार्यक्रम',
    badgeEn: 'This programme',
    deadline: '2027-03-31',
    link: '/programme',
    featured: true,
  },
  {
    titleMr: 'मानसमित्र समुपदेशक प्रशिक्षण कार्यक्रम',
    titleEn: 'Manasmitra Counsellor Training Programme',
    descriptionMr: 'समाजातील व्यक्तींना मूलभूत समुपदेशन कौशल्यांचे प्रशिक्षण देऊन मानसिक आरोग्याबाबत जागरूकता निर्माण करणे.',
    descriptionEn: 'Building mental-health awareness by training individuals in basic counselling skills.',
    deadline: '2026-06-29',
  },
  {
    titleMr: 'लघुलेखन प्रशिक्षण योजना',
    titleEn: 'Shorthand Training Scheme',
    descriptionMr: 'शासकीय ऑनलाईन लघुलेखन परीक्षेच्या माध्यमातून उमेदवारांना उद्योगाभिमुख स्वयंरोजगार व रोजगारक्षम बनविणे.',
    descriptionEn: 'Making candidates employable through the government online shorthand examination.',
    deadline: '2026-06-09',
  },
  {
    titleMr: 'ड्रोन पायलट प्रशिक्षण योजना',
    titleEn: 'Drone Pilot Training Scheme',
    descriptionMr: 'विशेषत: ग्रामीण क्षेत्रात स्वयंरोजगार व रोजगार निर्मिती करणारे प्रशिक्षण देणे.',
    descriptionEn: 'Training that creates self-employment and jobs, especially in rural areas.',
    deadline: '2026-06-30',
  },
  {
    titleMr: 'AIIMS, IIT, IIM, IIIT विद्यार्थ्यांना अर्थसहाय्य योजना',
    titleEn: 'Financial Assistance for AIIMS / IIT / IIM / IIIT Students',
    descriptionMr: 'अमृतच्या लक्षित गटातील विद्यार्थ्यांना दर्जेदार शिक्षण घेणे सोयीस्कर होण्यासाठी अर्थसहाय्य देणे.',
    descriptionEn: "Financial assistance so students from AMRUT's target group can access quality education.",
    deadline: '2026-03-11',
  },
  {
    titleMr: 'वैयक्तिक कर्ज व्याज परतावा योजना',
    titleEn: 'Personal Loan Interest Subvention Scheme',
    descriptionMr: 'स्वत:चा उद्योग / व्यवसाय सुरु करू इच्छिणाऱ्या अमृतच्या लक्षित गटातील उमेदवारांसाठी.',
    descriptionEn: "For candidates from AMRUT's target group wishing to start their own business.",
    deadline: '2030-12-31',
  },
];

/*
 * Idempotent, and deliberately all-or-nothing about it: if the section's settings row already exists
 * this does NOTHING AT ALL. Seeding is a first-run step; after that the content belongs to whoever
 * edits it in the admin panel, and re-running the seed must never undo that work or bring back a
 * scheme someone deleted.
 *
 * Runs in one transaction so a half-seeded section can never be committed.
 */
export async function seedAmrutSchemes(ds: DataSource): Promise<AmrutSchemesSeedSummary> {
  return ds.transaction(async (m: EntityManager) => {
    const sections = m.getRepository(AmrutSchemesSection);
    if (await sections.findOne({ where: { isDelete: false } })) return { created: false, schemesCreated: 0 };

    await sections.save(sections.create(SECTION));
    await m.getRepository(AmrutScheme).insert(
      SCHEMES.map((s, i) => ({
        badgeMr: '',
        badgeEn: '',
        link: null,
        featured: false,
        ...s,
        displayOrder: i + 1,
      })),
    );
    return { created: true, schemesCreated: SCHEMES.length };
  });
}
