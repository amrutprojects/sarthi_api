import type { EntityManager } from 'typeorm';
import { BaseRepository } from '../../database/base.repository';
import { ProgrammeElectiveDomain, ProgrammeModule, ProgrammeModuleSettings } from './modules.model';

/*
 * The Modules page configuration is a singleton, so this repository has no list or paging: the only
 * read that matters is "the one live configuration, with its modules and elective domains".
 */
export class ModulesRepository extends BaseRepository<ProgrammeModuleSettings> {
  constructor() {
    super(ProgrammeModuleSettings);
  }

  /* The live configuration, or null before the seed has run. */
  findSettings(manager?: EntityManager): Promise<ProgrammeModuleSettings | null> {
    return this.query('s', manager).orderBy('s.createdAt', 'ASC').getOne();
  }

  /*
   * `activeOnly` is what separates the public read from the admin read: the admin edits inactive
   * rows, the website never sees them.
   */
  findModules(settingsId: string, opts: { activeOnly?: boolean; manager?: EntityManager } = {}): Promise<ProgrammeModule[]> {
    const qb = (opts.manager ?? this.repo().manager)
      .getRepository(ProgrammeModule)
      .createQueryBuilder('m')
      .where('m.isDelete = false')
      .andWhere('m.settingsId = :settingsId', { settingsId })
      .orderBy('m.displayOrder', 'ASC')
      .addOrderBy('m.no', 'ASC');
    if (opts.activeOnly) qb.andWhere('m.isActive = true');
    return qb.getMany();
  }

  /* Every domain belonging to the given modules, ordered as each module lists them. */
  findElectives(moduleIds: string[], opts: { activeOnly?: boolean; manager?: EntityManager } = {}): Promise<ProgrammeElectiveDomain[]> {
    if (moduleIds.length === 0) return Promise.resolve([]);
    const qb = (opts.manager ?? this.repo().manager)
      .getRepository(ProgrammeElectiveDomain)
      .createQueryBuilder('d')
      .where('d.isDelete = false')
      .andWhere('d.moduleId IN (:...moduleIds)', { moduleIds })
      .orderBy('d.displayOrder', 'ASC')
      .addOrderBy('d.no', 'ASC');
    if (opts.activeOnly) qb.andWhere('d.isActive = true');
    return qb.getMany();
  }

  modules(manager?: EntityManager) {
    return (manager ?? this.repo().manager).getRepository(ProgrammeModule);
  }

  electives(manager?: EntityManager) {
    return (manager ?? this.repo().manager).getRepository(ProgrammeElectiveDomain);
  }
}

export const modulesRepository = new ModulesRepository();
