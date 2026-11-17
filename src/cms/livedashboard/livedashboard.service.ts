import type { Request } from 'express';
import type { FindOptionsWhere } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { AppDataSource } from '../../config/database.config';
import { auditService } from '../../modules/audit/audit.service';
import { AUDIT_ACTIONS, type AuditAction } from '../../shared/constants/app.constants';
import { AppError } from '../../shared/errors/app-error';
import type { LiveDashboardCard, LiveDashboardDistrict, LiveDashboardSettings, LiveDashboardStat } from './livedashboard.model';
import {
  type OrderedListRepository,
  liveDashboardCardRepository,
  liveDashboardDistrictRepository,
  liveDashboardSettingsRepository,
  liveDashboardStatRepository,
} from './livedashboard.repository';
import type {
  AdminLiveDashboardCard,
  AdminLiveDashboardDistrict,
  AdminLiveDashboardSettings,
  AdminLiveDashboardStat,
  Bilingual,
  CreateLiveDashboardCardInput,
  CreateLiveDashboardStatInput,
  DistrictFigures,
  DistrictProgressStatus,
  LiveDashboardTone,
  PublicLiveDashboard,
  UpdateLiveDashboardDistrictInput,
  UpdateLiveDashboardSettingsInput,
} from './livedashboard.types';

const NOT_CONFIGURED = 'The Live Dashboard has not been configured yet. Run the database migrations to create it.';
const STALE_SETTINGS =
  'The dashboard settings were changed after you opened them. Reload to see the latest version, then make your changes again.';
const STALE_ROW = 'This item was changed after you opened it. Reload to see the latest version, then make your changes again.';
const STALE_ORDER = 'The list changed after you loaded it. Reload the list, then reorder again.';
const DISTRICT_NOT_FOUND = 'District not found';

const pair = (mr: string, en: string): Bilingual => ({ mr, en });
/* Optional texts are blank in both languages or filled in both (database CHECK), so one half decides. */
const pairOrNull = (mr: string, en: string): Bilingual | null => (mr ? pair(mr, en) : null);
const isStale = (expected: string | undefined, actual: Date) => expected !== undefined && new Date(expected).getTime() !== actual.getTime();

const toAdminSettings = (s: LiveDashboardSettings): AdminLiveDashboardSettings => ({
  id: s.id,
  heading: pair(s.headingMr, s.headingEn),
  subtitle: pair(s.subtitleMr, s.subtitleEn),
  showSection: s.showSection,
  disclaimer: pair(s.disclaimerMr, s.disclaimerEn),
  showDisclaimer: s.showDisclaimer,
  mapTitle: pair(s.mapTitleMr, s.mapTitleEn),
  showMap: s.showMap,
  modesTitle: pair(s.modesTitleMr, s.modesTitleEn),
  showModes: s.showModes,
  offlineLabel: pair(s.offlineLabelMr, s.offlineLabelEn),
  onlineLabel: pair(s.onlineLabelMr, s.onlineLabelEn),
  offlineCount: s.offlineCount,
  onlineCount: s.onlineCount,
  donutCenterLabel: pair(s.donutCenterLabelMr, s.donutCenterLabelEn),
  createdAt: s.createdAt,
  updatedAt: s.updatedAt,
});

const toAdminCard = (c: LiveDashboardCard): AdminLiveDashboardCard => ({
  id: c.id,
  label: pair(c.labelMr, c.labelEn),
  value: c.value,
  detail: pair(c.detailMr, c.detailEn),
  link: c.link,
  tone: c.tone as LiveDashboardTone,
  displayOrder: c.displayOrder,
  isActive: c.isActive,
  createdAt: c.createdAt,
  updatedAt: c.updatedAt,
});

const toAdminStat = (s: LiveDashboardStat): AdminLiveDashboardStat => ({
  id: s.id,
  label: pair(s.labelMr, s.labelEn),
  value: s.value,
  displayOrder: s.displayOrder,
  isActive: s.isActive,
  createdAt: s.createdAt,
  updatedAt: s.updatedAt,
});

const figuresOf = (d: LiveDashboardDistrict): DistrictFigures => ({
  status: d.status as DistrictProgressStatus,
  target: d.target,
  enrolled: d.enrolled,
  trainingActive: d.trainingActive,
  completed: d.completed,
  certified: d.certified,
  attendancePct: d.attendancePct,
});

const toAdminDistrict = (d: LiveDashboardDistrict): AdminLiveDashboardDistrict => ({
  id: d.id,
  code: d.districtCode,
  name: pair(d.nameMr, d.nameEn),
  ...figuresOf(d),
  displayOrder: d.displayOrder,
  createdAt: d.createdAt,
  updatedAt: d.updatedAt,
});

/* The card columns an input touches. Keys the input leaves out are not in the result at all. */
function cardColumns(input: Partial<CreateLiveDashboardCardInput>): QueryDeepPartialEntity<LiveDashboardCard> {
  const out: QueryDeepPartialEntity<LiveDashboardCard> = {};
  if (input.label) Object.assign(out, { labelMr: input.label.mr, labelEn: input.label.en });
  if (input.value !== undefined) out.value = input.value;
  if (input.detail !== undefined) Object.assign(out, { detailMr: input.detail?.mr ?? '', detailEn: input.detail?.en ?? '' });
  if (input.link !== undefined) out.link = input.link;
  if (input.tone !== undefined) out.tone = input.tone;
  if (input.displayOrder !== undefined) out.displayOrder = input.displayOrder;
  if (input.isActive !== undefined) out.isActive = input.isActive;
  return out;
}

function statColumns(input: Partial<CreateLiveDashboardStatInput>): QueryDeepPartialEntity<LiveDashboardStat> {
  const out: QueryDeepPartialEntity<LiveDashboardStat> = {};
  if (input.label) Object.assign(out, { labelMr: input.label.mr, labelEn: input.label.en });
  if (input.value !== undefined) out.value = input.value;
  if (input.displayOrder !== undefined) out.displayOrder = input.displayOrder;
  if (input.isActive !== undefined) out.isActive = input.isActive;
  return out;
}

/*
 * The KPI cards and the side figures are two lists with the same life cycle (add, edit, show/hide,
 * reorder, delete), so one class runs both; only the columns, the audit names and the wording differ.
 */
interface ListSpec<E extends LiveDashboardCard | LiveDashboardStat, A, C> {
  repo: OrderedListRepository<E>;
  toAdmin: (row: E) => A;
  columns: (input: Partial<C>) => QueryDeepPartialEntity<E>;
  /* The audit resource and the few fields that identify a row in the log. */
  resource: string;
  summary: (row: E) => Record<string, unknown>;
  notFound: string;
  actions: { create: AuditAction; update: AuditAction; status: AuditAction; remove: AuditAction; reorder: AuditAction };
}

class OrderedList<E extends LiveDashboardCard | LiveDashboardStat, A, C extends { displayOrder?: number; isActive?: boolean }> {
  constructor(private readonly spec: ListSpec<E, A, C>) {}

  /* TypeORM cannot see the common columns through the generic E; both are columns of every list row. */
  private byId = (id: string) => ({ id }) as FindOptionsWhere<E>;
  private patch = (v: { isActive?: boolean; displayOrder?: number }) => v as unknown as QueryDeepPartialEntity<E>;

  async list(): Promise<A[]> {
    return (await this.spec.repo.list()).map(this.spec.toAdmin);
  }

  async get(id: string): Promise<A> {
    const row = await this.spec.repo.findById(id);
    if (!row) throw AppError.notFound(this.spec.notFound);
    return this.spec.toAdmin(row);
  }

  async create(input: C, req?: Request): Promise<A> {
    const { repo, resource, summary, actions, columns } = this.spec;
    const id = await AppDataSource.transaction(async (m) => {
      /* A new row goes to the end of the list unless an order is given, and is shown unless hidden. */
      const data = {
        ...columns(input),
        displayOrder: input.displayOrder ?? (await repo.maxOrder(m)) + 1,
        isActive: input.isActive ?? true,
      };
      const created = await repo.create(data as Parameters<typeof repo.create>[0], m);
      await auditService.recordInTx(m, req, {
        action: actions.create,
        resource,
        resourceId: created.id,
        details: { ...summary(created), isActive: created.isActive },
      });
      return created.id;
    });
    return this.get(id);
  }

  /*
   * A partial update. `expectedUpdatedAt` is the version the admin screen loaded; a mismatch means
   * someone else saved first, and their work is kept rather than silently overwritten.
   */
  async update(id: string, input: Partial<C> & { expectedUpdatedAt?: string }, req?: Request): Promise<A> {
    const { repo, resource, actions, columns, notFound } = this.spec;
    await AppDataSource.transaction(async (m) => {
      const current = await repo.findForUpdate(id, m);
      if (!current) throw AppError.notFound(notFound);
      if (isStale(input.expectedUpdatedAt, current.updatedAt)) throw AppError.conflict(STALE_ROW);
      const changes = columns(input);
      if (Object.keys(changes).length) await repo.updateWhere(this.byId(id), changes, m);
      await auditService.recordInTx(m, req, { action: actions.update, resource, resourceId: id, details: { fields: Object.keys(changes) } });
    });
    return this.get(id);
  }

  async setActive(id: string, isActive: boolean, req?: Request): Promise<A> {
    const { repo, resource, actions, notFound } = this.spec;
    await AppDataSource.transaction(async (m) => {
      if (!(await repo.findForUpdate(id, m))) throw AppError.notFound(notFound);
      await repo.updateWhere(this.byId(id), this.patch({ isActive }), m);
      await auditService.recordInTx(m, req, { action: actions.status, resource, resourceId: id, details: { isActive } });
    });
    return this.get(id);
  }

  async remove(id: string, req?: Request): Promise<void> {
    const { repo, resource, summary, actions, notFound } = this.spec;
    await AppDataSource.transaction(async (m) => {
      const current = await repo.findForUpdate(id, m);
      if (!current) throw AppError.notFound(notFound);
      await repo.softDelete(id, m);
      await auditService.recordInTx(m, req, { action: actions.remove, resource, resourceId: id, details: summary(current) });
    });
  }

  /*
   * Rewrites the display order from a full list of ids, in one transaction. The list must name every
   * row exactly once: anything else means the screen is out of date, and guessing where the missing
   * rows go would move the wrong one.
   */
  async reorder(ids: string[], req?: Request): Promise<A[]> {
    const { repo, resource, actions } = this.spec;
    await AppDataSource.transaction(async (m) => {
      const all = await repo.lockAll(m);
      const byId = new Map(all.map((r) => [r.id, r]));
      if (ids.length !== all.length || ids.some((id) => !byId.has(id))) throw AppError.conflict(STALE_ORDER);
      for (const [index, id] of ids.entries()) {
        if (byId.get(id)!.displayOrder !== index + 1)
          await repo.updateWhere(this.byId(id), this.patch({ displayOrder: index + 1 }), m);
      }
      await auditService.recordInTx(m, req, { action: actions.reorder, resource, details: { order: ids } });
    });
    return this.list();
  }
}

/*
 * Live Dashboard (CMS): the home page's "Programme Progress – Live Dashboard" — its heading and
 * texts, the KPI cards, the district map figures, the training-modes donut and the figures beside it,
 * and which of those parts are shown. Whether the whole section is shown is the "Show on website"
 * switch (src/cms/visibility), the one writer of `showSection`; this service only reads it.
 *
 * Every figure is stored as entered; nothing here is computed from candidates or batches. Cards and
 * figures are soft-deleted, like every record here; nothing else references them. The 36 districts
 * are fixed rows, edited in place.
 */
export class LiveDashboardService {
  readonly cards = new OrderedList<LiveDashboardCard, AdminLiveDashboardCard, CreateLiveDashboardCardInput>({
    repo: liveDashboardCardRepository,
    toAdmin: toAdminCard,
    columns: cardColumns,
    resource: 'live-dashboard-card',
    summary: (c) => ({ label: c.labelEn, value: c.value }),
    notFound: 'Dashboard card not found',
    actions: {
      create: AUDIT_ACTIONS.LIVE_DASHBOARD_CARD_CREATE,
      update: AUDIT_ACTIONS.LIVE_DASHBOARD_CARD_UPDATE,
      status: AUDIT_ACTIONS.LIVE_DASHBOARD_CARD_STATUS,
      remove: AUDIT_ACTIONS.LIVE_DASHBOARD_CARD_DELETE,
      reorder: AUDIT_ACTIONS.LIVE_DASHBOARD_CARDS_REORDER,
    },
  });

  readonly stats = new OrderedList<LiveDashboardStat, AdminLiveDashboardStat, CreateLiveDashboardStatInput>({
    repo: liveDashboardStatRepository,
    toAdmin: toAdminStat,
    columns: statColumns,
    resource: 'live-dashboard-stat',
    summary: (s) => ({ label: s.labelEn, value: s.value }),
    notFound: 'Dashboard figure not found',
    actions: {
      create: AUDIT_ACTIONS.LIVE_DASHBOARD_STAT_CREATE,
      update: AUDIT_ACTIONS.LIVE_DASHBOARD_STAT_UPDATE,
      status: AUDIT_ACTIONS.LIVE_DASHBOARD_STAT_STATUS,
      remove: AUDIT_ACTIONS.LIVE_DASHBOARD_STAT_DELETE,
      reorder: AUDIT_ACTIONS.LIVE_DASHBOARD_STATS_REORDER,
    },
  });

  async getSettings(): Promise<AdminLiveDashboardSettings> {
    const s = await liveDashboardSettingsRepository.find();
    if (!s) throw AppError.notFound(NOT_CONFIGURED);
    return toAdminSettings(s);
  }

  async updateSettings(input: UpdateLiveDashboardSettingsInput, req?: Request): Promise<AdminLiveDashboardSettings> {
    await AppDataSource.transaction(async (m) => {
      const s = await liveDashboardSettingsRepository.findForUpdate(m);
      if (!s) throw AppError.notFound(NOT_CONFIGURED);
      if (isStale(input.expectedUpdatedAt, s.updatedAt)) throw AppError.conflict(STALE_SETTINGS);
      await liveDashboardSettingsRepository.updateWhere(
        { id: s.id },
        {
          headingMr: input.heading.mr,
          headingEn: input.heading.en,
          subtitleMr: input.subtitle?.mr ?? '',
          subtitleEn: input.subtitle?.en ?? '',
          disclaimerMr: input.disclaimer?.mr ?? '',
          disclaimerEn: input.disclaimer?.en ?? '',
          showDisclaimer: input.showDisclaimer,
          mapTitleMr: input.mapTitle.mr,
          mapTitleEn: input.mapTitle.en,
          showMap: input.showMap,
          modesTitleMr: input.modesTitle.mr,
          modesTitleEn: input.modesTitle.en,
          showModes: input.showModes,
          offlineLabelMr: input.offlineLabel.mr,
          offlineLabelEn: input.offlineLabel.en,
          onlineLabelMr: input.onlineLabel.mr,
          onlineLabelEn: input.onlineLabel.en,
          offlineCount: input.offlineCount,
          onlineCount: input.onlineCount,
          donutCenterLabelMr: input.donutCenterLabel.mr,
          donutCenterLabelEn: input.donutCenterLabel.en,
        },
        m,
      );
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.LIVE_DASHBOARD_SETTINGS_UPDATE,
        resource: 'live-dashboard-settings',
        resourceId: s.id,
        details: {
          showDisclaimer: input.showDisclaimer,
          showMap: input.showMap,
          showModes: input.showModes,
          offlineCount: input.offlineCount,
          onlineCount: input.onlineCount,
        },
      });
    });
    return this.getSettings();
  }

  async listDistricts(): Promise<AdminLiveDashboardDistrict[]> {
    return (await liveDashboardDistrictRepository.list()).map(toAdminDistrict);
  }

  /* A partial update of one district's status and figures, addressed by its code ('PUN'). */
  async updateDistrict(code: string, input: UpdateLiveDashboardDistrictInput, req?: Request): Promise<AdminLiveDashboardDistrict> {
    await AppDataSource.transaction(async (m) => {
      const current = await liveDashboardDistrictRepository.findByCodeForUpdate(code, m);
      if (!current) throw AppError.notFound(DISTRICT_NOT_FOUND);
      if (isStale(input.expectedUpdatedAt, current.updatedAt)) throw AppError.conflict(STALE_ROW);
      const { expectedUpdatedAt: _version, ...figures } = input;
      const changes = Object.fromEntries(Object.entries(figures).filter(([, v]) => v !== undefined)) as Partial<DistrictFigures>;
      if (Object.keys(changes).length) await liveDashboardDistrictRepository.updateWhere({ id: current.id }, changes, m);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.LIVE_DASHBOARD_DISTRICT_UPDATE,
        resource: 'live-dashboard-district',
        resourceId: current.id,
        details: { code, ...changes },
      });
    });
    const updated = await liveDashboardDistrictRepository.findByCode(code);
    if (!updated) throw AppError.notFound(DISTRICT_NOT_FOUND);
    return toAdminDistrict(updated);
  }

  /*
   * What the website reads. Null — not an error — when the dashboard has never been configured, so
   * the site keeps its own bundled figures. A hidden section comes back with `showSection: false`, no
   * cards and no map or modes, never as null, so the site leaves it out instead of falling back.
   */
  async getPublic(): Promise<PublicLiveDashboard | null> {
    const s = await liveDashboardSettingsRepository.find();
    if (!s || !s.isActive) return null;
    const shown = s.showSection;
    const [cards, stats, districts] = await Promise.all([
      shown ? liveDashboardCardRepository.list({ activeOnly: true }) : [],
      shown && s.showModes ? liveDashboardStatRepository.list({ activeOnly: true }) : [],
      shown && s.showMap ? liveDashboardDistrictRepository.list({ activeOnly: true }) : [],
    ]);
    return {
      showSection: shown,
      heading: pair(s.headingMr, s.headingEn),
      subtitle: pairOrNull(s.subtitleMr, s.subtitleEn),
      disclaimer: s.showDisclaimer ? pairOrNull(s.disclaimerMr, s.disclaimerEn) : null,
      cards: cards.map((c) => ({
        id: c.id,
        label: pair(c.labelMr, c.labelEn),
        value: c.value,
        detail: pairOrNull(c.detailMr, c.detailEn),
        link: c.link || null,
        tone: c.tone as LiveDashboardTone,
      })),
      map:
        shown && s.showMap
          ? {
              title: pair(s.mapTitleMr, s.mapTitleEn),
              districts: districts.map((d) => ({ code: d.districtCode, name: pair(d.nameMr, d.nameEn), ...figuresOf(d) })),
            }
          : null,
      modes:
        shown && s.showModes
          ? {
              title: pair(s.modesTitleMr, s.modesTitleEn),
              offline: { label: pair(s.offlineLabelMr, s.offlineLabelEn), count: s.offlineCount },
              online: { label: pair(s.onlineLabelMr, s.onlineLabelEn), count: s.onlineCount },
              centerLabel: pair(s.donutCenterLabelMr, s.donutCenterLabelEn),
              stats: stats.map((x) => ({ id: x.id, label: pair(x.labelMr, x.labelEn), value: x.value })),
            }
          : null,
    };
  }
}

export const liveDashboardService = new LiveDashboardService();
