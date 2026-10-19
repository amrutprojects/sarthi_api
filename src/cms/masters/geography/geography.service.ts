import { districtRepository } from '../district/district.repository';
import { stateRepository } from '../state/state.repository';
import { talukaRepository } from '../taluka/taluka.repository';
import { AppError } from '../../../utils/app-error';
import type { DistrictOption, GeoOption, TalukaOption } from './geography.types';

/*
 * Read-only geography feed: the cascading State -> District -> Taluka options.
 *
 * One implementation serves two callers, so the admin panel and the public website can never drift:
 * - the admin CMS forms, through /api/v1/cms/states/:stateId/districts and
 *   /api/v1/cms/districts/:districtId/talukas (permission-guarded);
 * - the public website, through /api/v1/public/geography/* (unauthenticated).
 *
 * Only active, non-deleted rows are ever returned, so a record deactivated in the CMS disappears from
 * every form immediately. A parent that does not exist (or has been deleted) is a 404 rather than an
 * empty list, so a broken link is never mistaken for "no districts here".
 *
 * An inactive parent is allowed and simply lists its own active children: that keeps an edit form
 * loadable for a record whose parent was deactivated after it was created. Attaching a NEW child to an
 * inactive parent is refused by the write path (assertUsableState / assertUsable), not here.
 */
export class GeographyService {
  async states(): Promise<GeoOption[]> {
    const rows = await stateRepository.findSelectable();
    return rows.map((s) => ({ id: s.id, name: s.name, code: s.code }));
  }

  async districtsOfState(stateId: string): Promise<DistrictOption[]> {
    if (!(await stateRepository.findById(stateId))) throw AppError.notFound('State not found');
    const rows = await districtRepository.findSelectable(stateId);
    return rows.map((d) => ({ id: d.id, name: d.name, code: d.code, stateId: d.stateId }));
  }

  async talukasOfDistrict(districtId: string): Promise<TalukaOption[]> {
    if (!(await districtRepository.findById(districtId))) throw AppError.notFound('District not found');
    const rows = await talukaRepository.findSelectable(districtId);
    return rows.map((t) => ({ id: t.id, name: t.name, code: t.code, districtId: t.districtId }));
  }
}

export const geographyService = new GeographyService();
