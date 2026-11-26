import type { Request } from 'express';
import { In, type EntityManager, type EntityTarget, type FindOptionsWhere } from 'typeorm';
import { AppDataSource } from '../../config/database.config';
import { AUDIT_ACTIONS } from '../../shared/constants/app.constants';
import { auditService } from '../../modules/audit';
import type { AppBaseEntity } from '../../database/base.entity';
import { AppError } from '../../shared/errors/app-error';
import type { Paginated } from '../../shared/utils/pagination';
import type { GeoOption } from '../../cms/masters/geography/geography.types';
import { District } from '../../cms/masters/district/district.model';
import { State } from '../../cms/masters/state/state.model';
import { Taluka } from '../../cms/masters/taluka/taluka.model';
import { assertUsableRef } from '../shared/master-refs';
import { Centre, CentreTechnology } from './centre.model';
import { centreRepository, usableTrackSql } from './centre.repository';
import type {
  CentreActor,
  CentreListQuery,
  CentreTechnologyRef,
  CreateCentreInput,
  PublicCentreDetail,
  UpdateCentreInput,
} from './centre.types';
import { assertNoDependencies } from '../../shared/dependencies/dependencies';
import { CENTRE_DEPENDENCIES } from '../masters.dependencies';

/* Requires the district, state and taluka relations to be joined. */
const toPublic = (c: Centre, technologies: CentreTechnologyRef[]): PublicCentreDetail => ({
  id: c.id,
  name: c.name,
  code: c.code,
  stateId: c.district.stateId,
  stateName: c.district.state.name,
  stateCode: c.district.state.code,
  stateIsActive: c.district.state.isActive,
  districtId: c.districtId,
  districtName: c.district.name,
  districtCode: c.district.code,
  districtIsActive: c.district.isActive,
  talukaId: c.talukaId,
  talukaName: c.taluka?.name ?? null,
  talukaCode: c.taluka?.code ?? null,
  talukaIsActive: c.taluka ? c.taluka.isActive : null,
  address: c.address,
  pinCode: c.pinCode,
  contactPerson: c.contactPerson,
  contactNumber: c.contactNumber,
  email: c.email,
  technologies,
  isActive: c.isActive,
  createdAt: c.createdAt,
  updatedAt: c.updatedAt,
});

async function assertFilterParent<T extends AppBaseEntity>(
  target: EntityTarget<T>,
  id: string,
  field: string,
  label: string,
): Promise<void> {
  const found = await AppDataSource.manager.getRepository(target).exists({ where: { id, isDelete: false } as FindOptionsWhere<T> });
  if (!found) throw AppError.badRequest(`The selected ${label} does not exist`, [{ field, message: `Unknown ${label}` }]);
}

/* An EDP tracking panel admin is not an Amrut admin panel user: recorded in the details, not as the actor. */
const actorDetails = (actor?: CentreActor) => (actor?.edpAdminId ? { edpAdminId: actor.edpAdminId } : {});
const actorUser = (actor?: CentreActor) => (actor?.edpAdminId ? { actorUserId: null } : {});

/*
 * Center Master, shared by the Amrut admin panel (/cms/centres) and the EDP tracking panel (/edp/manage/centres).
 *
 * The College Master's rules: district (and the optional taluka of that district) re-checked on the server, the
 * state only cross-checks the district, name unique within the district, code unique overall.
 *
 * Each centre offers Technology / 3rd module selections (technology_tracks, T01–T12) through edp_centre_technologies.
 * A technology added to a centre must be active; one deactivated later may stay allocated (shown as not usable, and
 * students cannot choose it) until it is removed. The EDP portal re-checks a student's centre and technology against
 * these rows on every step completion and on submission.
 */
export class CentreService {
  private async withTechnologies(centres: Centre[], m?: EntityManager): Promise<PublicCentreDetail[]> {
    const technologies = await centreRepository.technologiesOf(
      centres.map((c) => c.id),
      m,
    );
    return centres.map((c) => toPublic(c, technologies.get(c.id) ?? []));
  }

  async list(q: CentreListQuery): Promise<Paginated<PublicCentreDetail>> {
    if (q.stateId) await assertFilterParent(State, q.stateId, 'stateId', 'state');
    if (q.districtId) await assertFilterParent(District, q.districtId, 'districtId', 'district');
    const page = await centreRepository.list(q);
    return { items: await this.withTechnologies(page.items), meta: page.meta };
  }

  async get(id: string): Promise<PublicCentreDetail> {
    const centre = await centreRepository.findByIdWithParents(id);
    if (!centre) throw AppError.notFound('Center not found');
    return (await this.withTechnologies([centre]))[0];
  }

  async options(): Promise<GeoOption[]> {
    const rows = await centreRepository.findSelectable();
    return rows.map((c) => ({ id: c.id, name: c.name, code: c.code }));
  }

  /* Active centres for the EDP portal's dropdown, with their district's name. */
  async portalOptions(): Promise<{ id: string; name: string; code: string; district_name: string }[]> {
    const rows = await centreRepository.findSelectable();
    return rows.map((c) => ({ id: c.id, name: c.name, code: c.code, district_name: c.district.name }));
  }

  /* The technologies an allocation may add (what the centre form's checklist offers). */
  technologyOptions(): Promise<{ code: string; name: string }[]> {
    return centreRepository.allocatableTechnologies();
  }

  /*
   * What a student may choose at a centre: the usable allocated technologies of an ACTIVE centre. Unknown, deleted or
   * inactive centre → null (the caller answers 404 / a field error).
   */
  async studentTechnologies(centreId: string): Promise<{ code: string; name: string }[] | null> {
    const centre = await centreRepository.findOne({ id: centreId, isActive: true });
    if (!centre) return null;
    const technologies = (await centreRepository.technologiesOf([centreId])).get(centreId) ?? [];
    return technologies.filter((t) => t.usable).map(({ code, name }) => ({ code, name }));
  }

  /* The centre-and-technology pair a student chose, as it stands now: field errors when either is no longer valid. */
  async checkStudentChoice(centreId: string, technology: string): Promise<{ field: string; message: string }[]> {
    const technologies = await this.studentTechnologies(centreId);
    if (!technologies) return [{ field: 'body.centre_id', message: 'Center not found or inactive' }];
    if (!technologies.some((t) => t.code === technology))
      return [{ field: 'body.technology', message: 'This technology is not offered at the selected center' }];
    return [];
  }

  private assertDistrictInState(district: District, stateId: string | undefined): void {
    if (stateId && district.stateId !== stateId) {
      throw AppError.badRequest('The selected district does not belong to the selected state', [
        { field: 'districtId', message: 'Choose a district of the selected state' },
      ]);
    }
  }

  private async assertTalukaInDistrict(talukaId: string, districtId: string, m: EntityManager): Promise<Taluka> {
    const taluka = await assertUsableRef(m, Taluka, talukaId, 'talukaId', 'taluka');
    if (taluka.districtId !== districtId) {
      throw AppError.badRequest('The selected taluka does not belong to the selected district', [
        { field: 'talukaId', message: 'Choose a taluka of the selected district' },
      ]);
    }
    return taluka;
  }

  private async assertUnique(
    districtId: string,
    input: { name?: string; code?: string },
    excludeId: string | undefined,
    m: EntityManager,
  ): Promise<void> {
    if (input.name && (await centreRepository.findByNameInDistrict(districtId, input.name, { excludeId, manager: m }))) {
      throw AppError.conflict('A center with this name already exists in the selected district');
    }
    if (input.code && (await centreRepository.findByCode(input.code, { excludeId, manager: m }))) {
      throw AppError.conflict('A center with this code already exists');
    }
  }

  /*
   * Makes the centre's allocation exactly `codes` (track codes). Added technologies must be active (read FOR SHARE, so
   * a concurrent deactivation waits); removed allocations are soft-deleted. Returns what changed, for the audit.
   */
  private async setTechnologies(centreId: string, codes: string[], m: EntityManager): Promise<{ added: string[]; removed: string[] }> {
    const current = await centreRepository.allocations(centreId, m);
    const have = new Set(current.map((a) => a.code));
    const added = codes.filter((c) => !have.has(c));
    const removed = current.filter((a) => !codes.includes(a.code));
    if (added.length) {
      const ok: { id: string; code: string }[] = await m.query(
        `SELECT tt."id", tt."code" FROM "technology_tracks" tt WHERE tt."code" = ANY($1::varchar[]) AND ${usableTrackSql('tt')} FOR SHARE`,
        [added],
      );
      if (ok.length !== added.length)
        throw AppError.badRequest('A selected technology is not available', [
          { field: 'technologyCodes', message: 'Choose active technologies from the list only' },
        ]);
      await m.getRepository(CentreTechnology).insert(ok.map((t) => ({ centreId, technologyTrackId: t.id })));
    }
    if (removed.length)
      await m.getRepository(CentreTechnology).update({ id: In(removed.map((r) => r.id)) }, { isDelete: true, isActive: false });
    return { added, removed: removed.map((r) => r.code) };
  }

  async create(input: CreateCentreInput, req?: Request, actor?: CentreActor): Promise<PublicCentreDetail> {
    const id = await AppDataSource.transaction(async (m) => {
      const district = await assertUsableRef(m, District, input.districtId, 'districtId', 'district');
      this.assertDistrictInState(district, input.stateId);
      if (input.talukaId) await this.assertTalukaInDistrict(input.talukaId, district.id, m);
      await this.assertUnique(district.id, input, undefined, m);
      const centre = await centreRepository.create(
        {
          name: input.name,
          code: input.code,
          districtId: district.id,
          talukaId: input.talukaId ?? null,
          address: input.address ?? null,
          pinCode: input.pinCode ?? null,
          contactPerson: input.contactPerson ?? null,
          contactNumber: input.contactNumber ?? null,
          email: input.email ?? null,
          isActive: input.isActive ?? true,
        },
        m,
      );
      const technologies = await this.setTechnologies(centre.id, input.technologyCodes ?? [], m);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.CENTRE_CREATE,
        resource: 'centre',
        resourceId: centre.id,
        ...actorUser(actor),
        details: {
          name: centre.name,
          code: centre.code,
          districtId: district.id,
          talukaId: centre.talukaId,
          isActive: centre.isActive,
          technologyCodes: technologies.added,
          ...actorDetails(actor),
        },
      });
      return centre.id;
    });
    return this.get(id);
  }

  async update(id: string, input: UpdateCentreInput, req?: Request, actor?: CentreActor): Promise<PublicCentreDetail> {
    await AppDataSource.transaction(async (m) => {
      /* Locked: two concurrent allocation edits of one centre run one after the other. */
      const centre = await m.getRepository(Centre).findOne({ where: { id, isDelete: false }, lock: { mode: 'pessimistic_write' } });
      if (!centre) throw AppError.notFound('Center not found');

      const districtId = input.districtId ?? centre.districtId;
      const moved = districtId !== centre.districtId;
      if (moved) {
        const district = await assertUsableRef(m, District, districtId, 'districtId', 'district');
        this.assertDistrictInState(district, input.stateId);
      } else if (input.stateId) {
        const district = await m.getRepository(District).findOne({ where: { id: districtId } });
        if (district) this.assertDistrictInState(district, input.stateId);
      }
      if (moved && input.talukaId === undefined && centre.talukaId) {
        throw AppError.badRequest('Choose a taluka of the new district, or none, when moving the center', [
          { field: 'talukaId', message: 'Choose a taluka of the selected district, or none' },
        ]);
      }
      const talukaId = input.talukaId === undefined ? centre.talukaId : input.talukaId;
      if (talukaId && (moved || talukaId !== centre.talukaId)) await this.assertTalukaInDistrict(talukaId, districtId, m);
      await this.assertUnique(districtId, { name: input.name ?? (moved ? centre.name : undefined), code: input.code }, id, m);

      const { stateId: _stateId, technologyCodes, ...columns } = input;
      await centreRepository.update(id, { ...columns, districtId, talukaId }, m);
      const technologies = technologyCodes ? await this.setTechnologies(id, technologyCodes, m) : undefined;
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.CENTRE_UPDATE,
        resource: 'centre',
        resourceId: id,
        ...actorUser(actor),
        details: {
          fields: Object.keys(columns),
          from: { name: centre.name, code: centre.code },
          movedDistrict: moved ? { from: centre.districtId, to: districtId } : undefined,
          technologies,
          ...actorDetails(actor),
        },
      });
    });
    return this.get(id);
  }

  /*
   * Deactivation is never blocked: an inactive centre stops being offered, and a student who had chosen it is asked
   * to choose again (step 2 completion and submission re-check the centre).
   */
  async setStatus(id: string, isActive: boolean, req?: Request, actor?: CentreActor): Promise<PublicCentreDetail> {
    await AppDataSource.transaction(async (m) => {
      const centre = await centreRepository.findById(id, { manager: m });
      if (!centre) throw AppError.notFound('Center not found');
      await centreRepository.update(id, { isActive }, m);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.CENTRE_STATUS,
        resource: 'centre',
        resourceId: id,
        ...actorUser(actor),
        details: { isActive, name: centre.name, ...actorDetails(actor) },
      });
    });
    return this.get(id);
  }

  /*
   * Soft-deletes a centre no registration or EDP draft refers to. A referenced centre is kept for its history:
   * 409, deactivate it instead.
   */
  async remove(id: string, req?: Request): Promise<void> {
    await AppDataSource.transaction(async (m) => {
      const centre = await m.getRepository(Centre).findOne({ where: { id, isDelete: false }, lock: { mode: 'pessimistic_write' } });
      if (!centre) throw AppError.notFound('Center not found');
      /* Student registrations and EDP applications that chose it (masters.dependencies.ts). */
      await assertNoDependencies(CENTRE_DEPENDENCIES, id, m);
      await centreRepository.softDelete(id, m);
      await m.getRepository(CentreTechnology).update({ centreId: id, isDelete: false }, { isDelete: true, isActive: false });
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.CENTRE_DELETE,
        resource: 'centre',
        resourceId: id,
        details: { name: centre.name, code: centre.code },
      });
    });
  }

  /* Brings a soft-deleted centre back, inactive and without technologies (they are allocated again on edit). */
  async restore(id: string, req?: Request): Promise<PublicCentreDetail> {
    await AppDataSource.transaction(async (m) => {
      const existing = await centreRepository.findByIdIncludingDeleted(id, m);
      if (!existing) throw AppError.notFound('Center not found');
      if (!existing.isDelete) throw AppError.conflict('Center is not deleted');
      await assertUsableRef(m, District, existing.districtId, 'districtId', 'district');
      if (existing.talukaId) await this.assertTalukaInDistrict(existing.talukaId, existing.districtId, m);
      await this.assertUnique(existing.districtId, { name: existing.name, code: existing.code }, id, m);
      await centreRepository.restore(id, m);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.CENTRE_RESTORE,
        resource: 'centre',
        resourceId: id,
        details: { name: existing.name },
      });
    });
    return this.get(id);
  }
}

export const centreService = new CentreService();
