import type { Request } from 'express';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { AppDataSource } from '../../config/database.config';
import { auditService } from '../../modules/audit/audit.service';
import { AUDIT_ACTIONS } from '../../shared/constants/app.constants';
import { AppError } from '../../shared/errors/app-error';
import type { TopBarLink, TopBarSettings } from './topbar.model';
import { topBarLinkRepository, topBarSettingsRepository } from './topbar.repository';
import type {
  AdminTopBarLink,
  AdminTopBarSettings,
  Bilingual,
  CreateTopBarLinkInput,
  PublicTopBar,
  PublicTopBarLink,
  UpdateTopBarLinkInput,
  UpdateTopBarSettingsInput,
} from './topbar.types';

const NOT_FOUND = 'Top Bar link not found';
const NOT_CONFIGURED = 'The Top Bar has not been configured yet. Run the database seed to create it.';
const STALE_LINK = 'This link was changed after you opened it. Reload to see the latest version, then make your changes again.';
const STALE_SETTINGS =
  'The Top Bar settings were changed after you opened them. Reload to see the latest version, then make your changes again.';
const STALE_ORDER = 'The link list changed after you loaded it. Reload the list, then reorder again.';

const pair = (mr: string, en: string): Bilingual => ({ mr, en });
const isStale = (expected: string | undefined, actual: Date) => expected !== undefined && new Date(expected).getTime() !== actual.getTime();

/* The government name is blank in both languages or filled in both (database CHECK), so one half decides. */
const nameOf = (s: TopBarSettings): Bilingual | null => (s.governmentNameMr ? pair(s.governmentNameMr, s.governmentNameEn) : null);

const toAdmin = (l: TopBarLink): AdminTopBarLink => ({
  id: l.id,
  label: pair(l.labelMr, l.labelEn),
  link: l.link,
  displayOrder: l.displayOrder,
  isActive: l.isActive,
  createdAt: l.createdAt,
  updatedAt: l.updatedAt,
});

/* The admin form always gets a pair back — blank halves when there is no name — so it saves what it loaded. */
const toAdminSettings = (s: TopBarSettings): AdminTopBarSettings => ({
  id: s.id,
  governmentName: pair(s.governmentNameMr, s.governmentNameEn),
  showLanguageToggle: s.showLanguageToggle,
  createdAt: s.createdAt,
  updatedAt: s.updatedAt,
});

const toPublicLink = (l: TopBarLink): PublicTopBarLink => ({ label: pair(l.labelMr, l.labelEn), link: l.link });

/* The link columns an input touches. Keys the input leaves out are not in the result at all. */
function linkColumns(input: Partial<CreateTopBarLinkInput>): QueryDeepPartialEntity<TopBarLink> {
  const out: QueryDeepPartialEntity<TopBarLink> = {};
  if (input.label) Object.assign(out, { labelMr: input.label.mr, labelEn: input.label.en });
  if (input.link !== undefined) out.link = input.link;
  if (input.displayOrder !== undefined) out.displayOrder = input.displayOrder;
  if (input.isActive !== undefined) out.isActive = input.isActive;
  return out;
}

/*
 * Top Bar (CMS): the strip at the very top of every website page — the government name, the links
 * beside it ("Verify Certificate", "Check Application Status") and whether the language switch is shown.
 *
 * Links are soft-deleted, like every record here; nothing else references them.
 */
export class TopBarService {
  async listForAdmin(): Promise<AdminTopBarLink[]> {
    return (await topBarLinkRepository.list()).map(toAdmin);
  }

  async getForAdmin(id: string): Promise<AdminTopBarLink> {
    const l = await topBarLinkRepository.findById(id);
    if (!l) throw AppError.notFound(NOT_FOUND);
    return toAdmin(l);
  }

  async create(input: CreateTopBarLinkInput, req?: Request): Promise<AdminTopBarLink> {
    const id = await AppDataSource.transaction(async (m) => {
      const created = await topBarLinkRepository.create(
        {
          labelMr: input.label.mr,
          labelEn: input.label.en,
          link: input.link,
          /* A new link goes to the end of the bar unless an order is given. */
          displayOrder: input.displayOrder ?? (await topBarLinkRepository.maxOrder(m)) + 1,
          isActive: input.isActive ?? true,
        },
        m,
      );
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.TOPBAR_LINK_CREATE,
        resource: 'top-bar-link',
        resourceId: created.id,
        details: { label: created.labelEn, link: created.link, isActive: created.isActive },
      });
      return created.id;
    });
    return this.getForAdmin(id);
  }

  /*
   * A partial update. `expectedUpdatedAt` is the version the admin screen loaded; a mismatch means
   * someone else saved first, and their work is kept rather than silently overwritten.
   */
  async update(id: string, input: UpdateTopBarLinkInput, req?: Request): Promise<AdminTopBarLink> {
    await AppDataSource.transaction(async (m) => {
      const current = await topBarLinkRepository.findForUpdate(id, m);
      if (!current) throw AppError.notFound(NOT_FOUND);
      if (isStale(input.expectedUpdatedAt, current.updatedAt)) throw AppError.conflict(STALE_LINK);

      const changes = linkColumns(input);
      if (Object.keys(changes).length) await topBarLinkRepository.updateWhere({ id }, changes, m);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.TOPBAR_LINK_UPDATE,
        resource: 'top-bar-link',
        resourceId: id,
        details: { fields: Object.keys(changes) },
      });
    });
    return this.getForAdmin(id);
  }

  async setActive(id: string, isActive: boolean, req?: Request): Promise<AdminTopBarLink> {
    await AppDataSource.transaction(async (m) => {
      if (!(await topBarLinkRepository.findForUpdate(id, m))) throw AppError.notFound(NOT_FOUND);
      await topBarLinkRepository.updateWhere({ id }, { isActive }, m);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.TOPBAR_LINK_STATUS,
        resource: 'top-bar-link',
        resourceId: id,
        details: { isActive },
      });
    });
    return this.getForAdmin(id);
  }

  async remove(id: string, req?: Request): Promise<void> {
    await AppDataSource.transaction(async (m) => {
      const current = await topBarLinkRepository.findForUpdate(id, m);
      if (!current) throw AppError.notFound(NOT_FOUND);
      await topBarLinkRepository.softDelete(id, m);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.TOPBAR_LINK_DELETE,
        resource: 'top-bar-link',
        resourceId: id,
        details: { label: current.labelEn, link: current.link },
      });
    });
  }

  /*
   * Rewrites the display order from a full list of ids, in one transaction. The list must name every
   * link exactly once: anything else means the screen is out of date, and guessing where the missing
   * links go would move the wrong one.
   */
  async reorder(ids: string[], req?: Request): Promise<AdminTopBarLink[]> {
    await AppDataSource.transaction(async (m) => {
      const all = await topBarLinkRepository.lockAll(m);
      const byId = new Map(all.map((r) => [r.id, r]));
      if (ids.length !== all.length || ids.some((id) => !byId.has(id))) throw AppError.conflict(STALE_ORDER);
      for (const [index, id] of ids.entries()) {
        if (byId.get(id)!.displayOrder !== index + 1) await topBarLinkRepository.updateWhere({ id }, { displayOrder: index + 1 }, m);
      }
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.TOPBAR_LINKS_REORDER,
        resource: 'top-bar-link',
        details: { order: ids },
      });
    });
    return this.listForAdmin();
  }

  async getSettings(): Promise<AdminTopBarSettings> {
    const s = await topBarSettingsRepository.find();
    if (!s) throw AppError.notFound(NOT_CONFIGURED);
    return toAdminSettings(s);
  }

  async updateSettings(input: UpdateTopBarSettingsInput, req?: Request): Promise<AdminTopBarSettings> {
    await AppDataSource.transaction(async (m) => {
      const s = await topBarSettingsRepository.findForUpdate(m);
      if (!s) throw AppError.notFound(NOT_CONFIGURED);
      if (isStale(input.expectedUpdatedAt, s.updatedAt)) throw AppError.conflict(STALE_SETTINGS);
      await topBarSettingsRepository.updateWhere(
        { id: s.id },
        {
          governmentNameMr: input.governmentName.mr,
          governmentNameEn: input.governmentName.en,
          showLanguageToggle: input.showLanguageToggle,
        },
        m,
      );
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.TOPBAR_SETTINGS_UPDATE,
        resource: 'top-bar-settings',
        resourceId: s.id,
        details: { governmentName: input.governmentName.en, showLanguageToggle: input.showLanguageToggle },
      });
    });
    return this.getSettings();
  }

  /*
   * What the website reads. Null — not an error — when the Top Bar has never been configured, so the
   * site keeps its own bundled strip. A blank government name comes back as null, and the site then
   * leaves the bold text out.
   */
  async getPublic(): Promise<PublicTopBar | null> {
    const s = await topBarSettingsRepository.find();
    if (!s || !s.isActive) return null;
    const links = await topBarLinkRepository.list({ activeOnly: true });
    return { governmentName: nameOf(s), showLanguageToggle: s.showLanguageToggle, links: links.map(toPublicLink) };
  }
}

export const topBarService = new TopBarService();
