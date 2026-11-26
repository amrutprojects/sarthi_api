import type { DataSource, EntityManager } from 'typeorm';
import {
  ProgrammeHighlight,
  ProgrammeHighlightObjective,
} from '../../cms/highlight/highlight.model';

export interface HighlightSeedSummary {
  created: boolean;
  objectivesCreated: number;
}

/*
 * The home page's programme section, as the site already displayed it.
 *
 * Taken from public-site/content/kalash.ts, so seeding changes nothing a visitor sees — it only
 * moves the source of truth into the database.
 *
 * The heading joins the programme title and what the band calls it, because that is how the page
 * prints it: the title, an em dash, then "Skill Development Diploma".
 *
 * NOT seeded here: the fact sheet beside it. Its totals are summed from the modules and its entered
 * figures live with the Programme page content, rather than being stored twice.
 */
const SECTION = {
  headingMr: 'सारथी — कौशल्य विकास डिप्लोमा',
  headingEn: 'SARTHI — Skill Development Diploma',
  subheadingMr: 'अमृत - कौशल्य सुसंवादाद्वारे ज्ञानवृद्धी व शिकण्याची क्षमता',
  subheadingEn: 'AMRUT - Knowledge Advancement and Learning Abilities through Skill Harmonization',
  taglineMr: 'कौशल्यातील तफावत भरून काढून युवकांची रोजगारक्षमता व स्वयंरोजगारक्षमता वाढविणे.',
  taglineEn: 'Bridging the skill deficit to enhance employability and self-employability of youth.',
  certificationMr: 'अमृत व सुमागो इन्फोटेक यांचे संयुक्त',
  certificationEn: 'Jointly by AMRUT & SUMAGO Infotech',
};

const OBJECTIVES = [
  {
    textMr: 'आर्थिकदृष्ट्या दुर्बल युवकांमधील कौशल्यातील तफावत भरून काढणे',
    textEn: 'Bridge skill deficiencies among economically weaker youth',
    displayOrder: 0,
  },
  {
    textMr: 'रोजगार व स्वयंरोजगाराच्या संधी वाढविणे',
    textEn: 'Enhance employability and self-employment prospects',
    displayOrder: 1,
  },
  {
    textMr: '२१ व्या शतकातील रोजगारक्षमतेची कौशल्ये विकसित करणे',
    textEn: 'Develop 21st-century job-readiness competencies',
    displayOrder: 2,
  },
  {
    textMr: 'उत्पादकता, सर्जनशीलता व उद्योजकीय दृष्टिकोन रुजविणे',
    textEn: 'Foster productivity, creativity and an entrepreneurial mindset',
    displayOrder: 3,
  },
  {
    textMr: 'डिजिटल व गिग इकॉनॉमीतील संधींसाठी सज्ज करणे',
    textEn: 'Prepare candidates for digital and gig-economy opportunities',
    displayOrder: 4,
  },
];

/*
 * Idempotent, and deliberately all-or-nothing about it: if a configuration row already exists this
 * does NOTHING AT ALL. Seeding is a first-run step, and after that the content belongs to whoever
 * edits it in the admin panel. Re-running the seed on a live database must never undo that work.
 *
 * Runs in one transaction so a half-seeded section can never be committed.
 */
export async function seedProgrammeHighlight(ds: DataSource): Promise<HighlightSeedSummary> {
  return ds.transaction(async (m: EntityManager) => {
    const repo = m.getRepository(ProgrammeHighlight);

    const existing = await repo.findOne({ where: { isDelete: false } });
    if (existing) return { created: false, objectivesCreated: 0 };

    const section = await repo.save(repo.create({ ...SECTION, isPublished: true }));
    await m
      .getRepository(ProgrammeHighlightObjective)
      .insert(OBJECTIVES.map((o) => ({ ...o, highlightId: section.id })));

    return { created: true, objectivesCreated: OBJECTIVES.length };
  });
}
