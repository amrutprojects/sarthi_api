import type { DataSource, EntityManager } from 'typeorm';
import { AdvisorySection } from '../../cms/advisory/advisory.model';

export interface AdvisorySeedSummary {
  created: boolean;
}

/*
 * The Sarthi Advisory Committee page (सारथी सल्लागार समिती): its heading and subtitle only.
 *
 * No members are seeded. The trainers and advisors are real people whose names, positions, profiles
 * and photos must come from the programme, not be invented, so the administrator adds them; until
 * then the website shows the heading over an empty list.
 */
const SECTION = {
  headingMr: 'सारथी सल्लागार समिती',
  headingEn: 'Sarthi Advisory Committee',
  subtitleMr: 'कार्यक्रमाला मार्गदर्शन करणारे तज्ज्ञ प्रशिक्षक व सल्लागार.',
  subtitleEn: 'The expert trainers and advisors who guide the Sarthi programme.',
};

/*
 * Idempotent: if the section's settings row already exists this does NOTHING. Seeding is a first-run
 * step; after that the content belongs to whoever edits it in the admin panel, and re-running the
 * seed on a live database must never undo that work.
 */
export async function seedAdvisoryCommittee(ds: DataSource): Promise<AdvisorySeedSummary> {
  return ds.transaction(async (m: EntityManager) => {
    const sections = m.getRepository(AdvisorySection);
    if (await sections.findOne({ where: { isDelete: false } })) return { created: false };

    await sections.save(sections.create(SECTION));
    return { created: true };
  });
}
