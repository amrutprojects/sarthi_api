import type { DataSource, EntityManager } from 'typeorm';
import { AboutCard, AboutFact, AboutSection } from '../../cms/about/about.model';

export interface AboutSeedSummary {
  created: boolean;
  factsCreated: number;
  cardsCreated: number;
}

/*
 * The About AMRUT section, exactly as the website showed it.
 *
 * Taken VERBATIM from the website's former bundled copy — public-site/content/org.ts for the
 * description, the information rows (the About page's Implementation partner row included) and the
 * mission / vision / values texts; the global string
 * aboutTitle for the heading; the labels the home section printed for the rows and the cards — so
 * seeding changes nothing a visitor sees; it only moves the source of truth into the database.
 * (The registration text contains a zero-width joiner, "अ‍ॅक्ट", kept as in the source.)
 *
 * The three cards are marked required: they can be edited and reordered, never deleted or hidden.
 */
const SECTION = {
  headingMr: 'अमृत विषयी माहिती',
  headingEn: 'About AMRUT',
  subtitleMr: '',
  subtitleEn: '',
  descriptionMr:
    'राज्यातील खुल्या प्रवर्गातील आर्थिकदृष्ट्या दुर्बल घटकातील विद्यार्थी, युवक-युवती व इतर उमेदवारांचा विकास घडविण्यासाठी महाराष्ट्र शासनाने "अमृत" - महाराष्ट्र संशोधन, उन्नती व प्रशिक्षण प्रबोधिनी या स्वायत्त संस्थेची स्थापना केली आहे. अमृतच्या नियामक मंडळाचे अध्यक्ष मा. प्रधान सचिव, इतर मागास बहुजन कल्याण विभाग हे असून, मंडळाच्या मान्यतेने विविध योजना कार्यान्वित केल्या जातात.',
  descriptionEn:
    "AMRUT - the Academy of Maharashtra Research, Upliftment and Training - is an autonomous body established by the Government of Maharashtra to develop students, youth and other candidates from economically weaker sections of the open category. Its Governing Board is chaired by the Hon. Principal Secretary, Other Backward Bahujan Welfare Department, and schemes are implemented with the Board's approval.",
  showSection: true,
};

const FACTS = [
  {
    labelMr: 'स्थापना',
    labelEn: 'Established',
    valueMr: '२२ ऑगस्ट २०१९ च्या शासन निर्णयाद्वारे',
    valueEn: 'By Government Resolution dated 22 August 2019',
  },
  {
    labelMr: 'नोंदणी',
    labelEn: 'Registration',
    valueMr: 'सोसायटी रजिस्ट्रेशन अ‍ॅक्ट १८६० व सार्वजनिक विश्वस्त व्यवस्था अधिनियम १९५० अंतर्गत नोंदणीकृत',
    valueEn: 'Registered under the Society Registration Act 1860 and the Public Trusts Act 1950',
  },
  { labelMr: 'मुख्यालय', labelEn: 'Headquarters', valueMr: 'मुख्यालय: पुणे', valueEn: 'Headquarters: Pune' },
  /* The row the About page printed from org.partnerName and org.partnerRole (existing databases get it from migration 1794600000000). */
  {
    labelMr: 'अंमलबजावणी भागीदार',
    labelEn: 'Implementation partner',
    valueMr: 'SUMAGO INFOTECH PVT LTD — अंमलबजावणी व तंत्रज्ञान भागीदार',
    valueEn: 'SUMAGO INFOTECH PVT LTD — Implementation & technology partner',
  },
];

const CARDS = [
  {
    headingMr: 'आमचे ध्येय',
    headingEn: 'Our Mission',
    descriptionMr:
      'राज्यातील प्रत्येक नागरिकाला संशोधन, प्रशिक्षण आणि विकासाच्या संधी उपलब्ध करून देणे तसेच युवकांना कौशल्य विकासाद्वारे सक्षम करणे.',
    descriptionEn:
      'To make research, training and development opportunities available to every citizen of the state, and to empower youth through skill development.',
  },
  {
    headingMr: 'आमचा दृष्टिकोन',
    headingEn: 'Our Vision',
    descriptionMr: 'एक विकसित आणि सक्षम महाराष्ट्र घडविणे, जिथे प्रत्येक नागरिक शिक्षण, रोजगार आणि प्रगतीच्या समान संधींनी सुसज्ज असेल.',
    descriptionEn: 'To build a developed and capable Maharashtra where every citizen has equal opportunity in education, employment and progress.',
  },
  {
    headingMr: 'आमची मूल्ये',
    headingEn: 'Our Values',
    descriptionMr: 'पारदर्शकता, उत्तरदायित्व आणि नागरिक-प्रथम दृष्टिकोन.',
    descriptionEn: 'Transparency, accountability and a citizen-first approach.',
  },
];

/*
 * Idempotent, and deliberately all-or-nothing about it: if the section row already exists this does
 * NOTHING AT ALL. Seeding is a first-run step; after that the content belongs to whoever edits it in
 * the admin panel, and re-running the seed must never undo that work or bring back a deleted row.
 *
 * Runs in one transaction so a half-seeded section can never be committed.
 */
export async function seedAboutAmrut(ds: DataSource): Promise<AboutSeedSummary> {
  return ds.transaction(async (m: EntityManager) => {
    const sections = m.getRepository(AboutSection);
    if (await sections.findOne({ where: { isDelete: false } })) return { created: false, factsCreated: 0, cardsCreated: 0 };

    await sections.save(sections.create(SECTION));
    await m.getRepository(AboutFact).insert(FACTS.map((f, i) => ({ ...f, displayOrder: i + 1 })));
    await m.getRepository(AboutCard).insert(CARDS.map((c, i) => ({ ...c, displayOrder: i + 1, isRequired: true })));
    return { created: true, factsCreated: FACTS.length, cardsCreated: CARDS.length };
  });
}
