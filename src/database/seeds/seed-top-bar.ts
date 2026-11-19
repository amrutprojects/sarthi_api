import type { DataSource, EntityManager } from 'typeorm';
import { TopBarLink, TopBarSettings } from '../../cms/topbar/topbar.model';

export interface TopBarSeedSummary {
  created: boolean;
  linksCreated: number;
}

/*
 * The Top Bar, exactly as the website showed the strip.
 *
 * The government name and the two links are taken VERBATIM from the website's global strings (STR.govt,
 * STR.verifyCert -> /verify, STR.checkStatus -> /track), in the order the strip printed them, and the
 * language switch is on, so seeding changes nothing a visitor sees; it only moves the source of truth
 * into the database. Marathi numerals are on too: the website prints Devanagari digits in Marathi by default.
 */
const SETTINGS = {
  governmentNameMr: 'महाराष्ट्र शासन',
  governmentNameEn: 'Government of Maharashtra',
  showLanguageToggle: true,
  marathiNumerals: true,
};

const LINKS = [
  { labelMr: 'प्रमाणपत्र पडताळणी', labelEn: 'Verify Certificate', link: '/verify' },
  { labelMr: 'अर्जाची स्थिती पहा', labelEn: 'Check Application Status', link: '/track' },
];

/*
 * Idempotent, and deliberately all-or-nothing about it: if the Top Bar's settings row already exists
 * this does NOTHING AT ALL. Seeding is a first-run step; after that the content belongs to whoever
 * edits it in the admin panel, and re-running the seed must never undo that work or bring back a
 * link someone deleted.
 *
 * Runs in one transaction so a half-seeded Top Bar can never be committed.
 */
export async function seedTopBar(ds: DataSource): Promise<TopBarSeedSummary> {
  return ds.transaction(async (m: EntityManager) => {
    const settings = m.getRepository(TopBarSettings);
    if (await settings.findOne({ where: { isDelete: false } })) return { created: false, linksCreated: 0 };

    await settings.save(settings.create(SETTINGS));
    await m.getRepository(TopBarLink).insert(LINKS.map((l, i) => ({ ...l, displayOrder: i + 1 })));
    return { created: true, linksCreated: LINKS.length };
  });
}
