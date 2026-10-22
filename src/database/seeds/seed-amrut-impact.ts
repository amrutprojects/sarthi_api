import type { DataSource, EntityManager } from 'typeorm';
import { ImpactSection, ImpactStat } from '../../cms/impact/impact.model';

export interface AmrutImpactSeedSummary {
  created: boolean;
  statsCreated: number;
}

/*
 * The अमृतचा प्रभाव section, exactly as the website showed it.
 *
 * The heading is the website's global string (impact), and the labels are taken VERBATIM from
 * home/sections/Impact.tsx, in the same order. The values are the figures it printed: the website
 * computed them (the number of AMRUT Schemes cards, and the demo dataset's enrolment, district and
 * centre counts); from now on they are entered by hand, so "Schemes running" no longer follows the
 * AMRUT Schemes list — an administrator updates it when schemes are added or removed.
 */
const SECTION = {
  headingMr: 'अमृतचा प्रभाव',
  headingEn: "AMRUT's Impact",
  showSection: true,
};

const STATS = [
  { value: '6+', labelMr: 'योजना सुरू', labelEn: 'Schemes running' },
  { value: '1,000+', labelMr: 'लाभार्थी प्रवेशित', labelEn: 'Beneficiaries enrolled' },
  { value: '36', labelMr: 'जिल्ह्यांमध्ये पोहोच', labelEn: 'Districts covered' },
  { value: '10', labelMr: 'मंजूर प्रशिक्षण केंद्रे', labelEn: 'Approved centres' },
];

/*
 * Idempotent, and deliberately all-or-nothing about it: if the section's settings row already exists
 * this does NOTHING AT ALL. Seeding is a first-run step; after that the content belongs to whoever
 * edits it in the admin panel, and re-running the seed must never undo that work or bring back a
 * card someone deleted.
 *
 * Runs in one transaction so a half-seeded section can never be committed.
 */
export async function seedAmrutImpact(ds: DataSource): Promise<AmrutImpactSeedSummary> {
  return ds.transaction(async (m: EntityManager) => {
    const sections = m.getRepository(ImpactSection);
    if (await sections.findOne({ where: { isDelete: false } })) return { created: false, statsCreated: 0 };

    await sections.save(sections.create(SECTION));
    await m.getRepository(ImpactStat).insert(STATS.map((s, i) => ({ ...s, displayOrder: i + 1 })));
    return { created: true, statsCreated: STATS.length };
  });
}
