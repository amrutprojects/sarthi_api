import type { Request } from 'express';
import { AppDataSource } from '../../config/database.config';
import { auditService } from '../../modules/audit/audit.service';
import { AUDIT_ACTIONS } from '../../shared/constants/app.constants';
import { AppError } from '../../shared/errors/app-error';
import type { BrandBarSettings } from './brandbar.model';
import { brandBarSettingsRepository } from './brandbar.repository';
import type { AdminBrandBar, Bilingual, PublicBrandBar, UpdateBrandBarInput } from './brandbar.types';

const NOT_CONFIGURED = 'The Brand Bar has not been configured yet. Run the database seed to create it.';
const STALE = 'The Brand Bar was changed after you opened it. Reload to see the latest version, then make your changes again.';

const pair = (mr: string, en: string): Bilingual => ({ mr, en });
const isStale = (expected: string | undefined, actual: Date) => expected !== undefined && new Date(expected).getTime() !== actual.getTime();

const toAdmin = (s: BrandBarSettings): AdminBrandBar => ({
  id: s.id,
  title: s.title,
  fullName: pair(s.fullNameMr, s.fullNameEn),
  partnerLabel: pair(s.partnerLabelMr, s.partnerLabelEn),
  partnerName: s.partnerName,
  showPartner: s.showPartner,
  showSection: s.showSection,
  createdAt: s.createdAt,
  updatedAt: s.updatedAt,
});

/*
 * The partner label is blank in both languages or filled in both (database CHECK), so one half decides.
 * A switched-off partner box is sent as no partner at all, so the website is never sent a box it must
 * not show; its label and name stay in the admin view.
 */
const toPublic = (s: BrandBarSettings): PublicBrandBar => ({
  showSection: s.showSection,
  title: s.title,
  fullName: pair(s.fullNameMr, s.fullNameEn),
  partner:
    s.showPartner && s.partnerName
      ? { label: s.partnerLabelMr ? pair(s.partnerLabelMr, s.partnerLabelEn) : null, name: s.partnerName }
      : null,
});

/*
 * Brand Bar (CMS): the bar under the Top Bar on every website page — the programme's title, the
 * organisation's full name in Marathi and English, and the implementation partner.
 */
export class BrandBarService {
  async get(): Promise<AdminBrandBar> {
    const s = await brandBarSettingsRepository.find();
    if (!s) throw AppError.notFound(NOT_CONFIGURED);
    return toAdmin(s);
  }

  /*
   * Replaces the Brand Bar. `expectedUpdatedAt` is the version the admin screen loaded; a mismatch
   * means someone else saved first, and their work is kept rather than silently overwritten.
   * `showPartner` is the one optional key: absent, the partner box stays as it is.
   */
  async update(input: UpdateBrandBarInput, req?: Request): Promise<AdminBrandBar> {
    await AppDataSource.transaction(async (m) => {
      const s = await brandBarSettingsRepository.findForUpdate(m);
      if (!s) throw AppError.notFound(NOT_CONFIGURED);
      if (isStale(input.expectedUpdatedAt, s.updatedAt)) throw AppError.conflict(STALE);
      const showPartner = input.showPartner ?? s.showPartner;
      await brandBarSettingsRepository.updateWhere(
        { id: s.id },
        {
          title: input.title,
          fullNameMr: input.fullName.mr,
          fullNameEn: input.fullName.en,
          partnerLabelMr: input.partnerLabel.mr,
          partnerLabelEn: input.partnerLabel.en,
          partnerName: input.partnerName,
          showPartner,
        },
        m,
      );
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.BRANDBAR_UPDATE,
        resource: 'brand-bar',
        resourceId: s.id,
        details: { title: input.title, partnerName: input.partnerName, showPartner },
      });
    });
    return this.get();
  }

  /*
   * What the website reads. Null — not an error — when the Brand Bar has never been configured, so
   * the site keeps its own bundled bar. A hidden bar comes back with `showSection: false`, never as
   * null, so the site leaves it out instead of falling back.
   */
  async getPublic(): Promise<PublicBrandBar | null> {
    const s = await brandBarSettingsRepository.find();
    if (!s || !s.isActive) return null;
    return toPublic(s);
  }
}

export const brandBarService = new BrandBarService();
