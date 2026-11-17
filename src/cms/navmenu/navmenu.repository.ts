import type { EntityManager } from 'typeorm';
import { BaseRepository } from '../../database/base.repository';
import { NavMenuItem } from './navmenu.model';
import type { NavMenuKey } from './navmenu.types';

/* The columns a change may set; the only names ever written into the upsert statement. */
const NAV_MENU_COLUMNS = ['showOnWebsite', 'labelMr', 'labelEn'] as const;

export type NavMenuChanges = Partial<Pick<NavMenuItem, (typeof NAV_MENU_COLUMNS)[number]>>;

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
   * Creates the key's row or sets the given columns in one statement, so two saves of a missing key
   * cannot both insert. A column left undefined is left as it is (or takes its default on a new row).
   * Setting the current values writes nothing, so the row's version stays as it is.
   */
  async upsert(key: NavMenuKey, changes: NavMenuChanges, manager: EntityManager): Promise<void> {
    const cols = NAV_MENU_COLUMNS.filter((c) => changes[c] !== undefined);
    if (!cols.length) return;
    await this.repo(manager).query(
      `INSERT INTO "nav_menu_items" ("key", ${cols.map((c) => `"${c}"`).join(', ')})
       VALUES ($1, ${cols.map((_, i) => `$${i + 2}`).join(', ')})
       ON CONFLICT ("key") WHERE "isDelete" = false
       DO UPDATE SET ${cols.map((c) => `"${c}" = EXCLUDED."${c}"`).join(', ')}
       WHERE ${cols.map((c) => `"nav_menu_items"."${c}" IS DISTINCT FROM EXCLUDED."${c}"`).join(' OR ')}`,
      [key, ...cols.map((c) => changes[c])],
    );
  }
}

export const navMenuItemRepository = new NavMenuItemRepository();
