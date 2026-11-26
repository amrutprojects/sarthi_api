import type { Request } from 'express';
import type { EntityManager } from 'typeorm';
import { AppDataSource } from '../../config/database.config';
import { AUDIT_ACTIONS } from '../../shared/constants/app.constants';
import { auditService } from '../../modules/audit/audit.service';
import { AppError } from '../../shared/errors/app-error';
import type { Paginated } from '../../shared/utils/pagination';
import { eligibilityItemRepository } from '../eligibility/eligibility.repository';
import type { ApplyItemKind, ApplyPageItem, ApplyPageSettings } from './apply.model';
import { applyItemRepository, applySettingsRepository } from './apply.repository';
import type {
  AdminApplyItem,
  AdminApplySettings,
  ApplyListQuery,
  ApplyPageText,
  Bilingual,
  CreateApplyItemInput,
  PublicApplyPage,
  UpdateApplyItemInput,
  UpdateApplySettingsInput,
} from './apply.types';
import { assertNoDependencies } from '../../shared/dependencies/dependencies';
import { APPLY_ITEM_DEPENDENCIES } from '../cms.dependencies';

const NOT_FOUND = 'Apply page item not found';
const NOT_CONFIGURED = 'The Apply page has not been configured yet. Run the database migrations.';

/* How each kind is named in a message. */
const KIND_NAME: Record<ApplyItemKind, string> = { STEP: 'application step', FACT: '"At a glance" row' };

const toPageText = (s: ApplyPageSettings): ApplyPageText => ({
  pageTitle: { mr: s.pageTitleMr, en: s.pageTitleEn },
  pageSubtitle: { mr: s.pageSubtitleMr, en: s.pageSubtitleEn },
  noteTitle: { mr: s.noteTitleMr, en: s.noteTitleEn },
  noteBody: { mr: s.noteBodyMr, en: s.noteBodyEn },
  glanceHeading: { mr: s.glanceHeadingMr, en: s.glanceHeadingEn },
  documentsHeading: { mr: s.documentsHeadingMr, en: s.documentsHeadingEn },
  ctaText: { mr: s.ctaTextMr, en: s.ctaTextEn },
  ctaLabel: { mr: s.ctaLabelMr, en: s.ctaLabelEn },
  ctaUrl: s.ctaUrl,
  ctaHint: { mr: s.ctaHintMr, en: s.ctaHintEn },
});

const toAdminSettings = (s: ApplyPageSettings): AdminApplySettings => ({
  id: s.id,
  ...toPageText(s),
  createdAt: s.createdAt,
  updatedAt: s.updatedAt,
});

const toAdminItem = (i: ApplyPageItem): AdminApplyItem => ({
  id: i.id,
  kind: i.kind,
  label: { mr: i.labelMr, en: i.labelEn },
  value: { mr: i.valueMr, en: i.valueEn },
  displayOrder: i.displayOrder,
  isActive: i.isActive,
  createdAt: i.createdAt,
  updatedAt: i.updatedAt,
});

/*
 * The same step or "At a glance" row cannot be listed twice, in either language. Checked within the
 * row's own kind and against the live rows only (soft-deleted ones keep their history without
 * blocking a new one), exactly as the partial unique indexes on the table do.
 */
async function assertLabelFree(kind: ApplyItemKind, label: Bilingual, m: EntityManager, excludeId?: string): Promise<void> {
  if (await applyItemRepository.findByLabel(kind, 'En', label.en, { excludeId, manager: m })) {
    throw AppError.conflict(`Another ${KIND_NAME[kind]} already has this name (English)`);
  }
  if (await applyItemRepository.findByLabel(kind, 'Mr', label.mr, { excludeId, manager: m })) {
    throw AppError.conflict(`Another ${KIND_NAME[kind]} already has this name (Marathi)`);
  }
}

/*
 * Apply page content (CMS).
 *
 * The page text is a database-enforced singleton written by the migration, so it is read and
 * replaced but never created or deleted through the API. A missing row is a deployment problem (the
 * migration has not run), not something a request should silently repair — the admin read reports
 * it plainly and the public read degrades to null so the website shows its own copy.
 *
 * Each step and each "At a glance" row is an independent record with the usual master lifecycle —
 * create, edit, activate / deactivate, soft-delete, restore — and every write is audited. The
 * website reads only the active ones, in display order, through getPublic().
 *
 * The "Documents to keep ready" list is not stored here: getPublic() returns the Eligibility page's
 * active required documents, so the two pages can never disagree about what to bring.
 *
 * Every rule here is also a database constraint (non-blank text, an https portal link, unique labels
 * within a kind among live rows, a non-negative order). The checks exist to return a readable 4xx
 * instead of a raw constraint error.
 */
export class ApplyService {
  /* ---------------- page text ---------------- */

  async getSettings(): Promise<AdminApplySettings> {
    const settings = await applySettingsRepository.findSettings();
    if (!settings) throw AppError.notFound(NOT_CONFIGURED);
    return toAdminSettings(settings);
  }

  async updateSettings(input: UpdateApplySettingsInput, req?: Request): Promise<AdminApplySettings> {
    await AppDataSource.transaction(async (m) => {
      const settings = await applySettingsRepository.findSettings(m);
      if (!settings) throw AppError.notFound(NOT_CONFIGURED);
      await applySettingsRepository.update(
        settings.id,
        {
          pageTitleMr: input.pageTitle.mr,
          pageTitleEn: input.pageTitle.en,
          pageSubtitleMr: input.pageSubtitle.mr,
          pageSubtitleEn: input.pageSubtitle.en,
          noteTitleMr: input.noteTitle.mr,
          noteTitleEn: input.noteTitle.en,
          noteBodyMr: input.noteBody.mr,
          noteBodyEn: input.noteBody.en,
          glanceHeadingMr: input.glanceHeading.mr,
          glanceHeadingEn: input.glanceHeading.en,
          documentsHeadingMr: input.documentsHeading.mr,
          documentsHeadingEn: input.documentsHeading.en,
          ctaTextMr: input.ctaText.mr,
          ctaTextEn: input.ctaText.en,
          ctaLabelMr: input.ctaLabel.mr,
          ctaLabelEn: input.ctaLabel.en,
          ctaUrl: input.ctaUrl,
          ctaHintMr: input.ctaHint.mr,
          ctaHintEn: input.ctaHint.en,
        },
        m,
      );
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.APPLY_SETTINGS_UPDATE,
        resource: 'apply-page',
        resourceId: settings.id,
        details: {
          from: { pageTitle: settings.pageTitleEn, ctaUrl: settings.ctaUrl },
          to: { pageTitle: input.pageTitle.en, ctaUrl: input.ctaUrl },
        },
      });
    });
    return this.getSettings();
  }

  /*
   * What the website reads: the page text with the active steps and "At a glance" rows, each in
   * display order, and the Eligibility page's active required documents. Returns null — not an
   * error — when the page has never been configured, because "there is nothing to show" is a normal
   * state the site handles by rendering its own bundled copy. Empty lists are a legitimate answer
   * too — every row of that kind has been deactivated.
   */
  async getPublic(): Promise<PublicApplyPage | null> {
    const settings = await applySettingsRepository.findSettings();
    if (!settings) return null;

    const items = await applyItemRepository.findPublished();
    /* The very list the Eligibility page shows (same filter, same order), not a copy of it. */
    const eligibility = await eligibilityItemRepository.findPublished();
    return {
      ...toPageText(settings),
      steps: items
        .filter((i) => i.kind === 'STEP')
        .map((i) => ({ title: { mr: i.labelMr, en: i.labelEn }, description: { mr: i.valueMr, en: i.valueEn } })),
      facts: items
        .filter((i) => i.kind === 'FACT')
        .map((i) => ({ label: { mr: i.labelMr, en: i.labelEn }, value: { mr: i.valueMr, en: i.valueEn } })),
      documents: eligibility.filter((i) => i.kind === 'DOCUMENT').map((i) => ({ mr: i.labelMr, en: i.labelEn })),
    };
  }

  /* ---------------- steps and "At a glance" rows ---------------- */

  async list(q: ApplyListQuery): Promise<Paginated<AdminApplyItem>> {
    const page = await applyItemRepository.list(q);
    return { items: page.items.map(toAdminItem), meta: page.meta };
  }

  async get(id: string): Promise<AdminApplyItem> {
    const item = await applyItemRepository.findById(id);
    if (!item) throw AppError.notFound(NOT_FOUND);
    return toAdminItem(item);
  }

  async create(input: CreateApplyItemInput, req?: Request): Promise<AdminApplyItem> {
    const id = await AppDataSource.transaction(async (m) => {
      await assertLabelFree(input.kind, input.label, m);
      const item = await applyItemRepository.create(
        {
          kind: input.kind,
          labelMr: input.label.mr,
          labelEn: input.label.en,
          valueMr: input.value.mr,
          valueEn: input.value.en,
          displayOrder: input.displayOrder ?? (await applyItemRepository.nextDisplayOrder(input.kind, m)),
          isActive: input.isActive ?? true,
        },
        m,
      );
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.APPLY_ITEM_CREATE,
        resource: 'apply-item',
        resourceId: item.id,
        details: { kind: item.kind, label: item.labelEn, displayOrder: item.displayOrder, isActive: item.isActive },
      });
      return item.id;
    });
    return this.get(id);
  }

  /* Edits the label, value and order. The kind stays as created. */
  async update(id: string, input: UpdateApplyItemInput, req?: Request): Promise<AdminApplyItem> {
    await AppDataSource.transaction(async (m) => {
      const item = await applyItemRepository.findById(id, { manager: m });
      if (!item) throw AppError.notFound(NOT_FOUND);
      if (input.label) await assertLabelFree(item.kind, input.label, m, id);
      await applyItemRepository.update(
        id,
        {
          ...(input.label ? { labelMr: input.label.mr, labelEn: input.label.en } : {}),
          ...(input.value ? { valueMr: input.value.mr, valueEn: input.value.en } : {}),
          ...(input.displayOrder === undefined ? {} : { displayOrder: input.displayOrder }),
        },
        m,
      );
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.APPLY_ITEM_UPDATE,
        resource: 'apply-item',
        resourceId: id,
        details: { kind: item.kind, fields: Object.keys(input), from: { label: item.labelEn, displayOrder: item.displayOrder } },
      });
    });
    return this.get(id);
  }

  /* Deactivation hides the row from the website but keeps it here, ready to bring back. */
  async setStatus(id: string, isActive: boolean, req?: Request): Promise<AdminApplyItem> {
    await AppDataSource.transaction(async (m) => {
      const item = await applyItemRepository.findById(id, { manager: m });
      if (!item) throw AppError.notFound(NOT_FOUND);
      await applyItemRepository.update(id, { isActive }, m);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.APPLY_ITEM_STATUS,
        resource: 'apply-item',
        resourceId: id,
        details: { kind: item.kind, isActive, label: item.labelEn },
      });
    });
    return this.get(id);
  }

  /* Soft-deletes the row: it leaves the website and the list, and stays in the table for audit. */
  async remove(id: string, req?: Request): Promise<void> {
    await AppDataSource.transaction(async (m) => {
      const item = await applyItemRepository.findById(id, { manager: m });
      if (!item) throw AppError.notFound(NOT_FOUND);
      await assertNoDependencies(APPLY_ITEM_DEPENDENCIES, id, m);
      await applyItemRepository.softDelete(id, m);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.APPLY_ITEM_DELETE,
        resource: 'apply-item',
        resourceId: id,
        details: { kind: item.kind, label: item.labelEn },
      });
    });
  }

  /* Brings a soft-deleted row back, inactive. Refused when the same label has been added meanwhile. */
  async restore(id: string, req?: Request): Promise<AdminApplyItem> {
    await AppDataSource.transaction(async (m) => {
      const existing = await applyItemRepository.findByIdIncludingDeleted(id, m);
      if (!existing) throw AppError.notFound(NOT_FOUND);
      if (!existing.isDelete) throw AppError.conflict('Apply page item is not deleted');
      await assertLabelFree(existing.kind, { mr: existing.labelMr, en: existing.labelEn }, m);
      await applyItemRepository.restore(id, m);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.APPLY_ITEM_RESTORE,
        resource: 'apply-item',
        resourceId: id,
        details: { kind: existing.kind, label: existing.labelEn },
      });
    });
    return this.get(id);
  }
}

export const applyService = new ApplyService();
