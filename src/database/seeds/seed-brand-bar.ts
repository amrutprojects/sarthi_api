import type { DataSource } from 'typeorm';
import { BrandBarSettings } from '../../cms/brandbar/brandbar.model';

export interface BrandBarSeedSummary {
  created: boolean;
}

/*
 * The Brand Bar, exactly as the website showed it: the wordmark text and the partner name were
 * hard-coded in the website's PublicLayout, and the partner label is the website's STR.partner, so
 * seeding changes nothing a visitor sees; it only moves the source of truth into the database.
 */
const SETTINGS = {
  title: 'AMRUT KALASH',
  fullNameMr: 'अमृत - महाराष्ट्र संशोधन, उन्नती व प्रशिक्षण प्रबोधिनी',
  fullNameEn: 'Academy of Maharashtra Research, Upliftment and Training',
  partnerLabelMr: 'अंमलबजावणी भागीदार',
  partnerLabelEn: 'Implementation Partner',
  partnerName: 'SUMAGO INFOTECH PVT LTD',
};

/*
 * Idempotent: if the Brand Bar's row already exists this does nothing. Seeding is a first-run step;
 * after that the content belongs to whoever edits it in the admin panel, and re-running the seed must
 * never undo that work.
 */
export async function seedBrandBar(ds: DataSource): Promise<BrandBarSeedSummary> {
  const repo = ds.getRepository(BrandBarSettings);
  if (await repo.findOne({ where: { isDelete: false } })) return { created: false };
  await repo.save(repo.create(SETTINGS));
  return { created: true };
}
