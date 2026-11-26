import type { Request } from 'express';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { AppDataSource } from '../../config/database.config';
import { auditService } from '../../modules/audit/audit.service';
import { AUDIT_ACTIONS } from '../../shared/constants/app.constants';
import { AppError } from '../../shared/errors/app-error';
import type { ImpactSection, ImpactStat } from './impact.model';
import { impactSectionRepository, impactStatRepository } from './impact.repository';
import type {
  AdminImpactSection,
  AdminImpactStat,
  Bilingual,
  CreateImpactStatInput,
  PublicImpactSection,
  UpdateImpactSectionInput,
  UpdateImpactStatInput,
} from './impact.types';
import { assertNoDependencies } from '../../shared/dependencies/dependencies';
import { IMPACT_STAT_DEPENDENCIES } from '../cms.dependencies';

const NOT_FOUND = 'Impact card not found';
const NOT_CONFIGURED = "The AMRUT's Impact section has not been configured yet. Run the database seed to create it.";
const STALE_STAT = 'This card was changed after you opened it. Reload to see the latest version, then make your changes again.';
const STALE_SECTION =
  'The section settings were changed after you opened them. Reload to see the latest version, then make your changes again.';
const STALE_ORDER = 'The card list changed after you loaded it. Reload the list, then reorder again.';

/* The highest display order the database accepts (CHECK 1..999). */
const MAX_ORDER = 999;

const pair = (mr: string, en: string): Bilingual => ({ mr, en });
const isStale = (expected: string | undefined, actual: Date) => expected !== undefined && new Date(expected).getTime() !== actual.getTime();

const toAdmin = (s: ImpactStat): AdminImpactStat => ({
  id: s.id,
  value: s.value,
  label: pair(s.labelMr, s.labelEn),
  displayOrder: s.displayOrder,
  isActive: s.isActive,
  createdAt: s.createdAt,
  updatedAt: s.updatedAt,
});

const toAdminSection = (s: ImpactSection): AdminImpactSection => ({
  id: s.id,
  heading: pair(s.headingMr, s.headingEn),
  showSection: s.showSection,
  createdAt: s.createdAt,
  updatedAt: s.updatedAt,
});

/* The card columns an input touches. Keys the input leaves out are not in the result at all. */
function statColumns(input: Partial<CreateImpactStatInput>): QueryDeepPartialEntity<ImpactStat> {
  const out: QueryDeepPartialEntity<ImpactStat> = {};
  if (input.value !== undefined) out.value = input.value;
  if (input.label) Object.assign(out, { labelMr: input.label.mr, labelEn: input.label.en });
  if (input.displayOrder !== undefined) out.displayOrder = input.displayOrder;
  if (input.isActive !== undefined) out.isActive = input.isActive;
  return out;
}

/*
 * AMRUT's Impact (CMS): the अमृतचा प्रभाव statistic cards and the section's own heading and visibility.
 *
 * Every figure is stored as entered; nothing here counts schemes, beneficiaries, districts or centres.
 * Cards are soft-deleted, like every record here; nothing else references them.
 */
export class ImpactService {
  async listForAdmin(): Promise<AdminImpactStat[]> {
    return (await impactStatRepository.list()).map(toAdmin);
  }

  async getForAdmin(id: string): Promise<AdminImpactStat> {
    const s = await impactStatRepository.findById(id);
    if (!s) throw AppError.notFound(NOT_FOUND);
    return toAdmin(s);
  }

  async create(input: CreateImpactStatInput, req?: Request): Promise<AdminImpactStat> {
    const id = await AppDataSource.transaction(async (m) => {
      const created = await impactStatRepository.create(
        {
          value: input.value,
          labelMr: input.label.mr,
          labelEn: input.label.en,
          /*
           * A new card goes to the end of the row unless an order is given. Capped at the database's
           * limit: a card created at the cap sorts after the others by creation time.
           */
          displayOrder: input.displayOrder ?? Math.min((await impactStatRepository.maxOrder(m)) + 1, MAX_ORDER),
          isActive: input.isActive ?? true,
        },
        m,
      );
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.IMPACT_STAT_CREATE,
        resource: 'amrut-impact-stat',
        resourceId: created.id,
        details: { value: created.value, label: created.labelEn, isActive: created.isActive },
      });
      return created.id;
    });
    return this.getForAdmin(id);
  }

  /*
   * A partial update. `expectedUpdatedAt` is the version the admin screen loaded; a mismatch means
   * someone else saved first, and their work is kept rather than silently overwritten.
   */
  async update(id: string, input: UpdateImpactStatInput, req?: Request): Promise<AdminImpactStat> {
    await AppDataSource.transaction(async (m) => {
      const current = await impactStatRepository.findForUpdate(id, m);
      if (!current) throw AppError.notFound(NOT_FOUND);
      if (isStale(input.expectedUpdatedAt, current.updatedAt)) throw AppError.conflict(STALE_STAT);

      const changes = statColumns(input);
      if (Object.keys(changes).length) await impactStatRepository.updateWhere({ id }, changes, m);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.IMPACT_STAT_UPDATE,
        resource: 'amrut-impact-stat',
        resourceId: id,
        details: { fields: Object.keys(changes) },
      });
    });
    return this.getForAdmin(id);
  }

  async setActive(id: string, isActive: boolean, req?: Request): Promise<AdminImpactStat> {
    await AppDataSource.transaction(async (m) => {
      if (!(await impactStatRepository.findForUpdate(id, m))) throw AppError.notFound(NOT_FOUND);
      await impactStatRepository.updateWhere({ id }, { isActive }, m);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.IMPACT_STAT_STATUS,
        resource: 'amrut-impact-stat',
        resourceId: id,
        details: { isActive },
      });
    });
    return this.getForAdmin(id);
  }

  async remove(id: string, req?: Request): Promise<void> {
    await AppDataSource.transaction(async (m) => {
      const current = await impactStatRepository.findForUpdate(id, m);
      if (!current) throw AppError.notFound(NOT_FOUND);
      await assertNoDependencies(IMPACT_STAT_DEPENDENCIES, id, m);
      await impactStatRepository.softDelete(id, m);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.IMPACT_STAT_DELETE,
        resource: 'amrut-impact-stat',
        resourceId: id,
        details: { value: current.value, label: current.labelEn },
      });
    });
  }

  /*
   * Rewrites the display order from a full list of ids, in one transaction. The list must name every
   * card exactly once: anything else means the screen is out of date, and guessing where the missing
   * cards go would move the wrong one.
   */
  async reorder(ids: string[], req?: Request): Promise<AdminImpactStat[]> {
    await AppDataSource.transaction(async (m) => {
      const all = await impactStatRepository.lockAll(m);
      const byId = new Map(all.map((r) => [r.id, r]));
      if (ids.length !== all.length || ids.some((id) => !byId.has(id))) throw AppError.conflict(STALE_ORDER);
      for (const [index, id] of ids.entries()) {
        if (byId.get(id)!.displayOrder !== index + 1) await impactStatRepository.updateWhere({ id }, { displayOrder: index + 1 }, m);
      }
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.IMPACT_STATS_REORDER,
        resource: 'amrut-impact-stat',
        details: { order: ids },
      });
    });
    return this.listForAdmin();
  }

  async getSection(): Promise<AdminImpactSection> {
    const s = await impactSectionRepository.find();
    if (!s) throw AppError.notFound(NOT_CONFIGURED);
    return toAdminSection(s);
  }

  async updateSection(input: UpdateImpactSectionInput, req?: Request): Promise<AdminImpactSection> {
    await AppDataSource.transaction(async (m) => {
      const s = await impactSectionRepository.findForUpdate(m);
      if (!s) throw AppError.notFound(NOT_CONFIGURED);
      if (isStale(input.expectedUpdatedAt, s.updatedAt)) throw AppError.conflict(STALE_SECTION);
      await impactSectionRepository.updateWhere(
        { id: s.id },
        { headingMr: input.heading.mr, headingEn: input.heading.en, showSection: input.showSection },
        m,
      );
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.IMPACT_SECTION_UPDATE,
        resource: 'amrut-impact-section',
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
  async getPublic(): Promise<PublicImpactSection | null> {
    const s = await impactSectionRepository.find();
    if (!s || !s.isActive) return null;
    const stats = s.showSection ? await impactStatRepository.list({ activeOnly: true }) : [];
    return {
      heading: pair(s.headingMr, s.headingEn),
      showSection: s.showSection,
      stats: stats.map((x) => ({ id: x.id, value: x.value, label: pair(x.labelMr, x.labelEn) })),
    };
  }
}

export const impactService = new ImpactService();
