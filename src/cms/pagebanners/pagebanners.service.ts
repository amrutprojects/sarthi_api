import type { Request } from 'express';
import { AppDataSource } from '../../config/database.config';
import { auditService } from '../../modules/audit/audit.service';
import { AUDIT_ACTIONS } from '../../shared/constants/app.constants';
import type { PageBanner } from './pagebanners.model';
import { pageBannerRepository, type PageBannerChanges } from './pagebanners.repository';
import {
  PAGE_BANNER_KEYS,
  type AdminPageBanner,
  type PageBannerKey,
  type PageBannerText,
  type PublicPageBanners,
} from './pagebanners.types';

/* A change to one page: the title, the subtitle or both (null: back to the website's default). */
export interface PageBannerChange {
  title?: PageBannerText | null;
  subtitle?: PageBannerText | null;
}

/* Custom text counts only when filled in both languages; anything else reads as the default. */
const toText = (mr: string, en: string): PageBannerText | null => (mr.trim() && en.trim() ? { mr, en } : null);

/* A page with no row reads as its defaults, with no version. */
const toItem = (key: PageBannerKey, row: PageBanner | null | undefined): AdminPageBanner => ({
  key,
  title: row ? toText(row.titleMr, row.titleEn) : null,
  subtitle: row ? toText(row.subtitleMr, row.subtitleEn) : null,
  updatedAt: row?.updatedAt ?? null,
});

/* undefined: not sent (left as it is). null or blank in both languages: the default, stored blank. */
const normalise = (t: PageBannerText | null | undefined): PageBannerText | null | undefined =>
  t === undefined ? undefined : t?.mr && t.en ? t : null;

/*
 * Page Banners (CMS): the custom title and subtitle of the banner at the top of five website pages.
 *
 * The list is always every key, in screen order, whatever rows exist, so a row deleted by hand can never
 * drop a page from the admin screen or the website; such a page reads as its defaults.
 */
export class PageBannerService {
  async list(): Promise<AdminPageBanner[]> {
    const rows = new Map((await pageBannerRepository.list()).map((r) => [r.key, r]));
    return PAGE_BANNER_KEYS.map((key) => toItem(key, rows.get(key)));
  }

  /*
   * Sets one page's title, subtitle or both, in one transaction with its audit entry; what the change
   * leaves out stays as it is. A missing row is created. Setting the current values leaves the row alone
   * but is still audited, as the administrator's action it was.
   */
  async set(key: PageBannerKey, change: PageBannerChange, req?: Request): Promise<AdminPageBanner> {
    const title = normalise(change.title);
    const subtitle = normalise(change.subtitle);
    const columns: PageBannerChanges = {
      ...(title !== undefined && { titleMr: title?.mr ?? '', titleEn: title?.en ?? '' }),
      ...(subtitle !== undefined && { subtitleMr: subtitle?.mr ?? '', subtitleEn: subtitle?.en ?? '' }),
    };
    await AppDataSource.transaction(async (m) => {
      await pageBannerRepository.upsert(key, columns, m);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.PAGE_BANNER_UPDATE,
        resource: 'page-banner',
        resourceId: key,
        details: { key, ...(title !== undefined && { title }), ...(subtitle !== undefined && { subtitle }) },
      });
    });
    return toItem(key, await pageBannerRepository.findByKey(key));
  }

  /* What the website reads: every page in order, a missing row or blank text reading as the default (null). */
  async getPublic(): Promise<PublicPageBanners> {
    return { items: (await this.list()).map(({ key, title, subtitle }) => ({ key, title, subtitle })) };
  }
}

export const pageBannerService = new PageBannerService();
