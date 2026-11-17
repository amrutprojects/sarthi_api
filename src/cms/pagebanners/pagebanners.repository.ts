import type { EntityManager } from 'typeorm';
import { BaseRepository } from '../../database/base.repository';
import { PageBanner } from './pagebanners.model';
import type { PageBannerKey } from './pagebanners.types';

/* The columns a change may set; the only names ever written into the upsert statement. */
const PAGE_BANNER_COLUMNS = ['titleMr', 'titleEn', 'subtitleMr', 'subtitleEn'] as const;

export type PageBannerChanges = Partial<Pick<PageBanner, (typeof PAGE_BANNER_COLUMNS)[number]>>;

/* The page banners: at most one live row per key (partial unique index), and a key may have none. */
export class PageBannerRepository extends BaseRepository<PageBanner> {
  constructor() {
    super(PageBanner);
  }

  list(manager?: EntityManager): Promise<PageBanner[]> {
    return this.findMany({}, { manager });
  }

  findByKey(key: PageBannerKey, manager?: EntityManager): Promise<PageBanner | null> {
    return this.findOne({ key }, manager);
  }

  /*
   * Creates the key's row or sets the given columns in one statement, so two saves of a missing key
   * cannot both insert. A column left undefined is left as it is (or takes its default on a new row).
   * Setting the current values writes nothing, so the row's version stays as it is.
   */
  async upsert(key: PageBannerKey, changes: PageBannerChanges, manager: EntityManager): Promise<void> {
    const cols = PAGE_BANNER_COLUMNS.filter((c) => changes[c] !== undefined);
    if (!cols.length) return;
    await this.repo(manager).query(
      `INSERT INTO "page_banners" ("key", ${cols.map((c) => `"${c}"`).join(', ')})
       VALUES ($1, ${cols.map((_, i) => `$${i + 2}`).join(', ')})
       ON CONFLICT ("key") WHERE "isDelete" = false
       DO UPDATE SET ${cols.map((c) => `"${c}" = EXCLUDED."${c}"`).join(', ')}
       WHERE ${cols.map((c) => `"page_banners"."${c}" IS DISTINCT FROM EXCLUDED."${c}"`).join(' OR ')}`,
      [key, ...cols.map((c) => changes[c])],
    );
  }
}

export const pageBannerRepository = new PageBannerRepository();
