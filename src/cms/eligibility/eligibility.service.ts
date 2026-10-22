import type { Request } from 'express';
import type { EntityManager } from 'typeorm';
import { AppDataSource } from '../../config/database.config';
import { AUDIT_ACTIONS } from '../../shared/constants/app.constants';
import { auditService } from '../../modules/audit/audit.service';
import { AppError } from '../../shared/errors/app-error';
import type { Paginated } from '../../shared/utils/pagination';
import type { EligibilityItem, EligibilityItemKind, EligibilityPageSettings } from './eligibility.model';
import { eligibilityItemRepository, eligibilitySettingsRepository } from './eligibility.repository';
import type {
  AdminEligibilityItem,
  AdminEligibilitySettings,
  Bilingual,
  CreateEligibilityItemInput,
  EligibilityListQuery,
  EligibilityPageText,
  PublicEligibilityPage,
  UpdateEligibilityItemInput,
  UpdateEligibilitySettingsInput,
} from './eligibility.types';

const NOT_FOUND = 'Eligibility item not found';
const NOT_CONFIGURED = 'The Eligibility page has not been configured yet. Run the database migrations.';

/* How each kind is named in a message. */
const KIND_NAME: Record<EligibilityItemKind, string> = { CRITERION: 'eligibility criterion', DOCUMENT: 'required document' };

const toPageText = (s: EligibilityPageSettings): EligibilityPageText => ({
  pageTitle: { mr: s.pageTitleMr, en: s.pageTitleEn },
  pageSubtitle: { mr: s.pageSubtitleMr, en: s.pageSubtitleEn },
  criteriaHeading: { mr: s.criteriaHeadingMr, en: s.criteriaHeadingEn },
  documentsHeading: { mr: s.documentsHeadingMr, en: s.documentsHeadingEn },
  noteTitle: { mr: s.noteTitleMr, en: s.noteTitleEn },
  noteBody: { mr: s.noteBodyMr, en: s.noteBodyEn },
});

const toAdminSettings = (s: EligibilityPageSettings): AdminEligibilitySettings => ({
  id: s.id,
  ...toPageText(s),
  createdAt: s.createdAt,
  updatedAt: s.updatedAt,
});

/* A DOCUMENT row stores no value; the CHECK constraint guarantees a CRITERION row stores both halves. */
const valueOf = (i: EligibilityItem): Bilingual | null =>
  i.valueMr !== null && i.valueEn !== null ? { mr: i.valueMr, en: i.valueEn } : null;

const toAdminItem = (i: EligibilityItem): AdminEligibilityItem => ({
  id: i.id,
  kind: i.kind,
  label: { mr: i.labelMr, en: i.labelEn },
  value: valueOf(i),
  displayOrder: i.displayOrder,
  isActive: i.isActive,
  createdAt: i.createdAt,
  updatedAt: i.updatedAt,
});

/*
 * A criterion is printed as a label/value row, so it cannot be without a value; a document is a
 * single line, so it cannot carry one. The create validator already enforces this on the request; it
 * is checked again here because on update the answer depends on the stored row's kind. Mirrors
 * CHK_eligibility_items_value_by_kind.
 */
function assertValueFitsKind(kind: EligibilityItemKind, value: Bilingual | null): void {
  if (kind === 'CRITERION' && !value) {
    throw AppError.badRequest('An eligibility criterion needs a value', [
      { field: 'value', message: 'Value is required for an eligibility criterion' },
    ]);
  }
  if (kind === 'DOCUMENT' && value) {
    throw AppError.badRequest('A required document does not take a value', [
      { field: 'value', message: 'A required document does not take a value' },
    ]);
  }
}

/*
 * The same criterion or document cannot be listed twice, in either language. Checked within the
 * row's own kind and against the live rows only (soft-deleted ones keep their history without
 * blocking a new one), exactly as the partial unique indexes on the table do.
 */
async function assertLabelFree(kind: EligibilityItemKind, label: Bilingual, m: EntityManager, excludeId?: string): Promise<void> {
  if (await eligibilityItemRepository.findByLabel(kind, 'En', label.en, { excludeId, manager: m })) {
    throw AppError.conflict(`Another ${KIND_NAME[kind]} already has this name (English)`);
  }
  if (await eligibilityItemRepository.findByLabel(kind, 'Mr', label.mr, { excludeId, manager: m })) {
    throw AppError.conflict(`Another ${KIND_NAME[kind]} already has this name (Marathi)`);
  }
}

/*
 * Eligibility page content (CMS).
 *
 * The page text is a database-enforced singleton written by the migration, so it is read and
 * replaced but never created or deleted through the API. A missing row is a deployment problem (the
 * migration has not run), not something a request should silently repair — the admin read reports
 * it plainly and the public read degrades to null so the website shows its own copy.
 *
 * Each criterion and each document is an independent record with the usual master lifecycle —
 * create, edit, activate / deactivate, soft-delete, restore — and every write is audited. The
 * website reads only the active ones, in display order, through getPublic().
 *
 * Every rule here is also a database constraint (non-blank text, a value exactly for criteria, unique
 * labels within a kind among live rows, a non-negative order). The checks exist to return a readable
 * 4xx instead of a raw constraint error.
 */
export class EligibilityService {
  /* ---------------- page text ---------------- */

  async getSettings(): Promise<AdminEligibilitySettings> {
    const settings = await eligibilitySettingsRepository.findSettings();
    if (!settings) throw AppError.notFound(NOT_CONFIGURED);
    return toAdminSettings(settings);
  }

  async updateSettings(input: UpdateEligibilitySettingsInput, req?: Request): Promise<AdminEligibilitySettings> {
    await AppDataSource.transaction(async (m) => {
      const settings = await eligibilitySettingsRepository.findSettings(m);
      if (!settings) throw AppError.notFound(NOT_CONFIGURED);
      await eligibilitySettingsRepository.update(
        settings.id,
        {
          pageTitleMr: input.pageTitle.mr,
          pageTitleEn: input.pageTitle.en,
          pageSubtitleMr: input.pageSubtitle.mr,
          pageSubtitleEn: input.pageSubtitle.en,
          criteriaHeadingMr: input.criteriaHeading.mr,
          criteriaHeadingEn: input.criteriaHeading.en,
          documentsHeadingMr: input.documentsHeading.mr,
          documentsHeadingEn: input.documentsHeading.en,
          noteTitleMr: input.noteTitle.mr,
          noteTitleEn: input.noteTitle.en,
          noteBodyMr: input.noteBody.mr,
          noteBodyEn: input.noteBody.en,
        },
        m,
      );
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.ELIGIBILITY_SETTINGS_UPDATE,
        resource: 'eligibility-page',
        resourceId: settings.id,
        details: { from: { pageTitle: settings.pageTitleEn, noteTitle: settings.noteTitleEn }, to: { pageTitle: input.pageTitle.en } },
      });
    });
    return this.getSettings();
  }

  /*
   * What the website reads: the page text with the active criteria and documents, each in display
   * order. Returns null — not an error — when the page has never been configured, because "there is
   * nothing to show" is a normal state the site handles by rendering its own bundled copy. Empty
   * lists are a legitimate answer too — every row of that kind has been deactivated.
   */
  async getPublic(): Promise<PublicEligibilityPage | null> {
    const settings = await eligibilitySettingsRepository.findSettings();
    if (!settings) return null;

    const items = await eligibilityItemRepository.findPublished();
    return {
      ...toPageText(settings),
      criteria: items
        .filter((i) => i.kind === 'CRITERION')
        .map((i) => ({ label: { mr: i.labelMr, en: i.labelEn }, value: { mr: i.valueMr ?? '', en: i.valueEn ?? '' } })),
      documents: items.filter((i) => i.kind === 'DOCUMENT').map((i) => ({ mr: i.labelMr, en: i.labelEn })),
    };
  }

  /* ---------------- criteria and documents ---------------- */

  async list(q: EligibilityListQuery): Promise<Paginated<AdminEligibilityItem>> {
    const page = await eligibilityItemRepository.list(q);
    return { items: page.items.map(toAdminItem), meta: page.meta };
  }

  async get(id: string): Promise<AdminEligibilityItem> {
    const item = await eligibilityItemRepository.findById(id);
    if (!item) throw AppError.notFound(NOT_FOUND);
    return toAdminItem(item);
  }

  async create(input: CreateEligibilityItemInput, req?: Request): Promise<AdminEligibilityItem> {
    const value = input.value ?? null;
    assertValueFitsKind(input.kind, value);

    const id = await AppDataSource.transaction(async (m) => {
      await assertLabelFree(input.kind, input.label, m);
      const item = await eligibilityItemRepository.create(
        {
          kind: input.kind,
          labelMr: input.label.mr,
          labelEn: input.label.en,
          valueMr: value?.mr ?? null,
          valueEn: value?.en ?? null,
          displayOrder: input.displayOrder ?? (await eligibilityItemRepository.nextDisplayOrder(input.kind, m)),
          isActive: input.isActive ?? true,
        },
        m,
      );
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.ELIGIBILITY_ITEM_CREATE,
        resource: 'eligibility-item',
        resourceId: item.id,
        details: { kind: item.kind, label: item.labelEn, displayOrder: item.displayOrder, isActive: item.isActive },
      });
      return item.id;
    });
    return this.get(id);
  }

  /*
   * Edits the label, value and order. The kind stays as created; a value sent for a document, or a
   * criterion's value cleared with null, is refused with a 400 naming `value`.
   */
  async update(id: string, input: UpdateEligibilityItemInput, req?: Request): Promise<AdminEligibilityItem> {
    await AppDataSource.transaction(async (m) => {
      const item = await eligibilityItemRepository.findById(id, { manager: m });
      if (!item) throw AppError.notFound(NOT_FOUND);
      if (input.value !== undefined) assertValueFitsKind(item.kind, input.value);
      if (input.label) await assertLabelFree(item.kind, input.label, m, id);
      await eligibilityItemRepository.update(
        id,
        {
          ...(input.label ? { labelMr: input.label.mr, labelEn: input.label.en } : {}),
          ...(input.value ? { valueMr: input.value.mr, valueEn: input.value.en } : {}),
          ...(input.displayOrder === undefined ? {} : { displayOrder: input.displayOrder }),
        },
        m,
      );
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.ELIGIBILITY_ITEM_UPDATE,
        resource: 'eligibility-item',
        resourceId: id,
        details: { kind: item.kind, fields: Object.keys(input), from: { label: item.labelEn, displayOrder: item.displayOrder } },
      });
    });
    return this.get(id);
  }

  /* Deactivation hides the row from the website but keeps it here, ready to bring back. */
  async setStatus(id: string, isActive: boolean, req?: Request): Promise<AdminEligibilityItem> {
    await AppDataSource.transaction(async (m) => {
      const item = await eligibilityItemRepository.findById(id, { manager: m });
      if (!item) throw AppError.notFound(NOT_FOUND);
      await eligibilityItemRepository.update(id, { isActive }, m);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.ELIGIBILITY_ITEM_STATUS,
        resource: 'eligibility-item',
        resourceId: id,
        details: { kind: item.kind, isActive, label: item.labelEn },
      });
    });
    return this.get(id);
  }

  /* Soft-deletes the row: it leaves the website and the list, and stays in the table for audit. */
  async remove(id: string, req?: Request): Promise<void> {
    await AppDataSource.transaction(async (m) => {
      const item = await eligibilityItemRepository.findById(id, { manager: m });
      if (!item) throw AppError.notFound(NOT_FOUND);
      await eligibilityItemRepository.softDelete(id, m);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.ELIGIBILITY_ITEM_DELETE,
        resource: 'eligibility-item',
        resourceId: id,
        details: { kind: item.kind, label: item.labelEn },
      });
    });
  }

  /* Brings a soft-deleted row back, inactive. Refused when the same label has been added meanwhile. */
  async restore(id: string, req?: Request): Promise<AdminEligibilityItem> {
    await AppDataSource.transaction(async (m) => {
      const existing = await eligibilityItemRepository.findByIdIncludingDeleted(id, m);
      if (!existing) throw AppError.notFound(NOT_FOUND);
      if (!existing.isDelete) throw AppError.conflict('Eligibility item is not deleted');
      await assertLabelFree(existing.kind, { mr: existing.labelMr, en: existing.labelEn }, m);
      await eligibilityItemRepository.restore(id, m);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.ELIGIBILITY_ITEM_RESTORE,
        resource: 'eligibility-item',
        resourceId: id,
        details: { kind: existing.kind, label: existing.labelEn },
      });
    });
    return this.get(id);
  }
}

export const eligibilityService = new EligibilityService();
