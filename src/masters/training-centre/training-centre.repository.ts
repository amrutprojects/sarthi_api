import type { EntityManager, SelectQueryBuilder } from 'typeorm';
import { Brackets } from 'typeorm';
import { TrainingCentre } from './training-centre.model';
import { BaseRepository } from '../../database/base.repository';
import { AppError } from '../../shared/errors/app-error';
import { buildMeta, likePattern, toSkipTake, type Paginated } from '../../shared/utils/pagination';
import type { TrainingCentreListQuery, TrainingCentreSortField } from './training-centre.types';

/* sortBy to SQL expression, so the joined parent names are sortable without exposing a column name to clients. */
const SORT_SQL: Record<TrainingCentreSortField, string> = {
  name: 'tc.name',
  code: 'tc.code',
  districtName: 'd.name',
  centreTypeName: 'ct.name',
  createdAt: 'tc.createdAt',
  updatedAt: 'tc.updatedAt',
};

/* Generated codes: TC + the next value of training_centre_code_seq, at least 4 digits (TC0001). */
const GENERATED_PREFIX = 'TC';
const MAX_CODE_ATTEMPTS = 1000;

export class TrainingCentreRepository extends BaseRepository<TrainingCentre> {
  constructor() {
    super(TrainingCentre);
  }

  /*
   * Centres are always read with their parents: the district (and its state) is compulsory, the centre
   * type and taluka are optional, hence the left joins.
   */
  private withParents(manager?: EntityManager): SelectQueryBuilder<TrainingCentre> {
    return this.query('tc', manager)
      .innerJoinAndSelect('tc.district', 'd')
      .innerJoinAndSelect('d.state', 's')
      .leftJoinAndSelect('tc.centreType', 'ct')
      .leftJoinAndSelect('tc.taluka', 'tk');
  }

  findByIdWithParents(id: string, manager?: EntityManager): Promise<TrainingCentre | null> {
    return this.withParents(manager).andWhere('tc.id = :id', { id }).getOne();
  }

  /* Name uniqueness is per district, matching the (districtId, lower("name")) unique index. */
  findByNameInDistrict(
    districtId: string,
    name: string,
    opts: { excludeId?: string; manager?: EntityManager } = {},
  ): Promise<TrainingCentre | null> {
    const qb = this.query('tc', opts.manager)
      .andWhere('tc.districtId = :districtId', { districtId })
      .andWhere('lower(tc.name) = lower(:name)', { name });
    if (opts.excludeId) qb.andWhere('tc.id <> :excludeId', { excludeId: opts.excludeId });
    return qb.getOne();
  }

  /* Matches the unique index on code (non-deleted rows). */
  findByCode(code: string, opts: { excludeId?: string; manager?: EntityManager } = {}): Promise<TrainingCentre | null> {
    const qb = this.query('tc', opts.manager).andWhere('tc.code = :code', { code });
    if (opts.excludeId) qb.andWhere('tc.id <> :excludeId', { excludeId: opts.excludeId });
    return qb.getOne();
  }

  /*
   * Next free generated code. Draws from training_centre_code_seq and skips any value already held by a
   * row — deleted rows included, so restoring a deleted centre can never collide with a generated code.
   * A code typed by hand (e.g. TC0007) is simply stepped over.
   */
  async nextGeneratedCode(manager: EntityManager): Promise<string> {
    for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
      const rows: { n: string }[] = await manager.query(`SELECT nextval('training_centre_code_seq') AS n`);
      const code = `${GENERATED_PREFIX}${String(rows[0].n).padStart(4, '0')}`;
      if (!(await this.repo(manager).exists({ where: { code } }))) return code;
    }
    throw AppError.conflict('A centre code could not be generated. Enter a code instead.');
  }

  async list(q: TrainingCentreListQuery): Promise<Paginated<TrainingCentre>> {
    const qb = this.withParents();
    if (q.centreTypeId) qb.andWhere('tc.centreTypeId = :centreTypeId', { centreTypeId: q.centreTypeId });
    if (q.stateId) qb.andWhere('d.stateId = :stateId', { stateId: q.stateId });
    if (q.districtId) qb.andWhere('tc.districtId = :districtId', { districtId: q.districtId });
    if (q.search) {
      const term = likePattern(q.search);
      qb.andWhere(new Brackets((w) => w
        .where('tc.name ILIKE :term', { term })
        .orWhere('tc.code ILIKE :term', { term })
        .orWhere('d.name ILIKE :term', { term })
        .orWhere('tc.pocName ILIKE :term', { term })));
    }
    if (q.isActive !== undefined) qb.andWhere('tc.isActive = :isActive', { isActive: q.isActive });
    const { skip, take } = toSkipTake(q);
    const [items, total] = await qb.orderBy(SORT_SQL[q.sortBy], q.sortOrder).addOrderBy('tc.id').skip(skip).take(take).getManyAndCount();
    return { items, meta: buildMeta(q, total) };
  }

  /* Centres offered in a dropdown: not deleted and active. */
  findSelectable(manager?: EntityManager): Promise<TrainingCentre[]> {
    return this.findMany({ isActive: true }, { order: { name: 'ASC' }, manager });
  }
}

export const trainingCentreRepository = new TrainingCentreRepository();
