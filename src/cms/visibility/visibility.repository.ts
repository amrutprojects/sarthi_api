import type { EntityManager } from 'typeorm';
import { BaseRepository } from '../../database/base.repository';
import type { AppBaseEntity } from '../../database/base.entity';

/*
 * A section's settings singleton, whichever table it lives in. "The live row" is the oldest
 * non-deleted one — exactly what each section's own repository reads — so the switch always flips
 * the row the section's screens and public feed use.
 */
export class SingletonRepository<T extends AppBaseEntity> extends BaseRepository<T> {
  find(manager?: EntityManager): Promise<T | null> {
    return this.query('s', manager).orderBy('s.createdAt', 'ASC').getOne();
  }

  /* The same row, locked for the rest of the caller's transaction, so it serialises with the section's own saves. */
  findForUpdate(manager: EntityManager): Promise<T | null> {
    return this.query('s', manager).orderBy('s.createdAt', 'ASC').setLock('pessimistic_write').getOne();
  }
}
