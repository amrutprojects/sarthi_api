import type { Request } from 'express';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { AppDataSource } from '../../config/database.config';
import { auditService } from '../../modules/audit/audit.service';
import { AUDIT_ACTIONS } from '../../shared/constants/app.constants';
import { AppError } from '../../shared/errors/app-error';
import type { QuickAction } from './quickactions.model';
import { quickActionRepository, quickActionSettingsRepository } from './quickactions.repository';
import type {
  AdminQuickAction,
  Bilingual,
  CreateQuickActionInput,
  PublicQuickAction,
  PublicQuickActions,
  UpdateQuickActionInput,
} from './quickactions.types';

const NOT_FOUND = 'Quick action not found';
const STALE_ACTION = 'This quick action was changed after you opened it. Reload to see the latest version, then make your changes again.';
const STALE_ORDER = 'The quick action list changed after you loaded it. Reload the list, then reorder again.';

const pair = (mr: string, en: string): Bilingual => ({ mr, en });
const isStale = (expected: string | undefined, actual: Date) => expected !== undefined && new Date(expected).getTime() !== actual.getTime();

/* The subtitle is blank in both languages or filled in both (database CHECK), so one half decides. */
const subtitleOf = (q: QuickAction): Bilingual | null => (q.subtitleMr ? pair(q.subtitleMr, q.subtitleEn) : null);

/* The admin form always gets a subtitle pair back — blank halves when there is none — so it saves what it loaded. */
const toAdmin = (q: QuickAction): AdminQuickAction => ({
  id: q.id,
  title: pair(q.titleMr, q.titleEn),
  subtitle: pair(q.subtitleMr, q.subtitleEn),
  icon: q.icon,
  link: q.link,
  displayOrder: q.displayOrder,
  isActive: q.isActive,
  createdAt: q.createdAt,
  updatedAt: q.updatedAt,
});

const toPublic = (q: QuickAction): PublicQuickAction => ({
  title: pair(q.titleMr, q.titleEn),
  subtitle: subtitleOf(q),
  icon: q.icon,
  link: q.link,
});

/* The tile columns an input touches. Keys the input leaves out are not in the result at all. */
function actionColumns(input: Partial<CreateQuickActionInput>): QueryDeepPartialEntity<QuickAction> {
  const out: QueryDeepPartialEntity<QuickAction> = {};
  if (input.title) Object.assign(out, { titleMr: input.title.mr, titleEn: input.title.en });
  if (input.subtitle !== undefined) Object.assign(out, { subtitleMr: input.subtitle?.mr ?? '', subtitleEn: input.subtitle?.en ?? '' });
  if (input.icon !== undefined) out.icon = input.icon;
  if (input.link !== undefined) out.link = input.link;
  if (input.displayOrder !== undefined) out.displayOrder = input.displayOrder;
  if (input.isActive !== undefined) out.isActive = input.isActive;
  return out;
}

/*
 * Quick Actions (CMS): the strip of tiles under the home page hero ("Apply Now", "Check Application
 * Status", "Verify Certificate", "Training centres") — each tile's title, subtitle, icon and link.
 * Whether the strip is shown at all is the "Show on website" switch (src/cms/visibility), the one
 * writer of the settings row; this service only reads it.
 *
 * Tiles are soft-deleted, like every record here; nothing else references them.
 */
export class QuickActionsService {
  async listForAdmin(): Promise<AdminQuickAction[]> {
    return (await quickActionRepository.list()).map(toAdmin);
  }

  async getForAdmin(id: string): Promise<AdminQuickAction> {
    const q = await quickActionRepository.findById(id);
    if (!q) throw AppError.notFound(NOT_FOUND);
    return toAdmin(q);
  }

  async create(input: CreateQuickActionInput, req?: Request): Promise<AdminQuickAction> {
    const id = await AppDataSource.transaction(async (m) => {
      const created = await quickActionRepository.create(
        {
          titleMr: input.title.mr,
          titleEn: input.title.en,
          subtitleMr: input.subtitle?.mr ?? '',
          subtitleEn: input.subtitle?.en ?? '',
          icon: input.icon,
          link: input.link,
          /* A new tile goes to the end of the strip unless an order is given. */
          displayOrder: input.displayOrder ?? (await quickActionRepository.maxOrder(m)) + 1,
          isActive: input.isActive ?? true,
        },
        m,
      );
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.QUICK_ACTION_CREATE,
        resource: 'quick-action',
        resourceId: created.id,
        details: { title: created.titleEn, icon: created.icon, link: created.link, isActive: created.isActive },
      });
      return created.id;
    });
    return this.getForAdmin(id);
  }

  /*
   * A partial update. `expectedUpdatedAt` is the version the admin screen loaded; a mismatch means
   * someone else saved first, and their work is kept rather than silently overwritten.
   */
  async update(id: string, input: UpdateQuickActionInput, req?: Request): Promise<AdminQuickAction> {
    await AppDataSource.transaction(async (m) => {
      const current = await quickActionRepository.findForUpdate(id, m);
      if (!current) throw AppError.notFound(NOT_FOUND);
      if (isStale(input.expectedUpdatedAt, current.updatedAt)) throw AppError.conflict(STALE_ACTION);

      const changes = actionColumns(input);
      if (Object.keys(changes).length) await quickActionRepository.updateWhere({ id }, changes, m);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.QUICK_ACTION_UPDATE,
        resource: 'quick-action',
        resourceId: id,
        details: { fields: Object.keys(changes) },
      });
    });
    return this.getForAdmin(id);
  }

  async setActive(id: string, isActive: boolean, req?: Request): Promise<AdminQuickAction> {
    await AppDataSource.transaction(async (m) => {
      if (!(await quickActionRepository.findForUpdate(id, m))) throw AppError.notFound(NOT_FOUND);
      await quickActionRepository.updateWhere({ id }, { isActive }, m);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.QUICK_ACTION_STATUS,
        resource: 'quick-action',
        resourceId: id,
        details: { isActive },
      });
    });
    return this.getForAdmin(id);
  }

  async remove(id: string, req?: Request): Promise<void> {
    await AppDataSource.transaction(async (m) => {
      const current = await quickActionRepository.findForUpdate(id, m);
      if (!current) throw AppError.notFound(NOT_FOUND);
      await quickActionRepository.softDelete(id, m);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.QUICK_ACTION_DELETE,
        resource: 'quick-action',
        resourceId: id,
        details: { title: current.titleEn, link: current.link },
      });
    });
  }

  /*
   * Rewrites the display order from a full list of ids, in one transaction. The list must name every
   * tile exactly once: anything else means the screen is out of date, and guessing where the missing
   * tiles go would move the wrong one.
   */
  async reorder(ids: string[], req?: Request): Promise<AdminQuickAction[]> {
    await AppDataSource.transaction(async (m) => {
      const all = await quickActionRepository.lockAll(m);
      const byId = new Map(all.map((r) => [r.id, r]));
      if (ids.length !== all.length || ids.some((id) => !byId.has(id))) throw AppError.conflict(STALE_ORDER);
      for (const [index, id] of ids.entries()) {
        if (byId.get(id)!.displayOrder !== index + 1) await quickActionRepository.updateWhere({ id }, { displayOrder: index + 1 }, m);
      }
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.QUICK_ACTIONS_REORDER,
        resource: 'quick-action',
        details: { order: ids },
      });
    });
    return this.listForAdmin();
  }

  /*
   * What the website reads. Null — not an error — when the strip has never been configured, so the
   * site keeps its own bundled tiles. A hidden strip comes back with `showSection: false` and no
   * tiles, never as null, so the site leaves it out instead of falling back. A blank subtitle comes
   * back as null, and the site then leaves the small line out.
   */
  async getPublic(): Promise<PublicQuickActions | null> {
    const s = await quickActionSettingsRepository.find();
    if (!s || !s.isActive) return null;
    const actions = s.showSection ? await quickActionRepository.list({ activeOnly: true }) : [];
    return { showSection: s.showSection, actions: actions.map(toPublic) };
  }
}

export const quickActionsService = new QuickActionsService();
