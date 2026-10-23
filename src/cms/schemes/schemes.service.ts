import type { Request } from 'express';
import type { EntityManager } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { AppDataSource } from '../../config/database.config';
import { auditService } from '../../modules/audit/audit.service';
import { AUDIT_ACTIONS } from '../../shared/constants/app.constants';
import { AppError } from '../../shared/errors/app-error';
import type { AmrutScheme, AmrutSchemesSection } from './schemes.model';
import { amrutSchemeRepository, amrutSchemesSectionRepository } from './schemes.repository';
import type {
  AdminScheme,
  AdminSchemesSection,
  Bilingual,
  CreateSchemeInput,
  PublicSchemesSection,
  UpdateSchemeInput,
  UpdateSchemesSectionInput,
} from './schemes.types';

const NOT_FOUND = 'Scheme not found';
const NOT_CONFIGURED = 'The AMRUT Schemes section has not been configured yet. Run the database seed to create it.';
const STALE_SCHEME = 'This scheme was changed after you opened it. Reload to see the latest version, then make your changes again.';
const STALE_SECTION =
  'The section settings were changed after you opened them. Reload to see the latest version, then make your changes again.';
const STALE_ORDER = 'The scheme list changed after you loaded it. Reload the list, then reorder again.';

const pair = (mr: string, en: string): Bilingual => ({ mr, en });
const isStale = (expected: string | undefined, actual: Date) => expected !== undefined && new Date(expected).getTime() !== actual.getTime();

const toAdmin = (s: AmrutScheme): AdminScheme => ({
  id: s.id,
  title: pair(s.titleMr, s.titleEn),
  description: pair(s.descriptionMr, s.descriptionEn),
  badge: pair(s.badgeMr, s.badgeEn),
  deadline: s.deadline,
  link: s.link,
  buttonLabel: pair(s.buttonLabelMr, s.buttonLabelEn),
  featured: s.featured,
  displayOrder: s.displayOrder,
  isActive: s.isActive,
  createdAt: s.createdAt,
  updatedAt: s.updatedAt,
});

const toAdminSection = (s: AmrutSchemesSection): AdminSchemesSection => ({
  id: s.id,
  heading: pair(s.headingMr, s.headingEn),
  subtitle: pair(s.subtitleMr, s.subtitleEn),
  buttonLabel: pair(s.buttonLabelMr, s.buttonLabelEn),
  showSection: s.showSection,
  createdAt: s.createdAt,
  updatedAt: s.updatedAt,
});

/* The scheme columns an input touches. Keys the input leaves out are not in the result at all. */
function schemeColumns(input: Partial<CreateSchemeInput>): QueryDeepPartialEntity<AmrutScheme> {
  const out: QueryDeepPartialEntity<AmrutScheme> = {};
  if (input.title) Object.assign(out, { titleMr: input.title.mr, titleEn: input.title.en });
  if (input.description) Object.assign(out, { descriptionMr: input.description.mr, descriptionEn: input.description.en });
  if (input.badge) Object.assign(out, { badgeMr: input.badge.mr, badgeEn: input.badge.en });
  if (input.deadline !== undefined) out.deadline = input.deadline;
  if (input.link !== undefined) out.link = input.link;
  if (input.buttonLabel) Object.assign(out, { buttonLabelMr: input.buttonLabel.mr, buttonLabelEn: input.buttonLabel.en });
  if (input.featured !== undefined) out.featured = input.featured;
  if (input.displayOrder !== undefined) out.displayOrder = input.displayOrder;
  if (input.isActive !== undefined) out.isActive = input.isActive;
  return out;
}

/*
 * AMRUT Schemes (CMS): the अमृत योजना विभाग cards and the section's own heading, subtitle, default
 * button label and visibility.
 *
 * Schemes are soft-deleted, like every record here; nothing else references them. Nothing here acts
 * on a deadline passing — an expired scheme stays exactly as it is until an administrator changes it.
 */
export class SchemesService {
  async listForAdmin(): Promise<AdminScheme[]> {
    return (await amrutSchemeRepository.list()).map(toAdmin);
  }

  async getForAdmin(id: string): Promise<AdminScheme> {
    const s = await amrutSchemeRepository.findById(id);
    if (!s) throw AppError.notFound(NOT_FOUND);
    return toAdmin(s);
  }

  async create(input: CreateSchemeInput, req?: Request): Promise<AdminScheme> {
    const id = await AppDataSource.transaction(async (m) => {
      await this.assertUniqueTitle(input.title, undefined, m);
      const created = await amrutSchemeRepository.create(
        {
          titleMr: input.title.mr,
          titleEn: input.title.en,
          descriptionMr: input.description.mr,
          descriptionEn: input.description.en,
          badgeMr: input.badge?.mr ?? '',
          badgeEn: input.badge?.en ?? '',
          deadline: input.deadline ?? null,
          link: input.link ?? null,
          buttonLabelMr: input.buttonLabel?.mr ?? '',
          buttonLabelEn: input.buttonLabel?.en ?? '',
          featured: input.featured ?? false,
          /* A new scheme goes to the end of the grid unless an order is given. */
          displayOrder: input.displayOrder ?? (await amrutSchemeRepository.maxOrder(m)) + 1,
          isActive: input.isActive ?? true,
        },
        m,
      );
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.SCHEME_CREATE,
        resource: 'amrut-scheme',
        resourceId: created.id,
        details: { title: created.titleEn, deadline: created.deadline, link: created.link, isActive: created.isActive },
      });
      return created.id;
    });
    return this.getForAdmin(id);
  }

  /*
   * A partial update. `expectedUpdatedAt` is the version the admin screen loaded; a mismatch means
   * someone else saved first, and their work is kept rather than silently overwritten.
   */
  async update(id: string, input: UpdateSchemeInput, req?: Request): Promise<AdminScheme> {
    await AppDataSource.transaction(async (m) => {
      const current = await amrutSchemeRepository.findForUpdate(id, m);
      if (!current) throw AppError.notFound(NOT_FOUND);
      if (isStale(input.expectedUpdatedAt, current.updatedAt)) throw AppError.conflict(STALE_SCHEME);
      if (input.title) await this.assertUniqueTitle(input.title, id, m);

      const changes = schemeColumns(input);
      if (Object.keys(changes).length) await amrutSchemeRepository.updateWhere({ id }, changes, m);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.SCHEME_UPDATE,
        resource: 'amrut-scheme',
        resourceId: id,
        details: { fields: Object.keys(changes) },
      });
    });
    return this.getForAdmin(id);
  }

  async setActive(id: string, isActive: boolean, req?: Request): Promise<AdminScheme> {
    await AppDataSource.transaction(async (m) => {
      if (!(await amrutSchemeRepository.findForUpdate(id, m))) throw AppError.notFound(NOT_FOUND);
      await amrutSchemeRepository.updateWhere({ id }, { isActive }, m);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.SCHEME_STATUS,
        resource: 'amrut-scheme',
        resourceId: id,
        details: { isActive },
      });
    });
    return this.getForAdmin(id);
  }

  async remove(id: string, req?: Request): Promise<void> {
    await AppDataSource.transaction(async (m) => {
      const current = await amrutSchemeRepository.findForUpdate(id, m);
      if (!current) throw AppError.notFound(NOT_FOUND);
      await amrutSchemeRepository.softDelete(id, m);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.SCHEME_DELETE,
        resource: 'amrut-scheme',
        resourceId: id,
        details: { title: current.titleEn, deadline: current.deadline, link: current.link },
      });
    });
  }

  /*
   * Rewrites the display order from a full list of ids, in one transaction. The list must name every
   * scheme exactly once: anything else means the screen is out of date, and guessing where the
   * missing schemes go would move the wrong one.
   */
  async reorder(ids: string[], req?: Request): Promise<AdminScheme[]> {
    await AppDataSource.transaction(async (m) => {
      const all = await amrutSchemeRepository.lockAll(m);
      const byId = new Map(all.map((r) => [r.id, r]));
      if (ids.length !== all.length || ids.some((id) => !byId.has(id))) throw AppError.conflict(STALE_ORDER);
      for (const [index, id] of ids.entries()) {
        if (byId.get(id)!.displayOrder !== index + 1) await amrutSchemeRepository.updateWhere({ id }, { displayOrder: index + 1 }, m);
      }
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.SCHEMES_REORDER,
        resource: 'amrut-scheme',
        details: { order: ids },
      });
    });
    return this.listForAdmin();
  }

  async getSection(): Promise<AdminSchemesSection> {
    const s = await amrutSchemesSectionRepository.find();
    if (!s) throw AppError.notFound(NOT_CONFIGURED);
    return toAdminSection(s);
  }

  async updateSection(input: UpdateSchemesSectionInput, req?: Request): Promise<AdminSchemesSection> {
    await AppDataSource.transaction(async (m) => {
      const s = await amrutSchemesSectionRepository.findForUpdate(m);
      if (!s) throw AppError.notFound(NOT_CONFIGURED);
      if (isStale(input.expectedUpdatedAt, s.updatedAt)) throw AppError.conflict(STALE_SECTION);
      await amrutSchemesSectionRepository.updateWhere(
        { id: s.id },
        {
          headingMr: input.heading.mr,
          headingEn: input.heading.en,
          subtitleMr: input.subtitle.mr,
          subtitleEn: input.subtitle.en,
          buttonLabelMr: input.buttonLabel.mr,
          buttonLabelEn: input.buttonLabel.en,
          showSection: input.showSection,
        },
        m,
      );
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.SCHEMES_SECTION_UPDATE,
        resource: 'amrut-schemes-section',
        resourceId: s.id,
        details: { showSection: input.showSection },
      });
    });
    return this.getSection();
  }

  /*
   * What the website reads. Null — not an error — when the section has never been configured. A
   * hidden section comes back with `showSection: false` and no schemes, so the site can leave it out.
   */
  async getPublic(): Promise<PublicSchemesSection | null> {
    const s = await amrutSchemesSectionRepository.find();
    if (!s || !s.isActive) return null;
    const defaultLabel = pair(s.buttonLabelMr, s.buttonLabelEn);
    const schemes = s.showSection ? await amrutSchemeRepository.list({ activeOnly: true }) : [];
    return {
      heading: pair(s.headingMr, s.headingEn),
      subtitle: s.subtitleMr ? pair(s.subtitleMr, s.subtitleEn) : null,
      showSection: s.showSection,
      /* Badge and button label are blank in both languages or filled in both (database CHECK), so one half decides. */
      schemes: schemes.map((x) => ({
        id: x.id,
        title: pair(x.titleMr, x.titleEn),
        description: pair(x.descriptionMr, x.descriptionEn),
        badge: x.badgeMr ? pair(x.badgeMr, x.badgeEn) : null,
        deadline: x.deadline,
        link: x.link,
        buttonLabel: x.buttonLabelMr ? pair(x.buttonLabelMr, x.buttonLabelEn) : defaultLabel,
        featured: x.featured,
      })),
    };
  }

  private async assertUniqueTitle(title: Bilingual, exceptId: string | undefined, manager: EntityManager): Promise<void> {
    const clash = await amrutSchemeRepository.findByTitle(title, exceptId, manager);
    if (clash) throw AppError.conflict(`A scheme titled "${clash.titleMr}" / "${clash.titleEn}" already exists.`);
  }
}

export const schemesService = new SchemesService();
