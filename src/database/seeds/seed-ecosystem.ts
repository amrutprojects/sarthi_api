import type { DataSource, EntityManager } from 'typeorm';
import { EcosystemProgramme, EcosystemSection } from '../../cms/ecosystem/ecosystem.model';

export interface EcosystemSeedSummary {
  created: boolean;
  programmesCreated: number;
}

/*
 * The अमृत प्रणाली section, exactly as the website showed it.
 *
 * Taken VERBATIM from the website's former bundled copy — public-site/content/verticals.ts for the
 * cards, and the global strings (verticals, verticalsSub, readMore + " →") for the heading, subtitle
 * and link label — so seeding changes nothing a visitor sees; it only moves the source of truth into
 * the database. The one representational change is the link: the bundled copy wrote it as a hash
 * route ('#/programme'), and the database stores the page itself ('/programme'), which is what the
 * website already resolved it to. Only Sarthi had a destination; the others keep none.
 */
const SECTION = {
  headingMr: 'अमृत प्रणाली',
  headingEn: 'The AMRUT Ecosystem',
  subtitleMr: 'अमृत अंतर्गत विविध विभाग व उपक्रम',
  subtitleEn: 'Departments and initiatives under AMRUT',
  linkLabelMr: 'अधिक जाणून घ्या →',
  linkLabelEn: 'Learn more →',
  showSection: true,
};

const PROGRAMMES = [
  { nameMr: 'अमृत विद्या', nameEn: 'AMRUT Vidya', descriptionMr: 'ज्ञानार्जनाचा परिपूर्ण मंच', descriptionEn: 'A complete platform for learning', icon: 'teacher', link: null },
  { nameMr: 'अमृत पेठ', nameEn: 'AMRUT Peth', descriptionMr: 'दर्जेदार व किफायतशीर उत्पादनांसाठी', descriptionEn: 'Quality and affordable products', icon: 'building', link: null },
  { nameMr: 'अमृत महाराष्ट्र', nameEn: 'AMRUT Maharashtra', descriptionMr: 'राज्य विकास उपक्रम', descriptionEn: 'State development initiative', icon: 'map', link: null },
  { nameMr: 'अमृत मानसमित्र', nameEn: 'AMRUT Manasmitra', descriptionMr: 'मनातल्या प्रत्येक भावनेसाठी', descriptionEn: 'For every emotion within', icon: 'users', link: null },
  { nameMr: 'अमृत पर्यटन', nameEn: 'AMRUT Tourism', descriptionMr: 'पाहा महाराष्ट्र.. अमृतच्या नजरेतून', descriptionEn: 'See Maharashtra through AMRUT', icon: 'globe', link: null },
  { nameMr: 'अमृत वर्ग', nameEn: 'AMRUT Varg', descriptionMr: 'विशेष गट उपक्रम', descriptionEn: 'Special group initiative', icon: 'layers', link: null },
  { nameMr: 'अमृत ड्रोन मिशन', nameEn: 'AMRUT Drone Mission', descriptionMr: 'भारतीय आकाशाला सशक्त करणे', descriptionEn: 'Empowering Indian skies', icon: 'play', link: null },
  { nameMr: 'सारथी', nameEn: 'Sarthi', descriptionMr: 'कौशल्य विकास व रोजगारक्षमता', descriptionEn: 'Skill development & employability', icon: 'award', link: '/programme' },
];

/*
 * Idempotent, and deliberately all-or-nothing about it: if the section's settings row already exists
 * this does NOTHING AT ALL. Seeding is a first-run step; after that the content belongs to whoever
 * edits it in the admin panel, and re-running the seed must never undo that work or bring back a
 * card someone deleted.
 *
 * Runs in one transaction so a half-seeded section can never be committed.
 */
export async function seedEcosystem(ds: DataSource): Promise<EcosystemSeedSummary> {
  return ds.transaction(async (m: EntityManager) => {
    const sections = m.getRepository(EcosystemSection);
    if (await sections.findOne({ where: { isDelete: false } })) return { created: false, programmesCreated: 0 };

    await sections.save(sections.create(SECTION));
    await m.getRepository(EcosystemProgramme).insert(PROGRAMMES.map((p, i) => ({ ...p, displayOrder: i + 1 })));
    return { created: true, programmesCreated: PROGRAMMES.length };
  });
}
