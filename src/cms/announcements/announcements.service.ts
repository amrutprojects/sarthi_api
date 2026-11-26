import type { Request } from 'express';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { AppDataSource } from '../../config/database.config';
import { auditService } from '../../modules/audit/audit.service';
import { AUDIT_ACTIONS } from '../../shared/constants/app.constants';
import { AppError } from '../../shared/errors/app-error';
import type { Announcement, AnnouncementSettings } from './announcements.model';
import { announcementRepository, announcementSettingsRepository } from './announcements.repository';
import type {
  AdminAnnouncement,
  AdminAnnouncementSettings,
  Bilingual,
  CreateAnnouncementInput,
  PublicAnnouncement,
  PublicAnnouncements,
  UpdateAnnouncementInput,
  UpdateAnnouncementSettingsInput,
} from './announcements.types';
import { assertNoDependencies } from '../../shared/dependencies/dependencies';
import { ANNOUNCEMENT_DEPENDENCIES } from '../cms.dependencies';

const NOT_FOUND = 'Announcement not found';
const NOT_CONFIGURED = 'The announcement ticker has not been configured yet. Run the database seed to create it.';
const STALE_ANNOUNCEMENT =
  'This announcement was changed after you opened it. Reload to see the latest version, then make your changes again.';
const STALE_SETTINGS =
  'The ticker settings were changed after you opened them. Reload to see the latest version, then make your changes again.';
const STALE_ORDER = 'The announcement list changed after you loaded it. Reload the list, then reorder again.';

const pair = (mr: string, en: string): Bilingual => ({ mr, en });
const isStale = (expected: string | undefined, actual: Date) => expected !== undefined && new Date(expected).getTime() !== actual.getTime();

/* The detail is blank in both languages or filled in both (database CHECK), so one half decides. */
const detailOf = (a: Announcement): Bilingual | null => (a.detailMr ? pair(a.detailMr, a.detailEn) : null);

const toAdmin = (a: Announcement): AdminAnnouncement => ({
  id: a.id,
  title: pair(a.titleMr, a.titleEn),
  detail: detailOf(a),
  link: a.link,
  displayOrder: a.displayOrder,
  isActive: a.isActive,
  createdAt: a.createdAt,
  updatedAt: a.updatedAt,
});

const toAdminSettings = (s: AnnouncementSettings): AdminAnnouncementSettings => ({
  id: s.id,
  label: pair(s.labelMr, s.labelEn),
  showSection: s.showSection,
  createdAt: s.createdAt,
  updatedAt: s.updatedAt,
});

/* What the ticker prints: the optional parts are left out, never sent as empty text. */
const toPublic = (a: Announcement): PublicAnnouncement => {
  const detail = detailOf(a);
  return { title: pair(a.titleMr, a.titleEn), ...(detail && { detail }), ...(a.link && { link: a.link }) };
};

/* The announcement columns an input touches. Keys the input leaves out are not in the result at all. */
function announcementColumns(input: Partial<CreateAnnouncementInput>): QueryDeepPartialEntity<Announcement> {
  const out: QueryDeepPartialEntity<Announcement> = {};
  if (input.title) Object.assign(out, { titleMr: input.title.mr, titleEn: input.title.en });
  if (input.detail !== undefined) Object.assign(out, { detailMr: input.detail?.mr ?? '', detailEn: input.detail?.en ?? '' });
  if (input.link !== undefined) out.link = input.link;
  if (input.displayOrder !== undefined) out.displayOrder = input.displayOrder;
  if (input.isActive !== undefined) out.isActive = input.isActive;
  return out;
}

/*
 * Announcements (CMS): the scrolling ticker at the top of every website page — its label, whether it
 * is shown, and the announcements it scrolls.
 *
 * Announcements are soft-deleted, like every record here; nothing else references them.
 */
export class AnnouncementsService {
  async listForAdmin(): Promise<AdminAnnouncement[]> {
    return (await announcementRepository.list()).map(toAdmin);
  }

  async getForAdmin(id: string): Promise<AdminAnnouncement> {
    const a = await announcementRepository.findById(id);
    if (!a) throw AppError.notFound(NOT_FOUND);
    return toAdmin(a);
  }

  async create(input: CreateAnnouncementInput, req?: Request): Promise<AdminAnnouncement> {
    const id = await AppDataSource.transaction(async (m) => {
      const created = await announcementRepository.create(
        {
          titleMr: input.title.mr,
          titleEn: input.title.en,
          detailMr: input.detail?.mr ?? '',
          detailEn: input.detail?.en ?? '',
          link: input.link ?? null,
          /* A new announcement goes to the end of the ticker unless an order is given. */
          displayOrder: input.displayOrder ?? (await announcementRepository.maxOrder(m)) + 1,
          isActive: input.isActive ?? true,
        },
        m,
      );
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.ANNOUNCEMENT_CREATE,
        resource: 'announcement',
        resourceId: created.id,
        details: { title: created.titleEn, link: created.link, isActive: created.isActive },
      });
      return created.id;
    });
    return this.getForAdmin(id);
  }

  /*
   * A partial update. `expectedUpdatedAt` is the version the admin screen loaded; a mismatch means
   * someone else saved first, and their work is kept rather than silently overwritten.
   */
  async update(id: string, input: UpdateAnnouncementInput, req?: Request): Promise<AdminAnnouncement> {
    await AppDataSource.transaction(async (m) => {
      const current = await announcementRepository.findForUpdate(id, m);
      if (!current) throw AppError.notFound(NOT_FOUND);
      if (isStale(input.expectedUpdatedAt, current.updatedAt)) throw AppError.conflict(STALE_ANNOUNCEMENT);

      const changes = announcementColumns(input);
      if (Object.keys(changes).length) await announcementRepository.updateWhere({ id }, changes, m);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.ANNOUNCEMENT_UPDATE,
        resource: 'announcement',
        resourceId: id,
        details: { fields: Object.keys(changes) },
      });
    });
    return this.getForAdmin(id);
  }

  async setActive(id: string, isActive: boolean, req?: Request): Promise<AdminAnnouncement> {
    await AppDataSource.transaction(async (m) => {
      if (!(await announcementRepository.findForUpdate(id, m))) throw AppError.notFound(NOT_FOUND);
      await announcementRepository.updateWhere({ id }, { isActive }, m);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.ANNOUNCEMENT_STATUS,
        resource: 'announcement',
        resourceId: id,
        details: { isActive },
      });
    });
    return this.getForAdmin(id);
  }

  async remove(id: string, req?: Request): Promise<void> {
    await AppDataSource.transaction(async (m) => {
      const current = await announcementRepository.findForUpdate(id, m);
      if (!current) throw AppError.notFound(NOT_FOUND);
      await assertNoDependencies(ANNOUNCEMENT_DEPENDENCIES, id, m);
      await announcementRepository.softDelete(id, m);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.ANNOUNCEMENT_DELETE,
        resource: 'announcement',
        resourceId: id,
        details: { title: current.titleEn, link: current.link },
      });
    });
  }

  /*
   * Rewrites the display order from a full list of ids, in one transaction. The list must name every
   * announcement exactly once: anything else means the screen is out of date, and guessing where the
   * missing announcements go would move the wrong one.
   */
  async reorder(ids: string[], req?: Request): Promise<AdminAnnouncement[]> {
    await AppDataSource.transaction(async (m) => {
      const all = await announcementRepository.lockAll(m);
      const byId = new Map(all.map((r) => [r.id, r]));
      if (ids.length !== all.length || ids.some((id) => !byId.has(id))) throw AppError.conflict(STALE_ORDER);
      for (const [index, id] of ids.entries()) {
        if (byId.get(id)!.displayOrder !== index + 1) await announcementRepository.updateWhere({ id }, { displayOrder: index + 1 }, m);
      }
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.ANNOUNCEMENTS_REORDER,
        resource: 'announcement',
        details: { order: ids },
      });
    });
    return this.listForAdmin();
  }

  async getSettings(): Promise<AdminAnnouncementSettings> {
    const s = await announcementSettingsRepository.find();
    if (!s) throw AppError.notFound(NOT_CONFIGURED);
    return toAdminSettings(s);
  }

  async updateSettings(input: UpdateAnnouncementSettingsInput, req?: Request): Promise<AdminAnnouncementSettings> {
    await AppDataSource.transaction(async (m) => {
      const s = await announcementSettingsRepository.findForUpdate(m);
      if (!s) throw AppError.notFound(NOT_CONFIGURED);
      if (isStale(input.expectedUpdatedAt, s.updatedAt)) throw AppError.conflict(STALE_SETTINGS);
      await announcementSettingsRepository.updateWhere(
        { id: s.id },
        { labelMr: input.label.mr, labelEn: input.label.en, showSection: input.showSection },
        m,
      );
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.ANNOUNCEMENT_SETTINGS_UPDATE,
        resource: 'announcement-settings',
        resourceId: s.id,
        details: { label: input.label.en, showSection: input.showSection },
      });
    });
    return this.getSettings();
  }

  /*
   * What the website reads. Null — not an error — when the ticker has never been configured, so the
   * site keeps its own bundled notice. A switched-off ticker comes back with `showSection: false`
   * and no items, and the site then leaves the strip out.
   */
  async getPublic(): Promise<PublicAnnouncements | null> {
    const s = await announcementSettingsRepository.find();
    if (!s || !s.isActive) return null;
    const items = s.showSection ? await announcementRepository.list({ activeOnly: true }) : [];
    return { showSection: s.showSection, label: pair(s.labelMr, s.labelEn), items: items.map(toPublic) };
  }
}

export const announcementsService = new AnnouncementsService();
