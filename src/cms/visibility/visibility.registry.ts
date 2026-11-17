import type { EntityManager, FindOptionsWhere } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import type { AppBaseEntity } from '../../database/base.entity';
import type { MenuKey } from '../../modules/roles-permissions/permission.constants';
import {
  AboutSection,
  AmrutSchemesSection,
  AnnouncementSettings,
  BoardSection,
  BrandBarSettings,
  EcosystemSection,
  HomeHero,
  ImpactSection,
  LiveDashboardSettings,
  ProgrammeHighlight,
  QuickActionSettings,
  TopBarSettings,
} from '../cms.entities';
import { SingletonRepository } from './visibility.repository';
import { SECTION_KEYS, type SectionKey } from './visibility.types';

/* The flag as read from the live row. */
export interface SectionRow {
  id: string;
  visible: boolean;
  updatedAt: Date;
}

/*
 * One switch: the menu that guards it, and how to read and write its one flag. The entity and
 * column stay inside the closures, so the service handles every section alike and can never write
 * any other column of the row.
 */
export interface SectionDefinition {
  key: SectionKey;
  menu: MenuKey;
  /* null when the section is not configured (no live row). */
  find(manager?: EntityManager): Promise<SectionRow | null>;
  findForUpdate(manager: EntityManager): Promise<SectionRow | null>;
  write(id: string, visible: boolean, manager: EntityManager): Promise<void>;
}

/* The boolean columns of an entity, so an entry cannot name a text column by mistake. */
type FlagColumn<T> = { [K in keyof T]-?: T[K] extends boolean ? K : never }[keyof T] & string;

function flag<T extends AppBaseEntity>(menu: MenuKey, entity: new () => T, column: FlagColumn<T>): Omit<SectionDefinition, 'key'> {
  const repo = new SingletonRepository<T>(entity);
  const toRow = (s: T | null): SectionRow | null => (s ? { id: s.id, visible: s[column] === true, updatedAt: s.updatedAt } : null);
  return {
    menu,
    find: async (manager) => toRow(await repo.find(manager)),
    findForUpdate: async (manager) => toRow(await repo.findForUpdate(manager)),
    write: async (id, visible, manager) => {
      /* A computed key loses the column's type; FlagColumn<T> above is what guarantees it is a boolean column of T. */
      const change = { [column]: visible } as unknown as QueryDeepPartialEntity<T>;
      await repo.updateWhere({ id } as FindOptionsWhere<T>, change, manager);
    },
  };
}

/*
 * Every Home Page Management tab and the flag its switch drives. A Record, so a key added to
 * SECTION_KEYS without an entry here does not compile.
 *
 * The hero and the programme band ("diploma") keep the `isPublished` they always had: the switch is
 * the same flag, which now hides the section rather than falling back to the website's bundled copy.
 * The glance card has no row of its own; its flag sits on the hero row, under the same menu.
 */
const REGISTRY: Record<SectionKey, Omit<SectionDefinition, 'key'>> = {
  'top-bar': flag('cms-topbar', TopBarSettings, 'showSection'),
  'brand-bar': flag('cms-brandbar', BrandBarSettings, 'showSection'),
  announcements: flag('cms-announcements', AnnouncementSettings, 'showSection'),
  hero: flag('cms-hero', HomeHero, 'isPublished'),
  glance: flag('cms-hero', HomeHero, 'showGlance'),
  'quick-actions': flag('cms-quickactions', QuickActionSettings, 'showSection'),
  'live-dashboard': flag('cms-livedashboard', LiveDashboardSettings, 'showSection'),
  diploma: flag('cms-highlight', ProgrammeHighlight, 'isPublished'),
  board: flag('cms-board', BoardSection, 'showSection'),
  impact: flag('cms-impact', ImpactSection, 'showSection'),
  ecosystem: flag('cms-ecosystem', EcosystemSection, 'showSection'),
  schemes: flag('cms-schemes', AmrutSchemesSection, 'showSection'),
  about: flag('cms-about', AboutSection, 'showSection'),
};

/* In the admin panel's tab order. */
export const SECTIONS: readonly SectionDefinition[] = SECTION_KEYS.map((key) => ({ key, ...REGISTRY[key] }));

export const sectionOf = (key: SectionKey): SectionDefinition => SECTIONS.find((s) => s.key === key)!;
