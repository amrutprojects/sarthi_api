import { Brackets, In, type EntityManager } from 'typeorm';
import { AppDataSource } from '../../config/database.config';
import { BaseRepository } from '../../database/base.repository';
import { buildMeta, likePattern, toSkipTake, type Paginated } from '../../shared/utils/pagination';
import { LmsEntityCentre } from './entity-centre.model';
import { LmsEntityTrack } from './entity-track.model';
import { LmsEntity } from './entity.model';
import type { EnabledCentre, EnabledTrack, LmsEntityListQuery, LmsEntitySortField } from './entity.types';

/* sortBy to SQL expression; only these columns are sortable. */
const SORT_SQL: Record<LmsEntitySortField, string> = {
  name: 'e.name',
  code: 'e.code',
  createdAt: 'e.createdAt',
  updatedAt: 'e.updatedAt',
};

const manager = (m?: EntityManager) => m ?? AppDataSource.manager;

export class LmsEntityRepository extends BaseRepository<LmsEntity> {
  constructor() {
    super(LmsEntity);
  }

  /* Matches UQ_lms_entities_name_active (case-insensitive, non-deleted rows). */
  findByName(name: string, opts: { excludeId?: string; manager?: EntityManager } = {}): Promise<LmsEntity | null> {
    const qb = this.query('e', opts.manager).andWhere('lower(e.name) = lower(:name)', { name });
    if (opts.excludeId) qb.andWhere('e.id <> :excludeId', { excludeId: opts.excludeId });
    return qb.getOne();
  }

  /* Matches UQ_lms_entities_code_active (non-deleted rows). */
  findByCode(code: string, opts: { excludeId?: string; manager?: EntityManager } = {}): Promise<LmsEntity | null> {
    const qb = this.query('e', opts.manager).andWhere('e.code = :code', { code });
    if (opts.excludeId) qb.andWhere('e.id <> :excludeId', { excludeId: opts.excludeId });
    return qb.getOne();
  }

  async list(q: LmsEntityListQuery): Promise<Paginated<LmsEntity>> {
    /* deleted: ONLY the soft-deleted rows (the explicit "Show deleted" list); otherwise the non-deleted ones, as query() does. */
    const qb = this.repo().createQueryBuilder('e').where('e.isDelete = :isDelete', { isDelete: q.deleted === true });
    if (q.search) {
      const term = likePattern(q.search);
      qb.andWhere(new Brackets((w) => w.where('e.name ILIKE :term', { term }).orWhere('e.code ILIKE :term', { term })));
    }
    if (q.isActive !== undefined) qb.andWhere('e.isActive = :isActive', { isActive: q.isActive });
    if (q.centreId) {
      qb.andWhere(
        `EXISTS (SELECT 1 FROM "lms_entity_centres" ec WHERE ec."entityId" = e.id AND ec."centreId" = :centreId AND ec."isDelete" = false)`,
        { centreId: q.centreId },
      );
    }
    if (q.trackId) {
      qb.andWhere(
        `EXISTS (SELECT 1 FROM "lms_entity_tracks" et WHERE et."entityId" = e.id AND et."trackId" = :trackId AND et."isDelete" = false)`,
        { trackId: q.trackId },
      );
    }
    const { skip, take } = toSkipTake(q);
    const [items, total] = await qb.orderBy(SORT_SQL[q.sortBy], q.sortOrder).addOrderBy('e.id').skip(skip).take(take).getManyAndCount();
    return { items, meta: buildMeta(q, total) };
  }

  /* Entities offered in a dropdown: not deleted and active (a new entity appears only when ACTIVE, L-03). */
  findSelectable(m?: EntityManager): Promise<LmsEntity[]> {
    return this.findMany({ isActive: true }, { order: { name: 'ASC' }, manager: m });
  }

  /*
   * The enabled centres of each entity, A to Z by centre name. The centre is read whatever its state in
   * the Admin Panel (deactivated or deleted there after it was enabled), and reported with isActive.
   */
  async enabledCentres(entityIds: string[], m?: EntityManager): Promise<Map<string, EnabledCentre[]>> {
    const out = new Map<string, EnabledCentre[]>(entityIds.map((id) => [id, []]));
    if (!entityIds.length) return out;
    const rows: { entityId: string; id: string; name: string; code: string; districtName: string | null; usable: boolean }[] = await manager(m)
      .getRepository(LmsEntityCentre)
      .createQueryBuilder('ec')
      .innerJoin('ec.centre', 'c')
      .leftJoin('c.district', 'd')
      .select('ec.entityId', 'entityId')
      .addSelect('c.id', 'id')
      .addSelect('c.name', 'name')
      .addSelect('c.code', 'code')
      .addSelect('d.name', 'districtName')
      .addSelect('(c.isActive AND NOT c.isDelete)', 'usable')
      .where('ec.isDelete = false')
      .andWhere('ec.entityId IN (:...entityIds)', { entityIds })
      .orderBy('c.name', 'ASC')
      .addOrderBy('c.code', 'ASC')
      .getRawMany();
    for (const r of rows) {
      out.get(r.entityId)?.push({ id: r.id, name: r.name, code: r.code, districtName: r.districtName, isActive: r.usable === true });
    }
    return out;
  }

  /* The enabled tracks of each entity, in the Admin Panel's track order (T01…T12). */
  async enabledTracks(entityIds: string[], m?: EntityManager): Promise<Map<string, EnabledTrack[]>> {
    const out = new Map<string, EnabledTrack[]>(entityIds.map((id) => [id, []]));
    if (!entityIds.length) return out;
    const rows: { entityId: string; id: string; code: string; name: string; usable: boolean }[] = await manager(m)
      .getRepository(LmsEntityTrack)
      .createQueryBuilder('et')
      .innerJoin('et.track', 't')
      .select('et.entityId', 'entityId')
      .addSelect('t.id', 'id')
      .addSelect('t.code', 'code')
      .addSelect('t.name', 'name')
      .addSelect('(t.isActive AND NOT t.isDelete)', 'usable')
      .where('et.isDelete = false')
      .andWhere('et.entityId IN (:...entityIds)', { entityIds })
      .orderBy('t.sortOrder', 'ASC')
      .addOrderBy('t.code', 'ASC')
      .getRawMany();
    for (const r of rows) out.get(r.entityId)?.push({ id: r.id, code: r.code, name: r.name, isActive: r.usable === true });
    return out;
  }

  /* Ids currently enabled for one entity (non-deleted selection rows). */
  async selectedCentreIds(entityId: string, m: EntityManager): Promise<string[]> {
    const rows = await m.getRepository(LmsEntityCentre).find({ where: { entityId, isDelete: false }, select: { centreId: true } });
    return rows.map((r) => r.centreId);
  }

  async selectedTrackIds(entityId: string, m: EntityManager): Promise<string[]> {
    const rows = await m.getRepository(LmsEntityTrack).find({ where: { entityId, isDelete: false }, select: { trackId: true } });
    return rows.map((r) => r.trackId);
  }

  async addCentres(entityId: string, centreIds: string[], m: EntityManager): Promise<void> {
    if (centreIds.length) await m.getRepository(LmsEntityCentre).insert(centreIds.map((centreId) => ({ entityId, centreId })));
  }

  async addTracks(entityId: string, trackIds: string[], m: EntityManager): Promise<void> {
    if (trackIds.length) await m.getRepository(LmsEntityTrack).insert(trackIds.map((trackId) => ({ entityId, trackId })));
  }

  /* Removal from the selection is a soft delete of the selection row. */
  async removeCentres(entityId: string, centreIds: string[], m: EntityManager): Promise<void> {
    if (centreIds.length) {
      await m.getRepository(LmsEntityCentre).update({ entityId, centreId: In(centreIds), isDelete: false }, { isDelete: true, isActive: false });
    }
  }

  async removeTracks(entityId: string, trackIds: string[], m: EntityManager): Promise<void> {
    if (trackIds.length) {
      await m.getRepository(LmsEntityTrack).update({ entityId, trackId: In(trackIds), isDelete: false }, { isDelete: true, isActive: false });
    }
  }
}

export const lmsEntityRepository = new LmsEntityRepository();
