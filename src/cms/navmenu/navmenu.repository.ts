import type { EntityManager } from 'typeorm';
import { BaseRepository } from '../../database/base.repository';
import { NavMenuItem } from './navmenu.model';
import type { NavMenuKey } from './navmenu.types';

/* The menu bar's items: at most one live row per key (partial unique index), and a key may have none. */
export class NavMenuItemRepository extends BaseRepository<NavMenuItem> {
  constructor() {
    super(NavMenuItem);
  }

  list(manager?: EntityManager): Promise<NavMenuItem[]> {
    return this.findMany({}, { manager });
  }

  findByKey(key: NavMenuKey, manager?: EntityManager): Promise<NavMenuItem | null> {
    return this.findOne({ key }, manager);
  }

  /*
   * Creates the key's row or sets its flag in one statement, so two saves of a missing key cannot both
   * insert. Setting the current value writes nothing, so the row's version stays as it is.
   */
  async setShow(key: NavMenuKey, show: boolean, manager: EntityManager): Promise<void> {
    await this.repo(manager).query(
      `INSERT INTO "nav_menu_items" ("key", "showOnWebsite") VALUES ($1, $2)
       ON CONFLICT ("key") WHERE "isDelete" = false
       DO UPDATE SET "showOnWebsite" = EXCLUDED."showOnWebsite"
       WHERE "nav_menu_items"."showOnWebsite" IS DISTINCT FROM EXCLUDED."showOnWebsite"`,
      [key, show],
    );
  }
}

export const navMenuItemRepository = new NavMenuItemRepository();
