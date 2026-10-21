import type { EntityManager, EntityTarget, FindOptionsWhere, SelectQueryBuilder } from 'typeorm';
import { Brackets } from 'typeorm';
import { AppDataSource } from '../../config/database.config';
import { BaseRepository } from '../../database/base.repository';
import type { AppBaseEntity } from '../../database/base.entity';
import { User } from '../../modules/users';
import { buildMeta, likePattern, toSkipTake, type Paginated } from '../../shared/utils/pagination';
import { MasterDocument } from './document.model';
import type { DocumentListQuery, DocumentSortField } from './document.types';

/*
 * A document as every read path loads it: with its district (and that district's state) and centre, both
 * optional, and the users who uploaded and verified it. The two users are mapped onto the row by the query
 * builder; the model itself declares no relation to users.
 */
export type DocumentRow = MasterDocument & { uploadedBy?: User | null; verifiedBy?: User | null };

/* sortBy to SQL expression. Every sortable column lives on the document itself. */
const SORT_SQL: Record<DocumentSortField, string> = {
  title: 'doc.title',
  category: 'doc.category',
  verificationStatus: 'doc.verificationStatus',
  fileSize: 'doc.fileSize',
  createdAt: 'doc.createdAt',
  updatedAt: 'doc.updatedAt',
};

export class DocumentRepository extends BaseRepository<MasterDocument> {
  constructor() {
    super(MasterDocument);
  }

  /* Left joins: a document may be linked to neither a district nor a centre, and its users may be gone. */
  private withRefs(manager?: EntityManager): SelectQueryBuilder<MasterDocument> {
    return this.query('doc', manager)
      .leftJoinAndSelect('doc.district', 'dt')
      .leftJoinAndSelect('dt.state', 'st')
      .leftJoinAndSelect('doc.centre', 'tc')
      .leftJoinAndMapOne('doc.uploadedBy', User, 'ub', 'ub.id = doc.uploadedById')
      .leftJoinAndMapOne('doc.verifiedBy', User, 'vb', 'vb.id = doc.verifiedById');
  }

  async findByIdWithRefs(id: string, manager?: EntityManager): Promise<DocumentRow | null> {
    return this.withRefs(manager).andWhere('doc.id = :id', { id }).getOne();
  }

  async list(q: DocumentListQuery): Promise<Paginated<DocumentRow>> {
    const qb = this.withRefs();
    if (q.search) {
      const term = likePattern(q.search);
      qb.andWhere(new Brackets((w) => w
        .where('doc.title ILIKE :term', { term })
        .orWhere('doc.fileName ILIKE :term', { term })
        .orWhere('tc.name ILIKE :term', { term })));
    }
    if (q.category) qb.andWhere('doc.category = :category', { category: q.category });
    if (q.verificationStatus) qb.andWhere('doc.verificationStatus = :verificationStatus', { verificationStatus: q.verificationStatus });
    /* Through the document's own district, like the District filter it narrows: a centre-only document has no state. */
    if (q.stateId) qb.andWhere('dt.stateId = :stateId', { stateId: q.stateId });
    if (q.districtId) qb.andWhere('doc.districtId = :districtId', { districtId: q.districtId });
    if (q.centreId) qb.andWhere('doc.centreId = :centreId', { centreId: q.centreId });
    if (q.isActive !== undefined) qb.andWhere('doc.isActive = :isActive', { isActive: q.isActive });
    const { skip, take } = toSkipTake(q);
    const [items, total] = await qb.orderBy(SORT_SQL[q.sortBy], q.sortOrder).addOrderBy('doc.id').skip(skip).take(take).getManyAndCount();
    return { items, meta: buildMeta(q, total) };
  }

  /* True when a non-deleted row of another master exists (used to reject a list filter naming an unknown parent). */
  refExists<T extends AppBaseEntity>(target: EntityTarget<T>, id: string): Promise<boolean> {
    return AppDataSource.manager.getRepository(target).exists({ where: { id, isDelete: false } as FindOptionsWhere<T> });
  }
}

export const documentRepository = new DocumentRepository();
