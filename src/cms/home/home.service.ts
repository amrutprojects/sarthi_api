import type { Request } from 'express';
import { AppDataSource } from '../../config/database.config';
import { AUDIT_ACTIONS } from '../../shared/constants/app.constants';
import { auditService } from '../../modules/audit/audit.service';
import { AppError } from '../../shared/errors/app-error';
import { modulesRepository } from '../modules/modules.repository';
import type { AdminHomeGlance, UpdateHomeGlanceInput } from './home.types';

const NOT_CONFIGURED =
  'The programme content has not been configured yet. Run the database seed to create it.';

/*
 * The home page's "Programme at a glance" card (CMS).
 *
 * This folder owns NO TABLE. The card is three figures summed from the modules plus one stored
 * number, and all four live in the programme content that src/cms/modules manages — so this is a
 * view onto that, given its own menu because an administrator looking for "the home page figures"
 * should not have to know they are kept with the Modules page.
 *
 * It reads through modulesRepository rather than duplicating the queries, which is what keeps the
 * figures here identical to the ones the website computes.
 */
export class HomeService {
  async getForAdmin(): Promise<AdminHomeGlance> {
    const settings = await modulesRepository.findSettings();
    if (!settings) throw AppError.notFound(NOT_CONFIGURED);

    const all = await modulesRepository.findModules(settings.id);
    /* Only active modules reach the website, so only those count towards what it prints. */
    const live = all.filter((m) => m.isActive);
    const domains = await modulesRepository.findElectives(
      live.map((m) => m.id),
      { activeOnly: true },
    );

    const hours = live.map((m) => m.moduleHours);
    const uniform = hours.length > 0 && hours.every((h) => h === hours[0]);

    return {
      totalHours: hours.reduce((a, b) => a + b, 0),
      modules: live.length,
      domains: new Set(domains.map((d) => d.no)).size,
      districtCount: settings.districtCount,
      modulesLabel: uniform ? `${live.length} × ${hours[0]} hours` : String(live.length),
      hiddenModules: all.length - live.length,
      updatedAt: settings.updatedAt,
    };
  }

  /*
   * Only the district count is writable. The other three are summed from the modules, so there is
   * nothing here to write them to — changing them means changing the modules.
   */
  async update(input: UpdateHomeGlanceInput, req?: Request): Promise<AdminHomeGlance> {
    await AppDataSource.transaction(async (m) => {
      const settings = await modulesRepository.findSettings(m);
      if (!settings) throw AppError.notFound(NOT_CONFIGURED);

      await modulesRepository.update(settings.id, { districtCount: input.districtCount }, m);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.HOME_GLANCE_UPDATE,
        resource: 'home-glance',
        resourceId: settings.id,
        details: { districtCount: input.districtCount },
      });
    });

    return this.getForAdmin();
  }
}

export const homeService = new HomeService();
