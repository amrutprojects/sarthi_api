import type { Request } from 'express';
import type { EntityManager } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { AppDataSource } from '../../config/database.config';
import { auditService } from '../../modules/audit/audit.service';
import { AUDIT_ACTIONS } from '../../shared/constants/app.constants';
import { AppError } from '../../shared/errors/app-error';
import type { EcosystemProgramme, EcosystemSection } from './ecosystem.model';
import { ecosystemProgrammeRepository, ecosystemSectionRepository } from './ecosystem.repository';
import type {
  AdminEcosystemProgramme,
  AdminEcosystemSection,
  Bilingual,
  CreateProgrammeInput,
  PublicEcosystemSection,
  UpdateEcosystemSectionInput,
  UpdateProgrammeInput,
} from './ecosystem.types';

const NOT_FOUND = 'Programme not found';
const NOT_CONFIGURED = 'The AMRUT Ecosystem section has not been configured yet. Run the database seed to create it.';
const STALE_PROGRAMME = 'This programme was changed after you opened it. Reload to see the latest version, then make your changes again.';
const STALE_SECTION =
  'The section settings were changed after you opened them. Reload to see the latest version, then make your changes again.';
const STALE_ORDER = 'The programme list changed after you loaded it. Reload the list, then reorder again.';

const pair = (mr: string, en: string): Bilingual => ({ mr, en });
const isStale = (expected: string | undefined, actual: Date) => expected !== undefined && new Date(expected).getTime() !== actual.getTime();

const toAdmin = (p: EcosystemProgramme): AdminEcosystemProgramme => ({
  id: p.id,
  name: pair(p.nameMr, p.nameEn),
  description: pair(p.descriptionMr, p.descriptionEn),
  icon: p.icon,
  link: p.link,
  linkLabel: pair(p.linkLabelMr, p.linkLabelEn),
  displayOrder: p.displayOrder,
  isActive: p.isActive,
  createdAt: p.createdAt,
  updatedAt: p.updatedAt,
});

const toAdminSection = (s: EcosystemSection): AdminEcosystemSection => ({
  id: s.id,
  heading: pair(s.headingMr, s.headingEn),
  subtitle: pair(s.subtitleMr, s.subtitleEn),
  linkLabel: pair(s.linkLabelMr, s.linkLabelEn),
  showSection: s.showSection,
  createdAt: s.createdAt,
  updatedAt: s.updatedAt,
});

/* The card columns an input touches. Keys the input leaves out are not in the result at all. */
function programmeColumns(input: Partial<CreateProgrammeInput>): QueryDeepPartialEntity<EcosystemProgramme> {
  const out: QueryDeepPartialEntity<EcosystemProgramme> = {};
  if (input.name) Object.assign(out, { nameMr: input.name.mr, nameEn: input.name.en });
  if (input.description) Object.assign(out, { descriptionMr: input.description.mr, descriptionEn: input.description.en });
  if (input.icon !== undefined) out.icon = input.icon;
  if (input.link !== undefined) out.link = input.link;
  if (input.linkLabel) Object.assign(out, { linkLabelMr: input.linkLabel.mr, linkLabelEn: input.linkLabel.en });
  if (input.displayOrder !== undefined) out.displayOrder = input.displayOrder;
  if (input.isActive !== undefined) out.isActive = input.isActive;
  return out;
}

/*
 * The AMRUT Ecosystem (CMS): the अमृत प्रणाली cards and the section's own heading, subtitle, default
 * link label and visibility.
 *
 * Cards are soft-deleted, like every record here; nothing else references them.
 */
export class EcosystemService {
  async listForAdmin(): Promise<AdminEcosystemProgramme[]> {
    return (await ecosystemProgrammeRepository.list()).map(toAdmin);
  }

  async getForAdmin(id: string): Promise<AdminEcosystemProgramme> {
    const p = await ecosystemProgrammeRepository.findById(id);
    if (!p) throw AppError.notFound(NOT_FOUND);
    return toAdmin(p);
  }

  async create(input: CreateProgrammeInput, req?: Request): Promise<AdminEcosystemProgramme> {
    const id = await AppDataSource.transaction(async (m) => {
      await this.assertUniqueName(input.name, undefined, m);
      const created = await ecosystemProgrammeRepository.create(
        {
          nameMr: input.name.mr,
          nameEn: input.name.en,
          descriptionMr: input.description.mr,
          descriptionEn: input.description.en,
          icon: input.icon,
          link: input.link ?? null,
          linkLabelMr: input.linkLabel?.mr ?? '',
          linkLabelEn: input.linkLabel?.en ?? '',
          /* A new card goes to the end of the grid unless an order is given. */
          displayOrder: input.displayOrder ?? (await ecosystemProgrammeRepository.maxOrder(m)) + 1,
          isActive: input.isActive ?? true,
        },
        m,
      );
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.ECOSYSTEM_PROGRAMME_CREATE,
        resource: 'ecosystem-programme',
        resourceId: created.id,
        details: { name: created.nameEn, icon: created.icon, link: created.link, isActive: created.isActive },
      });
      return created.id;
    });
    return this.getForAdmin(id);
  }

  /*
   * A partial update. `expectedUpdatedAt` is the version the admin screen loaded; a mismatch means
   * someone else saved first, and their work is kept rather than silently overwritten.
   */
  async update(id: string, input: UpdateProgrammeInput, req?: Request): Promise<AdminEcosystemProgramme> {
    await AppDataSource.transaction(async (m) => {
      const current = await ecosystemProgrammeRepository.findForUpdate(id, m);
      if (!current) throw AppError.notFound(NOT_FOUND);
      if (isStale(input.expectedUpdatedAt, current.updatedAt)) throw AppError.conflict(STALE_PROGRAMME);
      if (input.name) await this.assertUniqueName(input.name, id, m);

      const changes = programmeColumns(input);
      if (Object.keys(changes).length) await ecosystemProgrammeRepository.updateWhere({ id }, changes, m);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.ECOSYSTEM_PROGRAMME_UPDATE,
        resource: 'ecosystem-programme',
        resourceId: id,
        details: { fields: Object.keys(changes) },
      });
    });
    return this.getForAdmin(id);
  }

  async setActive(id: string, isActive: boolean, req?: Request): Promise<AdminEcosystemProgramme> {
    await AppDataSource.transaction(async (m) => {
      if (!(await ecosystemProgrammeRepository.findForUpdate(id, m))) throw AppError.notFound(NOT_FOUND);
      await ecosystemProgrammeRepository.updateWhere({ id }, { isActive }, m);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.ECOSYSTEM_PROGRAMME_STATUS,
        resource: 'ecosystem-programme',
        resourceId: id,
        details: { isActive },
      });
    });
    return this.getForAdmin(id);
  }

  async remove(id: string, req?: Request): Promise<void> {
    await AppDataSource.transaction(async (m) => {
      const current = await ecosystemProgrammeRepository.findForUpdate(id, m);
      if (!current) throw AppError.notFound(NOT_FOUND);
      await ecosystemProgrammeRepository.softDelete(id, m);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.ECOSYSTEM_PROGRAMME_DELETE,
        resource: 'ecosystem-programme',
        resourceId: id,
        details: { name: current.nameEn, link: current.link },
      });
    });
  }

  /*
   * Rewrites the display order from a full list of ids, in one transaction. The list must name every
   * card exactly once: anything else means the screen is out of date, and guessing where the missing
   * cards go would move the wrong one.
   */
  async reorder(ids: string[], req?: Request): Promise<AdminEcosystemProgramme[]> {
    await AppDataSource.transaction(async (m) => {
      const all = await ecosystemProgrammeRepository.lockAll(m);
      const byId = new Map(all.map((r) => [r.id, r]));
      if (ids.length !== all.length || ids.some((id) => !byId.has(id))) throw AppError.conflict(STALE_ORDER);
      for (const [index, id] of ids.entries()) {
        if (byId.get(id)!.displayOrder !== index + 1) await ecosystemProgrammeRepository.updateWhere({ id }, { displayOrder: index + 1 }, m);
      }
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.ECOSYSTEM_PROGRAMMES_REORDER,
        resource: 'ecosystem-programme',
        details: { order: ids },
      });
    });
    return this.listForAdmin();
  }

  async getSection(): Promise<AdminEcosystemSection> {
    const s = await ecosystemSectionRepository.find();
    if (!s) throw AppError.notFound(NOT_CONFIGURED);
    return toAdminSection(s);
  }

  async updateSection(input: UpdateEcosystemSectionInput, req?: Request): Promise<AdminEcosystemSection> {
    await AppDataSource.transaction(async (m) => {
      const s = await ecosystemSectionRepository.findForUpdate(m);
      if (!s) throw AppError.notFound(NOT_CONFIGURED);
      if (isStale(input.expectedUpdatedAt, s.updatedAt)) throw AppError.conflict(STALE_SECTION);
      await ecosystemSectionRepository.updateWhere(
        { id: s.id },
        {
          headingMr: input.heading.mr,
          headingEn: input.heading.en,
          subtitleMr: input.subtitle.mr,
          subtitleEn: input.subtitle.en,
          linkLabelMr: input.linkLabel.mr,
          linkLabelEn: input.linkLabel.en,
          showSection: input.showSection,
        },
        m,
      );
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.ECOSYSTEM_SECTION_UPDATE,
        resource: 'ecosystem-section',
        resourceId: s.id,
        details: { showSection: input.showSection },
      });
    });
    return this.getSection();
  }

  /*
   * What the website reads. Null — not an error — when the section has never been configured. A
   * hidden section comes back with `showSection: false` and no cards, so the site can leave it out.
   */
  async getPublic(): Promise<PublicEcosystemSection | null> {
    const s = await ecosystemSectionRepository.find();
    if (!s || !s.isActive) return null;
    const defaultLabel = pair(s.linkLabelMr, s.linkLabelEn);
    const programmes = s.showSection ? await ecosystemProgrammeRepository.list({ activeOnly: true }) : [];
    return {
      heading: pair(s.headingMr, s.headingEn),
      subtitle: s.subtitleMr ? pair(s.subtitleMr, s.subtitleEn) : null,
      showSection: s.showSection,
      programmes: programmes.map((p) => ({
        id: p.id,
        name: pair(p.nameMr, p.nameEn),
        description: pair(p.descriptionMr, p.descriptionEn),
        icon: p.icon,
        link: p.link,
        /* Blank in both languages or filled in both (database CHECK), so one half decides. */
        linkLabel: p.linkLabelMr ? pair(p.linkLabelMr, p.linkLabelEn) : defaultLabel,
      })),
    };
  }

  private async assertUniqueName(name: Bilingual, exceptId: string | undefined, manager: EntityManager): Promise<void> {
    const clash = await ecosystemProgrammeRepository.findByName(name, exceptId, manager);
    if (clash) throw AppError.conflict(`A programme named "${clash.nameMr}" / "${clash.nameEn}" already exists.`);
  }
}

export const ecosystemService = new EcosystemService();
