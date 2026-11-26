import type { Request } from 'express';
import type { ObjectLiteral } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { AppDataSource } from '../../config/database.config';
import type { AppBaseEntity } from '../../database/base.entity';
import { auditService } from '../../modules/audit/audit.service';
import { AUDIT_ACTIONS } from '../../shared/constants/app.constants';
import { AppError } from '../../shared/errors/app-error';
import type { AboutCard, AboutFact, AboutSection } from './about.model';
import { aboutCardRepository, aboutFactRepository, aboutSectionRepository, type AboutItemRepository } from './about.repository';
import type {
  AboutItemInput,
  AdminAbout,
  AdminAboutCard,
  AdminAboutFact,
  AdminAboutSection,
  Bilingual,
  PublicAbout,
  UpdateAboutSectionInput,
} from './about.types';
import { assertNoDependencies, type DependencyKind } from '../../shared/dependencies/dependencies';
import { ABOUT_CARD_DEPENDENCIES, ABOUT_FACT_DEPENDENCIES } from '../cms.dependencies';

const NOT_CONFIGURED = 'The About AMRUT section has not been configured yet. Run the database seed to create it.';
const STALE = 'This was changed after you opened it. Reload to see the latest version, then make your changes again.';

const pair = (mr: string, en: string): Bilingual => ({ mr, en });
const isStale = (expected: string | undefined, actual: Date) => expected !== undefined && new Date(expected).getTime() !== actual.getTime();

type Item = AppBaseEntity & ObjectLiteral & { displayOrder: number };

/* How one kind of list — information rows or cards — is stored, named and audited. */
interface ItemSpec<T extends Item, A> {
  repo: AboutItemRepository<T>;
  /* Column prefixes of the two texts: label/value for a row, heading/description for a card. */
  first: 'label' | 'heading';
  second: 'value' | 'description';
  noun: string;
  resource: string;
  audit: { create: string; update: string; status: string; delete: string; reorder: string };
  toAdmin: (row: T) => A;
  /* Why this record may not be deleted or hidden, or null when it may. */
  protectedReason?: (row: T) => string | null;
  /* What may keep it from being deleted (shared/dependencies, cms.dependencies.ts). */
  dependencies: DependencyKind;
}

/*
 * The lifecycle of an information row or a card: add, edit (partially), show/hide, delete (soft, like
 * every record here) and reorder. Every change is one transaction with its audit entry; a record is
 * locked before it is checked, so concurrent saves are serialised rather than lost.
 */
class AboutItems<T extends Item, A> {
  constructor(private readonly spec: ItemSpec<T, A>) {}

  async list(): Promise<A[]> {
    return (await this.spec.repo.list()).map(this.spec.toAdmin);
  }

  async get(id: string): Promise<A> {
    const row = await this.spec.repo.findById(id);
    if (!row) throw AppError.notFound(`${this.spec.noun} not found`);
    return this.spec.toAdmin(row);
  }

  private columns(input: AboutItemInput): QueryDeepPartialEntity<T> {
    const { first, second } = this.spec;
    const out: Record<string, unknown> = {};
    if (input.first) Object.assign(out, { [`${first}Mr`]: input.first.mr, [`${first}En`]: input.first.en });
    if (input.second) Object.assign(out, { [`${second}Mr`]: input.second.mr, [`${second}En`]: input.second.en });
    if (input.displayOrder !== undefined) out.displayOrder = input.displayOrder;
    if (input.isActive !== undefined) out.isActive = input.isActive;
    return out as QueryDeepPartialEntity<T>;
  }

  private async assertUnique(text: Bilingual, exceptId: string | undefined, m: Parameters<AboutItemRepository<T>['findClash']>[2]) {
    const clash = await this.spec.repo.findClash(text, exceptId, m);
    if (clash) {
      const f = this.spec.first;
      throw AppError.conflict(`${this.spec.noun} "${clash[`${f}Mr`]}" / "${clash[`${f}En`]}" already exists.`);
    }
  }

  private guard(row: T, action: string) {
    const reason = this.spec.protectedReason?.(row);
    if (reason) throw AppError.conflict(`${reason} It can be edited but not ${action}.`);
  }

  async create(input: Required<Pick<AboutItemInput, 'first' | 'second'>> & AboutItemInput, req?: Request): Promise<A> {
    const id = await AppDataSource.transaction(async (m) => {
      await this.assertUnique(input.first, undefined, m);
      const created = await this.spec.repo.create(
        {
          ...(this.columns(input) as object),
          /* A new record goes to the end of the list unless an order is given. */
          displayOrder: input.displayOrder ?? (await this.spec.repo.maxOrder(m)) + 1,
          isActive: input.isActive ?? true,
        } as never,
        m,
      );
      await auditService.recordInTx(m, req, {
        action: this.spec.audit.create,
        resource: this.spec.resource,
        resourceId: created.id,
        details: { [this.spec.first]: input.first.en, isActive: created.isActive },
      });
      return created.id;
    });
    return this.get(id);
  }

  /* A partial update; `expectedUpdatedAt` refuses a save over someone else's newer edit. */
  async update(id: string, input: AboutItemInput, req?: Request): Promise<A> {
    await AppDataSource.transaction(async (m) => {
      const current = await this.spec.repo.findForUpdate(id, m);
      if (!current) throw AppError.notFound(`${this.spec.noun} not found`);
      if (isStale(input.expectedUpdatedAt, current.updatedAt)) throw AppError.conflict(STALE);
      if (input.isActive === false) this.guard(current, 'hidden');
      if (input.first) await this.assertUnique(input.first, id, m);

      const changes = this.columns(input);
      if (Object.keys(changes).length) await this.spec.repo.updateWhere({ id } as never, changes, m);
      await auditService.recordInTx(m, req, {
        action: this.spec.audit.update,
        resource: this.spec.resource,
        resourceId: id,
        details: { fields: Object.keys(changes) },
      });
    });
    return this.get(id);
  }

  async setActive(id: string, isActive: boolean, req?: Request): Promise<A> {
    await AppDataSource.transaction(async (m) => {
      const current = await this.spec.repo.findForUpdate(id, m);
      if (!current) throw AppError.notFound(`${this.spec.noun} not found`);
      if (!isActive) this.guard(current, 'hidden');
      await this.spec.repo.updateWhere({ id } as never, { isActive } as never, m);
      await auditService.recordInTx(m, req, { action: this.spec.audit.status, resource: this.spec.resource, resourceId: id, details: { isActive } });
    });
    return this.get(id);
  }

  async remove(id: string, req?: Request): Promise<void> {
    await AppDataSource.transaction(async (m) => {
      const current = await this.spec.repo.findForUpdate(id, m);
      if (!current) throw AppError.notFound(`${this.spec.noun} not found`);
      this.guard(current, 'deleted');
      await assertNoDependencies(this.spec.dependencies, id, m);
      await this.spec.repo.softDelete(id, m);
      await auditService.recordInTx(m, req, {
        action: this.spec.audit.delete,
        resource: this.spec.resource,
        resourceId: id,
        details: { [this.spec.first]: current[`${this.spec.first}En`] },
      });
    });
  }

  /*
   * Rewrites the display order from a full list of ids, in one transaction. The list must name every
   * record exactly once: anything else means the screen is out of date, and guessing where the
   * missing records go would move the wrong one.
   */
  async reorder(ids: string[], req?: Request): Promise<A[]> {
    await AppDataSource.transaction(async (m) => {
      const all = await this.spec.repo.lockAll(m);
      const byId = new Map(all.map((r) => [r.id, r]));
      if (ids.length !== all.length || ids.some((id) => !byId.has(id))) {
        throw AppError.conflict('The list changed after you loaded it. Reload, then reorder again.');
      }
      for (const [index, id] of ids.entries()) {
        if (byId.get(id)!.displayOrder !== index + 1) await this.spec.repo.updateWhere({ id } as never, { displayOrder: index + 1 } as never, m);
      }
      await auditService.recordInTx(m, req, { action: this.spec.audit.reorder, resource: this.spec.resource, details: { order: ids } });
    });
    return this.list();
  }
}

const toAdminFact = (f: AboutFact): AdminAboutFact => ({
  id: f.id,
  label: pair(f.labelMr, f.labelEn),
  value: pair(f.valueMr, f.valueEn),
  displayOrder: f.displayOrder,
  isActive: f.isActive,
  createdAt: f.createdAt,
  updatedAt: f.updatedAt,
});

const toAdminCard = (c: AboutCard): AdminAboutCard => ({
  id: c.id,
  heading: pair(c.headingMr, c.headingEn),
  description: pair(c.descriptionMr, c.descriptionEn),
  displayOrder: c.displayOrder,
  isActive: c.isActive,
  isRequired: c.isRequired,
  createdAt: c.createdAt,
  updatedAt: c.updatedAt,
});

const toAdminSection = (s: AboutSection): AdminAboutSection => ({
  id: s.id,
  heading: pair(s.headingMr, s.headingEn),
  subtitle: pair(s.subtitleMr, s.subtitleEn),
  description: pair(s.descriptionMr, s.descriptionEn),
  showSection: s.showSection,
  createdAt: s.createdAt,
  updatedAt: s.updatedAt,
});

export const aboutFacts = new AboutItems<AboutFact, AdminAboutFact>({
  repo: aboutFactRepository,
  first: 'label',
  second: 'value',
  noun: 'Information row',
  resource: 'about-fact',
  dependencies: ABOUT_FACT_DEPENDENCIES,
  audit: {
    create: AUDIT_ACTIONS.ABOUT_FACT_CREATE,
    update: AUDIT_ACTIONS.ABOUT_FACT_UPDATE,
    status: AUDIT_ACTIONS.ABOUT_FACT_STATUS,
    delete: AUDIT_ACTIONS.ABOUT_FACT_DELETE,
    reorder: AUDIT_ACTIONS.ABOUT_FACTS_REORDER,
  },
  toAdmin: toAdminFact,
});

export const aboutCards = new AboutItems<AboutCard, AdminAboutCard>({
  repo: aboutCardRepository,
  first: 'heading',
  second: 'description',
  noun: 'About card',
  resource: 'about-card',
  dependencies: ABOUT_CARD_DEPENDENCIES,
  audit: {
    create: AUDIT_ACTIONS.ABOUT_CARD_CREATE,
    update: AUDIT_ACTIONS.ABOUT_CARD_UPDATE,
    status: AUDIT_ACTIONS.ABOUT_CARD_STATUS,
    delete: AUDIT_ACTIONS.ABOUT_CARD_DELETE,
    reorder: AUDIT_ACTIONS.ABOUT_CARDS_REORDER,
  },
  toAdmin: toAdminCard,
  protectedReason: (c) => (c.isRequired ? `"${c.headingEn}" is one of the required Mission, Vision and Values cards.` : null),
});

/*
 * The About AMRUT section (CMS): the singleton's heading, subtitle, description and visibility, and
 * the dashboard / website reads that put it together with its rows and cards.
 */
export class AboutService {
  async getAdmin(): Promise<AdminAbout> {
    const s = await aboutSectionRepository.find();
    if (!s) throw AppError.notFound(NOT_CONFIGURED);
    const [facts, cards] = await Promise.all([aboutFacts.list(), aboutCards.list()]);
    return { section: toAdminSection(s), facts, cards };
  }

  async updateSection(input: UpdateAboutSectionInput, req?: Request): Promise<AdminAboutSection> {
    await AppDataSource.transaction(async (m) => {
      const s = await aboutSectionRepository.findForUpdate(m);
      if (!s) throw AppError.notFound(NOT_CONFIGURED);
      if (isStale(input.expectedUpdatedAt, s.updatedAt)) throw AppError.conflict(STALE);
      const changes: QueryDeepPartialEntity<AboutSection> = {};
      if (input.heading) Object.assign(changes, { headingMr: input.heading.mr, headingEn: input.heading.en });
      if (input.subtitle) Object.assign(changes, { subtitleMr: input.subtitle.mr, subtitleEn: input.subtitle.en });
      if (input.description) Object.assign(changes, { descriptionMr: input.description.mr, descriptionEn: input.description.en });
      if (input.showSection !== undefined) changes.showSection = input.showSection;
      await aboutSectionRepository.updateWhere({ id: s.id }, changes, m);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.ABOUT_SECTION_UPDATE,
        resource: 'about-section',
        resourceId: s.id,
        details: { fields: Object.keys(changes) },
      });
    });
    const s = await aboutSectionRepository.find();
    return toAdminSection(s!);
  }

  /*
   * What the website reads. Null — not an error — when the section has never been configured. A
   * hidden section comes back with `showSection: false` and no rows or cards.
   */
  async getPublic(): Promise<PublicAbout | null> {
    const s = await aboutSectionRepository.find();
    if (!s || !s.isActive) return null;
    const [facts, cards] = s.showSection
      ? await Promise.all([aboutFactRepository.list({ activeOnly: true }), aboutCardRepository.list({ activeOnly: true })])
      : [[], []];
    return {
      heading: pair(s.headingMr, s.headingEn),
      subtitle: s.subtitleMr ? pair(s.subtitleMr, s.subtitleEn) : null,
      description: pair(s.descriptionMr, s.descriptionEn),
      showSection: s.showSection,
      facts: facts.map((f) => ({ id: f.id, label: pair(f.labelMr, f.labelEn), value: pair(f.valueMr, f.valueEn) })),
      cards: cards.map((c) => ({ id: c.id, heading: pair(c.headingMr, c.headingEn), description: pair(c.descriptionMr, c.descriptionEn) })),
    };
  }
}

export const aboutService = new AboutService();
