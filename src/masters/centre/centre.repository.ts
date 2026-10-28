import type { EntityManager, SelectQueryBuilder } from 'typeorm';
import { Brackets } from 'typeorm';
import { AppDataSource } from '../../config/database.config';
import { BaseRepository } from '../../database/base.repository';
import { buildMeta, likePattern, toSkipTake, type Paginated } from '../../shared/utils/pagination';
import { Centre, type CentreTechnology } from './centre.model';
import type { CentreListQuery, CentreSortField, CentreTechnologyRef } from './centre.types';

const SORT_SQL: Record<CentreSortField, string> = {
  name: 'c.name',
  code: 'c.code',
  districtName: 'd.name',
  createdAt: 'c.createdAt',
  updatedAt: 'c.updatedAt',
};

/* SQL condition: the technology track (alias) can be chosen — active and not deleted. */
export const usableTrackSql = (alias: string) => `${alias}."isActive" = true AND ${alias}."isDelete" = false`;

export class CentreRepository extends BaseRepository<Centre> {
  constructor() {
    super(Centre);
  }

  /* Centres are always read with their district, its state and (when set) the taluka, as colleges are. */
  private withParents(manager?: EntityManager): SelectQueryBuilder<Centre> {
    return this.query('c', manager)
      .innerJoinAndSelect('c.district', 'd')
      .innerJoinAndSelect('d.state', 's')
      .leftJoinAndSelect('c.taluka', 't');
  }

  findByIdWithParents(id: string, manager?: EntityManager): Promise<Centre | null> {
    return this.withParents(manager).andWhere('c.id = :id', { id }).getOne();
  }

  findByNameInDistrict(
    districtId: string,
    name: string,
    opts: { excludeId?: string; manager?: EntityManager } = {},
  ): Promise<Centre | null> {
    const qb = this.query('c', opts.manager)
      .andWhere('c.districtId = :districtId', { districtId })
      .andWhere('lower(c.name) = lower(:name)', { name });
    if (opts.excludeId) qb.andWhere('c.id <> :excludeId', { excludeId: opts.excludeId });
    return qb.getOne();
  }

  findByCode(code: string, opts: { excludeId?: string; manager?: EntityManager } = {}): Promise<Centre | null> {
    const qb = this.query('c', opts.manager).andWhere('c.code = :code', { code });
    if (opts.excludeId) qb.andWhere('c.id <> :excludeId', { excludeId: opts.excludeId });
    return qb.getOne();
  }

  async list(q: CentreListQuery): Promise<Paginated<Centre>> {
    const qb = this.withParents();
    if (q.districtId) qb.andWhere('c.districtId = :districtId', { districtId: q.districtId });
    if (q.stateId) qb.andWhere('d.stateId = :stateId', { stateId: q.stateId });
    if (q.technologyCode)
      qb.andWhere(
        `EXISTS (SELECT 1 FROM "edp_centre_technologies" ct JOIN "technology_tracks" tt ON tt."id" = ct."technologyTrackId"
                 WHERE ct."centreId" = c."id" AND ct."isDelete" = false AND tt."code" = :technologyCode)`,
        { technologyCode: q.technologyCode },
      );
    if (q.search) {
      const term = likePattern(q.search);
      qb.andWhere(
        new Brackets((w) =>
          w.where('c.name ILIKE :term', { term }).orWhere('c.code ILIKE :term', { term }).orWhere('d.name ILIKE :term', { term }),
        ),
      );
    }
    if (q.isActive !== undefined) qb.andWhere('c.isActive = :isActive', { isActive: q.isActive });
    const { skip, take } = toSkipTake(q);
    const [items, total] = await qb.orderBy(SORT_SQL[q.sortBy], q.sortOrder).addOrderBy('c.id').skip(skip).take(take).getManyAndCount();
    return { items, meta: buildMeta(q, total) };
  }

  /* Centres offered in a dropdown: not deleted and active, A to Z. */
  findSelectable(manager?: EntityManager): Promise<Centre[]> {
    return this.withParents(manager).andWhere('c.isActive = true').orderBy('c.name', 'ASC').addOrderBy('c.id').getMany();
  }

  /* The allocated technologies of each centre (non-deleted allocations), in track order (T01, T02, …). */
  async technologiesOf(centreIds: string[], manager?: EntityManager): Promise<Map<string, CentreTechnologyRef[]>> {
    const out = new Map<string, CentreTechnologyRef[]>(centreIds.map((id) => [id, []]));
    if (!centreIds.length) return out;
    const rows: { centreId: string; code: string; name: string; usable: boolean }[] = await (manager ?? AppDataSource.manager).query(
      `SELECT ct."centreId", tt."code", tt."name", (${usableTrackSql('tt')}) AS "usable"
       FROM "edp_centre_technologies" ct JOIN "technology_tracks" tt ON tt."id" = ct."technologyTrackId"
       WHERE ct."isDelete" = false AND ct."centreId" = ANY($1::uuid[])
       ORDER BY tt."sortOrder" ASC, tt."code" ASC`,
      [centreIds],
    );
    for (const r of rows) out.get(r.centreId)?.push({ code: r.code, name: r.name, usable: r.usable });
    return out;
  }

  /* The technologies an allocation may add (active tracks), in track order. */
  allocatableTechnologies(manager?: EntityManager): Promise<{ code: string; name: string }[]> {
    return (manager ?? AppDataSource.manager).query(
      `SELECT tt."code", tt."name" FROM "technology_tracks" tt WHERE ${usableTrackSql('tt')} ORDER BY tt."sortOrder" ASC, tt."code" ASC`,
    );
  }

  /* Non-deleted allocation rows of a centre, with the track code of each. */
  allocations(centreId: string, manager: EntityManager): Promise<(CentreTechnology & { code: string })[]> {
    return manager.query(
      `SELECT ct.*, tt."code" FROM "edp_centre_technologies" ct JOIN "technology_tracks" tt ON tt."id" = ct."technologyTrackId"
       WHERE ct."centreId" = $1 AND ct."isDelete" = false`,
      [centreId],
    );
  }
}

export const centreRepository = new CentreRepository();
