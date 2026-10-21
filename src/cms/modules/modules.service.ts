import type { Request } from 'express';
import { AppDataSource } from '../../config/database.config';
import { AUDIT_ACTIONS } from '../../shared/constants/app.constants';
import { auditService } from '../../modules/audit/audit.service';
import { AppError } from '../../shared/errors/app-error';
import type { ProgrammeElectiveDomain, ProgrammeModuleSettings } from './modules.model';
import { modulesRepository } from './modules.repository';
import type {
  AdminElectiveDomain,
  AdminModulesPage,
  LearningPath,
  ModuleTimeSplit,
  PublicModulesPage,
  UpdateElectiveDomainInput,
  UpdateModuleInput,
  UpdateModulesPageInput,
} from './modules.types';

const NOT_CONFIGURED = 'The Modules page has not been configured yet. Run the database seed to create it.';

const toAdminDomain = (d: ProgrammeElectiveDomain): AdminElectiveDomain => ({
  id: d.id,
  no: d.no,
  domain: { mr: d.domainMr, en: d.domainEn },
  certificate: d.certificate,
  displayOrder: d.displayOrder,
  isActive: d.isActive,
});

/*
 * `weeklyAssessmentHours` is NUMERIC, which the driver returns as a string to avoid the precision
 * loss a float would bring. The page prints it as a number, so it is converted once here rather
 * than in every consumer.
 */
const toTimeSplit = (s: ProgrammeModuleSettings): ModuleTimeSplit => ({
  moduleHours: s.moduleHours,
  trainingHours: s.trainingHours,
  assessmentHours: s.assessmentHours,
  weeksPerModule: s.weeksPerModule,
  daysPerWeek: s.daysPerWeek,
  hoursPerDay: s.hoursPerDay,
  weeklyAssessmentHours: Number(s.weeklyAssessmentHours),
});

const toLearningPath = (s: ProgrammeModuleSettings): LearningPath => ({
  sessionLength: { mr: s.sessionLengthMr, en: s.sessionLengthEn },
  sessionLabel: { mr: s.sessionLabelMr, en: s.sessionLabelEn },
  fixedPathPct: s.fixedPathPct,
  selfPathPct: s.selfPathPct,
});

const toModuleColumns = (input: UpdateModuleInput, order: number) => ({
  no: input.no,
  code: input.code.trim().toUpperCase(),
  nameMr: input.name.mr,
  nameEn: input.name.en,
  descriptionMr: input.description.mr,
  descriptionEn: input.description.en,
  isElective: input.elective ?? false,
  displayOrder: input.displayOrder ?? order,
  isActive: input.isActive ?? true,
});

const toDomainColumns = (input: UpdateElectiveDomainInput, order: number) => ({
  no: input.no,
  domainMr: input.domain.mr,
  domainEn: input.domain.en,
  certificate: input.certificate,
  displayOrder: input.displayOrder ?? order,
  isActive: input.isActive ?? true,
});

/*
 * Modules page content (CMS).
 *
 * The configuration is a singleton enforced by the database, so there is no create endpoint: the
 * row is written once by the seed and edited thereafter. A missing row is a deployment problem (the
 * seed has not run), not something a request should silently repair — the admin read reports it
 * plainly and the public read degrades to "nothing published" so the website shows its own copy.
 *
 * Employment domains belong to a MODULE, not to the page: every module carries its own list, so
 * each can offer different domains and editing one leaves the others alone. The  flag is
 * a label on the card, not a gate — a module may carry domains whether or not it is marked one.
 *
 * Every rule here is also a database constraint (the hours arithmetic, the path shares totalling
 * 100, unique module codes, unique domain numbers within a module). The checks exist to return a
 * readable 4xx instead of a raw constraint error.
 */
export class ModulesService {
  /* The configuration an administrator edits, including inactive rows. */
  async getForAdmin(): Promise<AdminModulesPage> {
    const settings = await modulesRepository.findSettings();
    if (!settings) throw AppError.notFound(NOT_CONFIGURED);

    const modules = await modulesRepository.findModules(settings.id);
    const domains = await modulesRepository.findElectives(modules.map((m) => m.id));

    return {
      id: settings.id,
      modules: modules.map((m) => ({
        id: m.id,
        no: m.no,
        code: m.code,
        name: { mr: m.nameMr, en: m.nameEn },
        description: { mr: m.descriptionMr, en: m.descriptionEn },
        elective: m.isElective,
        displayOrder: m.displayOrder,
        isActive: m.isActive,
        electives: domains.filter((d) => d.moduleId === m.id).map(toAdminDomain),
      })),
      timeSplit: toTimeSplit(settings),
      learningPath: toLearningPath(settings),
      isPublished: settings.isPublished,
      createdAt: settings.createdAt,
      updatedAt: settings.updatedAt,
    };
  }

  /*
   * What the website reads. Returns null — not an error — when the page is unpublished or has never
   * been configured, because "there is nothing to show" is a normal state the site handles by
   * rendering its own bundled copy.
   */
  async getPublic(): Promise<PublicModulesPage | null> {
    const settings = await modulesRepository.findSettings();
    if (!settings || !settings.isPublished || !settings.isActive) return null;

    const modules = await modulesRepository.findModules(settings.id, { activeOnly: true });
    const domains = await modulesRepository.findElectives(
      modules.map((m) => m.id),
      { activeOnly: true },
    );

    return {
      modules: modules.map((m) => ({
        no: m.no,
        code: m.code,
        name: { mr: m.nameMr, en: m.nameEn },
        description: { mr: m.descriptionMr, en: m.descriptionEn },
        elective: m.isElective,
        electives: domains
          .filter((d) => d.moduleId === m.id)
          .map((d) => ({
            no: d.no,
            domain: { mr: d.domainMr, en: d.domainEn },
            certificate: d.certificate,
          })),
      })),
      timeSplit: toTimeSplit(settings),
      learningPath: toLearningPath(settings),
    };
  }

  /*
   * Replaces the whole page in one transaction: the numbers, the module cards and every module's
   * domains commit together or not at all, so the page is never served half-updated.
   *
   * Modules are matched by CODE, which is what identifies a module across the programme — renaming
   * a module keeps its row, and a code absent from the payload is retired along with its domains.
   * A module's domains are rewritten wholesale: merging two lists row by row would leave an
   * administrator unable to remove a domain, and each list is short.
   */
  async update(input: UpdateModulesPageInput, req?: Request): Promise<AdminModulesPage> {
    const { timeSplit, learningPath } = input;

    if (timeSplit.trainingHours + timeSplit.assessmentHours !== timeSplit.moduleHours) {
      throw AppError.badRequest('Training and assessment hours must add up to the module total', [
        { field: 'timeSplit.moduleHours', message: 'Hours do not add up' },
      ]);
    }
    if (learningPath.fixedPathPct + learningPath.selfPathPct !== 100) {
      throw AppError.badRequest('The learning-path shares must add up to 100', [
        { field: 'learningPath.fixedPathPct', message: 'Shares do not total 100' },
      ]);
    }

    await AppDataSource.transaction(async (m) => {
      const settings = await modulesRepository.findSettings(m);
      if (!settings) throw AppError.notFound(NOT_CONFIGURED);

      await modulesRepository.update(
        settings.id,
        {
          moduleHours: timeSplit.moduleHours,
          trainingHours: timeSplit.trainingHours,
          assessmentHours: timeSplit.assessmentHours,
          weeksPerModule: timeSplit.weeksPerModule,
          daysPerWeek: timeSplit.daysPerWeek,
          hoursPerDay: timeSplit.hoursPerDay,
          weeklyAssessmentHours: String(timeSplit.weeklyAssessmentHours),
          sessionLengthMr: learningPath.sessionLength.mr,
          sessionLengthEn: learningPath.sessionLength.en,
          sessionLabelMr: learningPath.sessionLabel.mr,
          sessionLabelEn: learningPath.sessionLabel.en,
          fixedPathPct: learningPath.fixedPathPct,
          selfPathPct: learningPath.selfPathPct,
          ...(input.isPublished === undefined ? {} : { isPublished: input.isPublished }),
        },
        m,
      );

      const moduleRepo = modulesRepository.modules(m);
      const domainRepo = modulesRepository.electives(m);
      const existingModules = await modulesRepository.findModules(settings.id, { manager: m });
      const byCode = new Map(existingModules.map((x) => [x.code.toUpperCase(), x]));
      const seenCodes = new Set<string>();

      for (const [index, item] of input.modules.entries()) {
        const code = item.code.trim().toUpperCase();
        if (seenCodes.has(code)) {
          throw AppError.badRequest(`Duplicate module code ${item.code}`, [{ field: `modules.${index}.code`, message: 'Duplicate code' }]);
        }
        seenCodes.add(code);

        const domains = item.electives ?? [];

        const seenNumbers = new Set<number>();
        for (const [k, d] of domains.entries()) {
          if (seenNumbers.has(d.no)) {
            throw AppError.badRequest(`Duplicate domain number ${d.no} in ${item.code}`, [
              { field: `modules.${index}.electives.${k}.no`, message: 'Duplicate number' },
            ]);
          }
          seenNumbers.add(d.no);
        }

        const current = byCode.get(code);
        let moduleId: string;
        if (current) {
          await moduleRepo.update(current.id, toModuleColumns(item, index));
          moduleId = current.id;
        } else {
          const created = await moduleRepo.save(moduleRepo.create({ settingsId: settings.id, ...toModuleColumns(item, index) }));
          moduleId = created.id;
        }

        /* Retire this module's current domains, then write the submitted list. */
        await domainRepo.update({ moduleId }, { isDelete: true, isActive: false });
        for (const [order, d] of domains.entries()) {
          await domainRepo.insert({ moduleId, ...toDomainColumns(d, order) });
        }
      }

      /* A module the payload no longer carries is retired, and its domains with it. */
      const retired = existingModules.filter((x) => !seenCodes.has(x.code.toUpperCase()));
      for (const x of retired) {
        await domainRepo.update({ moduleId: x.id }, { isDelete: true, isActive: false });
        await moduleRepo.update(x.id, { isDelete: true, isActive: false });
      }

      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.MODULES_PAGE_UPDATE,
        resource: 'modules-page',
        resourceId: settings.id,
        details: {
          isPublished: input.isPublished ?? settings.isPublished,
          modules: input.modules.map((x) => x.code),
          retired: retired.map((x) => x.code),
          domains: Object.fromEntries(input.modules.map((x) => [x.code, x.electives?.length ?? 0])),
        },
      });
    });

    return this.getForAdmin();
  }

  /* Publish / unpublish on its own, so visibility can be changed without resubmitting the content. */
  async setPublished(isPublished: boolean, req?: Request): Promise<AdminModulesPage> {
    await AppDataSource.transaction(async (m) => {
      const settings = await modulesRepository.findSettings(m);
      if (!settings) throw AppError.notFound(NOT_CONFIGURED);

      await modulesRepository.update(settings.id, { isPublished }, m);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.MODULES_PAGE_STATUS,
        resource: 'modules-page',
        resourceId: settings.id,
        details: { isPublished },
      });
    });
    return this.getForAdmin();
  }
}

export const modulesService = new ModulesService();
