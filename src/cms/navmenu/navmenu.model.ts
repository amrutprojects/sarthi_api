import { Column, Entity } from 'typeorm';
import { AppBaseEntity } from '../../database/base.entity';
import type { NavMenuKey } from './navmenu.types';

/*
 * One item of the website's menu bar and whether it is shown. At most one live row per key; an item
 * with no row is shown, so the bar is complete even before (or without) any row.
 */
@Entity({ name: 'nav_menu_items' })
export class NavMenuItem extends AppBaseEntity {
  @Column({ type: 'varchar', length: 40, name: 'key' })
  key!: NavMenuKey;

  @Column({ type: 'boolean', name: 'showOnWebsite', default: true })
  showOnWebsite!: boolean;
}
