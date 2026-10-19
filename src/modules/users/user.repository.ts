import { Brackets, type EntityManager } from 'typeorm';
import { User } from './user.entity';
import { UserRole } from '../roles-permissions';
import { BaseRepository } from '../../database/base.repository';
import { buildMeta, likePattern, toSkipTake, type ListQuery, type Paginated } from '../../shared/utils/pagination';

export type UserSortField = 'createdAt' | 'name' | 'email' | 'lastLoginAt';

export class UserRepository extends BaseRepository<User> {
  constructor() {
    super(User);
  }

  /* Login lookup: includes passwordHash, which is never selected otherwise. */
  findByEmailWithPassword(email: string): Promise<User | null> {
    return this.query('u').addSelect('u.passwordHash').andWhere('u.email = :email', { email: email.toLowerCase() }).getOne();
  }

  findByEmail(email: string, manager?: EntityManager): Promise<User | null> {
    return this.findOne({ email: email.toLowerCase() }, manager);
  }

  async list(q: ListQuery<UserSortField> & { roleId?: string }): Promise<Paginated<User>> {
    const qb = this.query('u');
    if (q.search) {
      const term = likePattern(q.search);
      qb.andWhere(new Brackets((w) => w.where('u.name ILIKE :term', { term }).orWhere('u.email ILIKE :term', { term })));
    }
    if (q.isActive !== undefined) qb.andWhere('u.isActive = :isActive', { isActive: q.isActive });
    if (q.roleId) {
      qb.andWhere((sub) => {
        const s = sub.subQuery().select('1').from(UserRole, 'ur')
          .where('ur.userId = u.id').andWhere('ur.roleId = :roleId').andWhere('ur.isDelete = false').getQuery();
        return `EXISTS ${s}`;
      }).setParameter('roleId', q.roleId);
    }
    const { skip, take } = toSkipTake(q);
    const [items, total] = await qb.orderBy(`u.${q.sortBy}`, q.sortOrder, 'NULLS LAST').addOrderBy('u.id').skip(skip).take(take).getManyAndCount();
    return { items, meta: buildMeta(q, total) };
  }
}

export const userRepository = new UserRepository();
