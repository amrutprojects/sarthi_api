import type { Request } from 'express';
import { AppDataSource } from '../../config/database.config';
import { AUDIT_ACTIONS } from '../../shared/constants/app.constants';
import { auditService } from '../../modules/audit/audit.service';
import { AppError } from '../../shared/errors/app-error';
import {
  HIGHLIGHT_ROW_KEYS,
  type HighlightRowKey,
  type HighlightRowLabels,
  type ProgrammeHighlight,
} from './highlight.model';
import { highlightRepository } from './highlight.repository';
import type {
  AdminProgrammeHighlight,
  HighlightRowChange,
  PublicProgrammeHighlight,
  UpdateProgrammeHighlightInput,
} from './highlight.types';

const NOT_CONFIGURED =
  'The home programme section has not been configured yet. Run the database seed to create it.';

/* Known keys only, once each, in display order, whatever order the column holds them in. */
const orderedHidden = (hidden: readonly string[]): HighlightRowKey[] =>
  HIGHLIGHT_ROW_KEYS.filter((k) => hidden.includes(k));

/*
 * The custom row names: known keys only, in display order, each with both languages filled in. Anything else in
 * the column (an unknown key, a half or malformed name) reads as the default name.
 */
const knownLabels = (raw: unknown): HighlightRowLabels => {
  const out: HighlightRowLabels = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const key of HIGHLIGHT_ROW_KEYS) {
    const l: unknown = (raw as Record<string, unknown>)[key];
    if (!l || typeof l !== 'object') continue;
    const { mr, en } = l as { mr?: unknown; en?: unknown };
    if (typeof mr === 'string' && typeof en === 'string' && mr.trim() && en.trim()) out[key] = { mr, en };
  }
  return out;
};

/*
 * The home page's programme section (CMS).
 *
 * A singleton enforced by the database, so there is no create endpoint: the row is written once by
 * the seed and edited thereafter. A missing row is a deployment problem, not something a request
 * should silently repair — the admin read reports it plainly and the public read degrades to
 * "nothing published" so the website shows its own bundled copy.
 */
export class HighlightService {
  async getForAdmin(): Promise<AdminProgrammeHighlight> {
    const settings = await highlightRepository.findSettings();
    if (!settings) throw AppError.notFound(NOT_CONFIGURED);

    const objectives = await highlightRepository.findObjectives(settings.id);
    return {
      id: settings.id,
      heading: { mr: settings.headingMr, en: settings.headingEn },
      subheading: { mr: settings.subheadingMr, en: settings.subheadingEn },
      tagline: { mr: settings.taglineMr, en: settings.taglineEn },
      certification: { mr: settings.certificationMr, en: settings.certificationEn },
      objectives: objectives.map((o) => ({
        id: o.id,
        text: { mr: o.textMr, en: o.textEn },
        displayOrder: o.displayOrder,
        isActive: o.isActive,
      })),
      hiddenRows: orderedHidden(settings.hiddenRows),
      rowLabels: knownLabels(settings.rowLabels),
      isPublished: settings.isPublished,
      createdAt: settings.createdAt,
      updatedAt: settings.updatedAt,
    };
  }

  /*
   * What the website reads. Returns null — not an error — only when the section has never been
   * configured, a normal state the site handles by rendering its own bundled copy. An unpublished
   * band is NOT null: it comes back with `showSection: false` and no objectives, so the site hides
   * it rather than falling back to that bundled copy.
   */
  async getPublic(): Promise<PublicProgrammeHighlight | null> {
    const settings = await highlightRepository.findSettings();
    if (!settings || !settings.isActive) return null;

    const objectives = settings.isPublished
      ? await highlightRepository.findObjectives(settings.id, { activeOnly: true })
      : [];
    return {
      showSection: settings.isPublished,
      heading: { mr: settings.headingMr, en: settings.headingEn },
      subheading: { mr: settings.subheadingMr, en: settings.subheadingEn },
      tagline: { mr: settings.taglineMr, en: settings.taglineEn },
      certification: { mr: settings.certificationMr, en: settings.certificationEn },
      objectives: objectives.map((o) => ({ mr: o.textMr, en: o.textEn })),
      hiddenRows: orderedHidden(settings.hiddenRows),
      rowLabels: knownLabels(settings.rowLabels),
    };
  }

  /*
   * Replaces the whole section in one transaction, so the page is never served half-updated.
   *
   * The objectives are rewritten wholesale rather than merged: merging two lists row by row would
   * leave an administrator unable to remove one, and the list is short.
   */
  async update(
    input: UpdateProgrammeHighlightInput,
    req?: Request,
  ): Promise<AdminProgrammeHighlight> {
    await AppDataSource.transaction(async (m) => {
      const settings = await highlightRepository.findSettings(m);
      if (!settings) throw AppError.notFound(NOT_CONFIGURED);

      await highlightRepository.update(
        settings.id,
        {
          headingMr: input.heading.mr,
          headingEn: input.heading.en,
          subheadingMr: input.subheading.mr,
          subheadingEn: input.subheading.en,
          taglineMr: input.tagline.mr,
          taglineEn: input.tagline.en,
          certificationMr: input.certification.mr,
          certificationEn: input.certification.en,
          ...(input.isPublished === undefined ? {} : { isPublished: input.isPublished }),
        },
        m,
      );

      const repo = highlightRepository.objectives(m);
      await repo.update({ highlightId: settings.id }, { isDelete: true, isActive: false });
      for (const [order, o] of input.objectives.entries()) {
        await repo.insert({
          highlightId: settings.id,
          textMr: o.text.mr,
          textEn: o.text.en,
          displayOrder: o.displayOrder ?? order,
          isActive: o.isActive ?? true,
        });
      }

      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.HIGHLIGHT_UPDATE,
        resource: 'programme-highlight',
        resourceId: settings.id,
        details: {
          isPublished: input.isPublished ?? settings.isPublished,
          objectives: input.objectives.length,
        },
      });
    });

    return this.getForAdmin();
  }

  async setPublished(isPublished: boolean, req?: Request): Promise<AdminProgrammeHighlight> {
    await AppDataSource.transaction(async (m) => {
      const settings = await highlightRepository.findSettings(m);
      if (!settings) throw AppError.notFound(NOT_CONFIGURED);

      await highlightRepository.update(settings.id, { isPublished }, m);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.HIGHLIGHT_STATUS,
        resource: 'programme-highlight',
        resourceId: settings.id,
        details: { isPublished },
      });
    });
    return this.getForAdmin();
  }

  /*
   * Shows, hides and/or renames one fact table row, in one transaction with its audit entry; what the change
   * leaves out stays as it is. The row is locked first, so two changes made at once cannot overwrite each other's
   * edit of the list or the names. Only "hiddenRows" and "rowLabels" are written, so nothing else can change here.
   * A name blank in both languages (or null) removes the custom name: the website's default name. Setting the
   * current values writes nothing but is still audited, as the administrator's action it was.
   */
  async setRow(
    key: HighlightRowKey,
    change: HighlightRowChange,
    req?: Request,
  ): Promise<AdminProgrammeHighlight> {
    const label =
      change.label === undefined ? undefined : change.label?.mr && change.label.en ? change.label : null;
    await AppDataSource.transaction(async (m) => {
      const settings = await highlightRepository.findSettings(m, { lock: true });
      if (!settings) throw AppError.notFound(NOT_CONFIGURED);

      const patch: Pick<Partial<ProgrammeHighlight>, 'hiddenRows' | 'rowLabels'> = {};
      if (change.show !== undefined) {
        const hide = !change.show;
        if (settings.hiddenRows.includes(key) !== hide)
          patch.hiddenRows = HIGHLIGHT_ROW_KEYS.filter((k) => (k === key ? hide : settings.hiddenRows.includes(k)));
      }
      if (label !== undefined) {
        const labels = knownLabels(settings.rowLabels);
        const now = labels[key];
        if (now?.mr !== label?.mr || now?.en !== label?.en) {
          const next: HighlightRowLabels = {};
          for (const k of HIGHLIGHT_ROW_KEYS) {
            const l = k === key ? label : labels[k];
            if (l) next[k] = { mr: l.mr, en: l.en };
          }
          patch.rowLabels = next;
        }
      }
      if (patch.hiddenRows || patch.rowLabels) await highlightRepository.update(settings.id, patch, m);

      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.HIGHLIGHT_ROW_VISIBILITY,
        resource: 'programme-highlight',
        resourceId: settings.id,
        details: {
          key,
          ...(change.show !== undefined && { show: change.show }),
          ...(label !== undefined && { label }),
        },
      });
    });
    return this.getForAdmin();
  }
}

export const highlightService = new HighlightService();
