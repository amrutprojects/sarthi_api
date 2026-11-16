import type { Request } from 'express';
import { AppDataSource } from '../../config/database.config';
import { AUDIT_ACTIONS } from '../../shared/constants/app.constants';
import { auditService } from '../../modules/audit/audit.service';
import { AppError } from '../../shared/errors/app-error';
import { highlightRepository } from './highlight.repository';
import type {
  AdminProgrammeHighlight,
  PublicProgrammeHighlight,
  UpdateProgrammeHighlightInput,
} from './highlight.types';

const NOT_CONFIGURED =
  'The home programme section has not been configured yet. Run the database seed to create it.';

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
}

export const highlightService = new HighlightService();
