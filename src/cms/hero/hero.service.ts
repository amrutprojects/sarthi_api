import type { Request } from 'express';
import { AppDataSource } from '../../config/database.config';
import { AUDIT_ACTIONS } from '../../shared/constants/app.constants';
import { auditService } from '../../modules/audit/audit.service';
import { AppError } from '../../shared/errors/app-error';
import { modulesRepository } from '../modules/modules.repository';
import { heroRepository } from './hero.repository';
import type { HomeHeroSlide } from './hero.model';
import type { AdminHomeHero, HeroGlance, PublicHomeHero, UpdateHomeHeroInput } from './hero.types';

const NOT_CONFIGURED = 'The home hero section has not been configured yet. Run the database seed to create it.';

const PROGRAMME_NOT_CONFIGURED = 'The programme content has not been configured yet. Run the database seed to create it.';

const STALE = 'The home hero section was changed after you opened it. Reload to see the latest version, then make your changes again.';

/* The words of one slide, shared by the admin and public projections. */
const slideText = (s: HomeHeroSlide) => ({
  tag: { mr: s.tagMr, en: s.tagEn },
  title: { mr: s.titleMr, en: s.titleEn },
  description: { mr: s.descriptionMr, en: s.descriptionEn },
  ctaLabel: { mr: s.ctaLabelMr, en: s.ctaLabelEn },
  ctaLink: s.ctaLink,
});

/*
 * The home page's hero banner (CMS).
 *
 * A singleton enforced by the database, so there is no create endpoint: the row is written once by
 * the seed and edited thereafter. A missing row is a deployment problem, not something a request
 * should silently repair — the admin read reports it plainly and the public read degrades to
 * "nothing published" so the website shows its own bundled copy.
 *
 * The admin shape also carries the "Programme at a glance" card beside the slides, because an
 * administrator edits the whole banner on one screen. That card owns no table: three of its figures
 * are summed from the modules and the fourth, the district count, is stored with the Modules page
 * content — so it is read and written through modulesRepository, and this section is its only
 * writer. The website reads those figures from /public/modules, not from /public/hero.
 */
export class HeroService {
  async getForAdmin(): Promise<AdminHomeHero> {
    const settings = await heroRepository.findSettings();
    if (!settings) throw AppError.notFound(NOT_CONFIGURED);

    const slides = await heroRepository.findSlides(settings.id);
    return {
      id: settings.id,
      readMoreLabel: { mr: settings.readMoreLabelMr, en: settings.readMoreLabelEn },
      checkStatusLabel: { mr: settings.checkStatusLabelMr, en: settings.checkStatusLabelEn },
      slides: slides.map((s) => ({
        id: s.id,
        ...slideText(s),
        displayOrder: s.displayOrder,
        isActive: s.isActive,
      })),
      glance: await this.glance(),
      isPublished: settings.isPublished,
      showGlance: settings.showGlance,
      createdAt: settings.createdAt,
      updatedAt: settings.updatedAt,
    };
  }

  /*
   * The "Programme at a glance" figures, computed the way the website computes them from
   * /public/modules — which is what keeps the two identical. null, not an error, while the Modules
   * page content has not been configured: the slides are still editable without it.
   */
  private async glance(): Promise<HeroGlance | null> {
    const programme = await modulesRepository.findSettings();
    if (!programme) return null;

    const all = await modulesRepository.findModules(programme.id);
    /* Only active modules reach the website, so only those count towards what it prints. */
    const live = all.filter((m) => m.isActive);
    const domains = await modulesRepository.findElectives(
      live.map((m) => m.id),
      { activeOnly: true },
    );

    const hours = live.map((m) => m.moduleHours);
    const uniform = hours.length > 0 && hours.every((h) => h === hours[0]);

    return {
      totalHours: hours.reduce((a, b) => a + b, 0),
      modules: live.length,
      domains: new Set(domains.map((d) => d.no)).size,
      districtCount: programme.districtCount,
      modulesLabel: uniform ? `${live.length} × ${hours[0]} hours` : String(live.length),
      hiddenModules: all.length - live.length,
    };
  }

  /*
   * What the website reads. Returns null — not an error — only when the section has never been
   * configured, a normal state the site handles by rendering its own bundled copy. An unpublished
   * banner is NOT null: it comes back with `showSection: false` and no slides, so the site hides it
   * rather than falling back to that bundled copy. `showGlance` travels here, not with the card's
   * figures in /public/modules, because it is this section's switch.
   */
  async getPublic(): Promise<PublicHomeHero | null> {
    const settings = await heroRepository.findSettings();
    if (!settings || !settings.isActive) return null;

    const slides = settings.isPublished ? await heroRepository.findSlides(settings.id, { activeOnly: true }) : [];
    return {
      showSection: settings.isPublished,
      showGlance: settings.showGlance,
      readMoreLabel: { mr: settings.readMoreLabelMr, en: settings.readMoreLabelEn },
      checkStatusLabel: { mr: settings.checkStatusLabelMr, en: settings.checkStatusLabelEn },
      slides: slides.map(slideText),
    };
  }

  /*
   * Replaces the whole section in one transaction, so the banner is never served half-updated.
   *
   * The slides are rewritten wholesale rather than merged: merging two lists row by row would leave
   * an administrator unable to remove one, and the list is short.
   *
   * `expectedUpdatedAt` is the version the admin screen loaded. The row is locked before it is
   * compared, so a concurrent save cannot slip in between the check and the write; a mismatch
   * means someone else saved first, and their work is kept rather than silently overwritten.
   *
   * `districtCount`, when sent, is written to the Modules page content in the same transaction, so
   * a missing configuration there refuses the whole save rather than half of it. The lock on the
   * hero row covers it too: this is the only screen that writes it.
   */
  async update(input: UpdateHomeHeroInput, req?: Request): Promise<AdminHomeHero> {
    await AppDataSource.transaction(async (m) => {
      const settings = await heroRepository.findSettingsForUpdate(m);
      if (!settings) throw AppError.notFound(NOT_CONFIGURED);
      if (input.expectedUpdatedAt !== undefined && new Date(input.expectedUpdatedAt).getTime() !== settings.updatedAt.getTime()) {
        throw AppError.conflict(STALE);
      }

      if (input.districtCount !== undefined) {
        const programme = await modulesRepository.findSettings(m);
        if (!programme) throw AppError.notFound(PROGRAMME_NOT_CONFIGURED);
        await modulesRepository.update(programme.id, { districtCount: input.districtCount }, m);
      }

      await heroRepository.update(
        settings.id,
        {
          readMoreLabelMr: input.readMoreLabel.mr,
          readMoreLabelEn: input.readMoreLabel.en,
          checkStatusLabelMr: input.checkStatusLabel.mr,
          checkStatusLabelEn: input.checkStatusLabel.en,
          ...(input.isPublished === undefined ? {} : { isPublished: input.isPublished }),
        },
        m,
      );

      const repo = heroRepository.slides(m);
      /* Only the live slides: rows retired by earlier saves stay exactly as they were. */
      await repo.update({ heroId: settings.id, isDelete: false }, { isDelete: true, isActive: false });
      for (const [order, s] of input.slides.entries()) {
        await repo.insert({
          heroId: settings.id,
          tagMr: s.tag.mr,
          tagEn: s.tag.en,
          titleMr: s.title.mr,
          titleEn: s.title.en,
          descriptionMr: s.description.mr,
          descriptionEn: s.description.en,
          ctaLabelMr: s.ctaLabel.mr,
          ctaLabelEn: s.ctaLabel.en,
          ctaLink: s.ctaLink,
          displayOrder: s.displayOrder ?? order,
          isActive: s.isActive ?? true,
        });
      }

      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.HERO_UPDATE,
        resource: 'home-hero',
        resourceId: settings.id,
        details: {
          isPublished: input.isPublished ?? settings.isPublished,
          slides: input.slides.length,
          ...(input.districtCount === undefined ? {} : { districtCount: input.districtCount }),
        },
      });
    });

    return this.getForAdmin();
  }

  async setPublished(isPublished: boolean, req?: Request): Promise<AdminHomeHero> {
    await AppDataSource.transaction(async (m) => {
      const settings = await heroRepository.findSettings(m);
      if (!settings) throw AppError.notFound(NOT_CONFIGURED);

      await heroRepository.update(settings.id, { isPublished }, m);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.HERO_STATUS,
        resource: 'home-hero',
        resourceId: settings.id,
        details: { isPublished },
      });
    });
    return this.getForAdmin();
  }
}

export const heroService = new HeroService();
