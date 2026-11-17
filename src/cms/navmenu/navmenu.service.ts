import type { Request } from 'express';
import { AppDataSource } from '../../config/database.config';
import { auditService } from '../../modules/audit/audit.service';
import { AUDIT_ACTIONS } from '../../shared/constants/app.constants';
import type { NavMenuItem } from './navmenu.model';
import { navMenuItemRepository } from './navmenu.repository';
import { NAV_MENU_KEYS, type AdminNavMenuItem, type NavMenuKey, type PublicNavMenu } from './navmenu.types';

/* Nothing hides an item that has no row, so it reads as shown, with no version. */
const toItem = (key: NavMenuKey, row: NavMenuItem | null | undefined): AdminNavMenuItem => ({
  key,
  show: row?.showOnWebsite ?? true,
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
   * Sets one item, in one transaction with its audit entry. A missing row is created, so the switch works
   * even after a row was deleted. Setting the current value leaves the row alone but is still audited,
   * as the administrator's action it was.
   */
  async set(key: NavMenuKey, show: boolean, req?: Request): Promise<AdminNavMenuItem> {
    await AppDataSource.transaction(async (m) => {
      await navMenuItemRepository.setShow(key, show, m);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.NAV_MENU_UPDATE,
        resource: 'nav-menu',
        resourceId: key,
        details: { key, show },
      });
    });
    return toItem(key, await navMenuItemRepository.findByKey(key));
  }

  /* What the website reads: every item in menu order, a missing row reading as shown. */
  async getPublic(): Promise<PublicNavMenu> {
    return { items: (await this.list()).map(({ key, show }) => ({ key, show })) };
  }
}

export const navMenuService = new NavMenuService();
