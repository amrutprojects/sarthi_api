import type { Request } from 'express';
import { AppDataSource } from '../../config/database.config';
import { auditService } from '../../modules/audit/audit.service';
import { AUDIT_ACTIONS } from '../../shared/constants/app.constants';
import type { NavMenuItem } from './navmenu.model';
import { navMenuItemRepository } from './navmenu.repository';
import { NAV_MENU_KEYS, type AdminNavMenuItem, type NavMenuKey, type NavMenuLabel, type PublicNavMenu } from './navmenu.types';

/* A change to one item: the flag, the custom name (null: back to the default name), or both. */
export interface NavMenuChange {
  show?: boolean;
  label?: NavMenuLabel | null;
}

/* A custom name counts only when filled in both languages; anything else reads as the default name. */
const toLabel = (row: NavMenuItem | null | undefined): NavMenuLabel | null =>
  row && row.labelMr.trim() && row.labelEn.trim() ? { mr: row.labelMr, en: row.labelEn } : null;

/* Nothing hides or renames an item that has no row, so it reads as shown, with its default name and no version. */
const toItem = (key: NavMenuKey, row: NavMenuItem | null | undefined): AdminNavMenuItem => ({
  key,
  show: row?.showOnWebsite ?? true,
  label: toLabel(row),
  updatedAt: row?.updatedAt ?? null,
});

/*
 * Navigation Menu (CMS → Home Page Management): a show/hide switch for each item of the website's menu
 * bar and its Login / Register button. A hidden item leaves the bar and the mobile menu only; its page
 * stays reachable by its address and from other links.
 *
 * The list is always every key, in menu order, whatever rows exist, so a row deleted by hand can never
 * drop an item from the admin screen or the website.
 */
export class NavMenuService {
  async list(): Promise<AdminNavMenuItem[]> {
    const rows = new Map((await navMenuItemRepository.list()).map((r) => [r.key, r]));
    return NAV_MENU_KEYS.map((key) => toItem(key, rows.get(key)));
  }

  /*
   * Sets one item's flag, name or both, in one transaction with its audit entry; what the change leaves
   * out stays as it is. A missing row is created, so the switch works even after a row was deleted. A
   * name blank in both languages (or null) is stored blank: the website's default name. Setting the
   * current values leaves the row alone but is still audited, as the administrator's action it was.
   */
  async set(key: NavMenuKey, change: NavMenuChange, req?: Request): Promise<AdminNavMenuItem> {
    const label = change.label === undefined ? undefined : change.label?.mr && change.label.en ? change.label : null;
    const name = label === undefined ? {} : { labelMr: label?.mr ?? '', labelEn: label?.en ?? '' };
    await AppDataSource.transaction(async (m) => {
      await navMenuItemRepository.upsert(key, { showOnWebsite: change.show, ...name }, m);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.NAV_MENU_UPDATE,
        resource: 'nav-menu',
        resourceId: key,
        details: { key, ...(change.show !== undefined && { show: change.show }), ...(label !== undefined && { label }) },
      });
    });
    return toItem(key, await navMenuItemRepository.findByKey(key));
  }

  /* What the website reads: every item in menu order, a missing row reading as shown with its default name. */
  async getPublic(): Promise<PublicNavMenu> {
    return { items: (await this.list()).map(({ key, show, label }) => ({ key, show, label })) };
  }
}

export const navMenuService = new NavMenuService();
