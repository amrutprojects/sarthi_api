import type { DataSource, EntityManager } from 'typeorm';
import { HomeHero, HomeHeroSlide } from '../../cms/hero/hero.model';

export interface HeroSeedSummary {
  created: boolean;
  slidesCreated: number;
}

/*
 * The home page's hero banner, as the site already displayed it.
 *
 * The slides are taken VERBATIM from public-site/content/announcements.ts and the two button labels
 * from the site's global strings (readMore, checkStatus), so seeding changes nothing a visitor sees —
 * it only moves the source of truth into the database. The one deliberate difference is the links:
 * the site's bundled copy writes them as hash routes ('#/apply'), and the database stores the page
 * itself ('/apply'), which is what the website now links to.
 */
const SECTION = {
  readMoreLabelMr: 'अधिक जाणून घ्या',
  readMoreLabelEn: 'Learn more',
  checkStatusLabelMr: 'अर्जाची स्थिती पहा',
  checkStatusLabelEn: 'Check Application Status',
};

const SLIDES = [
  {
    tagMr: 'प्रवेश सुरू',
    tagEn: 'Admissions open',
    titleMr: 'अमृत कलश - कौशल्य प्रशिक्षणासाठी ऑनलाइन अर्ज करा',
    titleEn: 'AMRUT Kalash - apply online for skill training',
    descriptionMr: 'खुल्या प्रवर्गातील आर्थिकदृष्ट्या दुर्बल घटकातील युवकांसाठी ४८० तासांचा डिप्लोमा कार्यक्रम.',
    descriptionEn: 'A 480-hour diploma programme for economically weaker youth from the open category.',
    ctaLabelMr: 'आता अर्ज करा',
    ctaLabelEn: 'Apply now',
    ctaLink: '/apply',
    displayOrder: 0,
  },
  {
    tagMr: 'दोन प्रशिक्षण पद्धती',
    tagEn: 'Two training modes',
    titleMr: 'ऑफलाइन केंद्र किंवा ऑनलाइन - तुमच्या सोयीनुसार निवडा',
    titleEn: 'Offline centre or online - choose what suits you',
    descriptionMr: 'मान्यताप्राप्त प्रशिक्षण केंद्रावर किंवा सुमागो LMS द्वारे केंद्रीय ऑनलाइन पद्धतीने प्रशिक्षण.',
    descriptionEn: 'Train at an approved centre, or centrally online through the SUMAGO LMS.',
    ctaLabelMr: 'अधिक जाणून घ्या',
    ctaLabelEn: 'Learn more',
    ctaLink: '/programme',
    displayOrder: 1,
  },
  {
    tagMr: 'प्रमाणपत्र पडताळणी',
    tagEn: 'Certificate verification',
    titleMr: 'QR कोडद्वारे प्रमाणपत्राची त्वरित पडताळणी',
    titleEn: 'Verify any certificate instantly by QR code',
    descriptionMr: 'नियोक्ते व संस्था प्रमाणपत्र क्रमांक टाकून सत्यता तपासू शकतात.',
    descriptionEn: 'Employers and institutions can confirm authenticity using the certificate number.',
    ctaLabelMr: 'पडताळणी करा',
    ctaLabelEn: 'Verify now',
    ctaLink: '/verify',
    displayOrder: 2,
  },
];

/*
 * Idempotent, and deliberately all-or-nothing about it: if a configuration row already exists this
 * does NOTHING AT ALL. Seeding is a first-run step, and after that the content belongs to whoever
 * edits it in the admin panel. Re-running the seed on a live database must never undo that work.
 *
 * Runs in one transaction so a half-seeded section can never be committed.
 */
export async function seedHomeHero(ds: DataSource): Promise<HeroSeedSummary> {
  return ds.transaction(async (m: EntityManager) => {
    const repo = m.getRepository(HomeHero);

    const existing = await repo.findOne({ where: { isDelete: false } });
    if (existing) return { created: false, slidesCreated: 0 };

    const section = await repo.save(repo.create({ ...SECTION, isPublished: true }));
    await m.getRepository(HomeHeroSlide).insert(SLIDES.map((s) => ({ ...s, heroId: section.id })));

    return { created: true, slidesCreated: SLIDES.length };
  });
}
