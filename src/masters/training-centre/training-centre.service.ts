import type { Request } from 'express';
import type { EntityManager, EntityTarget, FindOptionsWhere } from 'typeorm';
import { AppDataSource } from '../../config/database.config';
import type { AppBaseEntity } from '../../database/base.entity';
import { AUDIT_ACTIONS } from '../../shared/constants/app.constants';
import { auditService } from '../../modules/audit';
import { CENTRES } from '../../modules/students';
import { AppError } from '../../shared/errors/app-error';
import type { Paginated } from '../../shared/utils/pagination';
import type { GeoOption } from '../geography/geography.types';
import { Batch } from '../batch/batch.model';
import { CentreInfrastructure } from '../centre-infrastructure/centre-infrastructure.model';
import { CentreLocation } from '../centre-location/centre-location.model';
import { CentreType } from '../centre-type/centre-type.model';
import { District } from '../district/district.model';
import { MasterDocument } from '../document/document.model';
import { State } from '../state/state.model';
import { Taluka } from '../taluka/taluka.model';
import { assertNoRefs, assertUsableRef, countRefs, lockForUpdate } from '../shared/master-refs';
import { TrainingCentre } from './training-centre.model';
import { trainingCentreRepository } from './training-centre.repository';
import type {
  CentreCodeSuggestion, CreateTrainingCentreInput, PublicTrainingCentreDetail, TrainingCentreListQuery,
  TrainingCentreOptionalColumns, TrainingCentreRelated, UpdateTrainingCentreInput,
} from './training-centre.types';

/* Requires district + state (inner) and centre type + taluka (left) to be joined, as every read path does. */
const toPublic = (c: TrainingCentre): PublicTrainingCentreDetail => ({
  id: c.id,
  name: c.name,
  code: c.code,
  centreTypeId: c.centreTypeId,
  centreTypeName: c.centreType?.name ?? null,
  centreTypeCode: c.centreType?.code ?? null,
  centreTypeIsActive: c.centreType ? c.centreType.isActive : null,
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
  contactNumber: c.contactNumber,
  email: c.email,
  pocName: c.pocName,
  pocMobile: c.pocMobile,
  centreHead: c.centreHead,
  alternativeContact: c.alternativeContact,
  coordinator1: c.coordinator1,
  coordinator2: c.coordinator2,
  isActive: c.isActive,
  createdAt: c.createdAt,
  updatedAt: c.updatedAt,
});

/* The optional columns of sections A–B, in the order the profile lists them. */
const OPTIONAL_COLUMNS = [
  'centreTypeId', 'talukaId', 'contactNumber', 'email', 'pocName', 'pocMobile', 'centreHead', 'alternativeContact', 'coordinator1',
  'coordinator2',
] as const satisfies readonly (keyof TrainingCentreOptionalColumns)[];

const CODE_LOCKED = 'The centre code cannot change because batches use this centre';

/*
 * Training Centre master — Training Centre Profile sections A (basic information) and B (centre
 * management), AMRUT_KALASH_02 Table 32.
 *
 * - A centre stores districtId (compulsory) and optionally talukaId; the state is derived through the
 *   district. A taluka must belong to the centre's district, and moving the centre to another district
 *   requires the taluka to be re-chosen (or cleared) in the same request.
 * - The name is unique within the district (case-insensitive); the code is unique among non-deleted
 *   centres. A blank code is generated as TC + 4 digits from training_centre_code_seq.
 * - The code is frozen once a batch uses the centre: batch codes (AMK-B-{centreCode}-NNN) are derived
 *   from it. Nothing derives the students' preferred-centre codes from it: those come from the student
 *   import (CENTRES in the students module, e.g. NAS for Nashik), and Assign Batch only compares them with
 *   the batch's centre code, asking for a reason when they differ. A centre that serves one of those
 *   course centres should therefore use its code; codeSuggestions() offers that list to the form.
 * - Deletion is refused while location, infrastructure, batch or document records reference the centre.
 *   Deactivation is always allowed: an inactive centre simply drops out of every dropdown.
 * - remove() and update() lock the centre FOR UPDATE before counting the records that block them, and
 *   child writes read it locked through assertUsableRef (FOR SHARE; batches FOR UPDATE), so a concurrent
 *   child save is either counted or waits and re-reads the centre: no child is left under a deleted
 *   centre, and the code cannot change under a batch being created.
 *
 * Every rule is also enforced by the schema (partial unique indexes, CHECK constraints, RESTRICT foreign
 * keys); the checks here exist to answer with a readable 400 / 409 instead of a constraint violation.
 */
export class TrainingCentreService {
  async list(q: TrainingCentreListQuery): Promise<Paginated<PublicTrainingCentreDetail>> {
    /* A filter naming an unknown parent is a client error, not an empty list that looks like real data. */
    const m = AppDataSource.manager;
    if (q.centreTypeId) await this.assertFilterExists(m, CentreType, q.centreTypeId, 'centreTypeId', 'centre type');
    if (q.stateId) await this.assertFilterExists(m, State, q.stateId, 'stateId', 'state');
    if (q.districtId) await this.assertFilterExists(m, District, q.districtId, 'districtId', 'district');
    const page = await trainingCentreRepository.list(q);
    return { items: page.items.map(toPublic), meta: page.meta };
  }

  async get(id: string): Promise<PublicTrainingCentreDetail> {
    const centre = await trainingCentreRepository.findByIdWithParents(id);
    if (!centre) throw AppError.notFound('Training centre not found');
    return { ...toPublic(centre), related: await this.related(id, AppDataSource.manager) };
  }

  /* Dropdown feed: active, non-deleted centres, A to Z. */
  async options(): Promise<GeoOption[]> {
    const rows = await trainingCentreRepository.findSelectable();
    return rows.map((c) => ({ id: c.id, name: c.name, code: c.code }));
  }

  /*
   * Suggested centre codes for the form: the student-import course centres (code + name, e.g. NAS /
   * Nashik). A student's preferred centre is always one of these codes, and Assign Batch asks for a reason
   * whenever it differs from the batch's centre code, so a centre serving one of them should use its code.
   */
  codeSuggestions(): CentreCodeSuggestion[] {
    return CENTRES.map((c) => ({ code: c.code, name: c.name }));
  }

  /* The records that hang off a centre (non-deleted). Shown on the detail page; they also block deletion. */
  private async related(id: string, m: EntityManager): Promise<TrainingCentreRelated> {
    const [locations, infrastructure, batchCount, documentCount] = await Promise.all([
      countRefs(m, CentreLocation, 'centreId', id),
      countRefs(m, CentreInfrastructure, 'centreId', id),
      countRefs(m, Batch, 'centreId', id),
      countRefs(m, MasterDocument, 'centreId', id),
    ]);
    return { hasLocation: locations > 0, hasInfrastructure: infrastructure > 0, batchCount, documentCount };
  }

  private async assertFilterExists<T extends AppBaseEntity>(
    m: EntityManager,
    target: EntityTarget<T>,
    id: string,
    field: string,
    label: string,
  ): Promise<void> {
    const found = await m.getRepository(target).exists({ where: { id, isDelete: false } as FindOptionsWhere<T> });
    if (!found) throw AppError.badRequest(`The selected ${label} does not exist`, [{ field, message: `Unknown ${label}` }]);
  }

  /*
   * `stateId` is what the form had selected in its first dropdown. It is optional and never stored —
   * it only rejects a district of another state, which catches a stale or tampered-with cascade.
   */
  private assertDistrictInState(district: District, stateId: string | undefined): void {
    if (stateId && district.stateId !== stateId) {
      throw AppError.badRequest('The selected district does not belong to the selected state', [
        { field: 'districtId', message: 'Choose a district of the selected state' },
      ]);
    }
  }

  /* The taluka must be usable and lie in the centre's district. */
  private async assertTalukaInDistrict(talukaId: string, districtId: string, m: EntityManager): Promise<void> {
    const taluka = await assertUsableRef(m, Taluka, talukaId, 'talukaId', 'taluka');
    if (taluka.districtId !== districtId) {
      throw AppError.badRequest('The selected taluka does not belong to the selected district', [
        { field: 'talukaId', message: 'Choose a taluka of the selected district' },
      ]);
    }
  }

  private async assertUniqueName(districtId: string, name: string | undefined, excludeId: string | undefined, m: EntityManager): Promise<void> {
    if (name && (await trainingCentreRepository.findByNameInDistrict(districtId, name, { excludeId, manager: m }))) {
      throw AppError.conflict('A training centre with this name already exists in the selected district');
    }
  }

  private async assertUniqueCode(code: string | undefined, excludeId: string | undefined, m: EntityManager): Promise<void> {
    if (code && (await trainingCentreRepository.findByCode(code, { excludeId, manager: m }))) {
      throw AppError.conflict('A training centre with this code already exists');
    }
  }

  async create(input: CreateTrainingCentreInput, req?: Request): Promise<PublicTrainingCentreDetail> {
    const id = await AppDataSource.transaction(async (m) => {
      const district = await assertUsableRef(m, District, input.districtId, 'districtId', 'district');
      this.assertDistrictInState(district, input.stateId);
      if (input.talukaId) await this.assertTalukaInDistrict(input.talukaId, district.id, m);
      if (input.centreTypeId) await assertUsableRef(m, CentreType, input.centreTypeId, 'centreTypeId', 'centre type');
      await this.assertUniqueName(district.id, input.name, undefined, m);

      let code = input.code ?? null;
      if (code) await this.assertUniqueCode(code, undefined, m);
      else code = await trainingCentreRepository.nextGeneratedCode(m);

      const centre = await trainingCentreRepository.create(
        {
          name: input.name,
          code,
          districtId: district.id,
          centreTypeId: input.centreTypeId ?? null,
          talukaId: input.talukaId ?? null,
          contactNumber: input.contactNumber ?? null,
          email: input.email ?? null,
          pocName: input.pocName ?? null,
          pocMobile: input.pocMobile ?? null,
          centreHead: input.centreHead ?? null,
          alternativeContact: input.alternativeContact ?? null,
          coordinator1: input.coordinator1 ?? null,
          coordinator2: input.coordinator2 ?? null,
          isActive: input.isActive ?? true,
        },
        m,
      );
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.TRAINING_CENTRE_CREATE,
        resource: 'training-centre',
        resourceId: centre.id,
        details: {
          name: centre.name,
          code: centre.code,
          codeGenerated: !input.code,
          districtId: district.id,
          districtCode: district.code,
          isActive: centre.isActive,
        },
      });
      return centre.id;
    });
    return this.get(id);
  }

  async update(id: string, input: UpdateTrainingCentreInput, req?: Request): Promise<PublicTrainingCentreDetail> {
    await AppDataSource.transaction(async (m) => {
      /*
       * Locked FOR UPDATE before the batch count below: a batch being created at this centre holds the
       * row too, so it is either counted (CODE_LOCKED) or waits and then reads the new code.
       */
      const centre = await lockForUpdate(m, TrainingCentre, id);
      if (!centre) throw AppError.notFound('Training centre not found');

      /* The district the centre will sit in after this update. A move re-checks the district and the name. */
      const districtId = input.districtId ?? centre.districtId;
      const moved = districtId !== centre.districtId;
      if (moved) {
        const district = await assertUsableRef(m, District, districtId, 'districtId', 'district');
        this.assertDistrictInState(district, input.stateId);
        /* The saved taluka belongs to the old district, so it has to be re-chosen (or cleared) explicitly. */
        if (input.talukaId === undefined) {
          throw AppError.badRequest('Choose the taluka again when the district changes', [
            { field: 'talukaId', message: 'Select a taluka of the new district, or leave it empty' },
          ]);
        }
      } else if (input.stateId) {
        /* Unchanged district: only the cross-check, so a deactivated saved district does not block the save. */
        const district = await m.getRepository(District).findOne({ where: { id: districtId } });
        if (district) this.assertDistrictInState(district, input.stateId);
      }

      if (input.talukaId && (moved || input.talukaId !== centre.talukaId)) await this.assertTalukaInDistrict(input.talukaId, districtId, m);
      if (input.centreTypeId && input.centreTypeId !== centre.centreTypeId) {
        await assertUsableRef(m, CentreType, input.centreTypeId, 'centreTypeId', 'centre type');
      }
      await this.assertUniqueName(districtId, input.name ?? (moved ? centre.name : undefined), id, m);

      const codeChanged = input.code !== undefined && input.code !== centre.code;
      if (codeChanged) {
        /* Batch codes (AMK-B-{centreCode}-NNN) are derived from the centre code. */
        if ((await countRefs(m, Batch, 'centreId', id)) > 0) throw AppError.conflict(CODE_LOCKED);
        await this.assertUniqueCode(input.code, id, m);
      }

      /* stateId is a form field used only for the cross-check above, not a column of this table. */
      const columns: TrainingCentreOptionalColumns & { name?: string; code?: string; districtId?: string } = {};
      if (input.name !== undefined) columns.name = input.name;
      if (codeChanged) columns.code = input.code;
      if (moved) columns.districtId = districtId;
      for (const key of OPTIONAL_COLUMNS) if (input[key] !== undefined) columns[key] = input[key];

      if (Object.keys(columns).length) await trainingCentreRepository.update(id, columns, m);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.TRAINING_CENTRE_UPDATE,
        resource: 'training-centre',
        resourceId: id,
        details: {
          fields: Object.keys(columns),
          from: { name: centre.name, code: centre.code },
          movedDistrict: moved ? { from: centre.districtId, to: districtId } : undefined,
        },
      });
    });
    return this.get(id);
  }

  /* Deactivation is never blocked: an inactive centre stops being offered in every dropdown. */
  async setStatus(id: string, isActive: boolean, req?: Request): Promise<PublicTrainingCentreDetail> {
    await AppDataSource.transaction(async (m) => {
      const centre = await trainingCentreRepository.findById(id, { manager: m });
      if (!centre) throw AppError.notFound('Training centre not found');
      await trainingCentreRepository.update(id, { isActive }, m);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.TRAINING_CENTRE_STATUS,
        resource: 'training-centre',
        resourceId: id,
        details: { isActive, name: centre.name, code: centre.code },
      });
    });
    return this.get(id);
  }

  /*
   * Soft-deletes the centre. Refused while any location, infrastructure, batch or document record references
   * it. The row is locked FOR UPDATE before counting, so a record being saved under it concurrently is
   * either counted here or refused by its own locked parent check (assertUsableRef).
   */
  async remove(id: string, req?: Request): Promise<void> {
    await AppDataSource.transaction(async (m) => {
      const centre = await lockForUpdate(m, TrainingCentre, id);
      if (!centre) throw AppError.notFound('Training centre not found');
      assertNoRefs('training centre', [
        { count: await countRefs(m, CentreLocation, 'centreId', id), one: 'location information record' },
        { count: await countRefs(m, CentreInfrastructure, 'centreId', id), one: 'capacity & infrastructure record' },
        { count: await countRefs(m, Batch, 'centreId', id), one: 'batch', many: 'batches' },
        { count: await countRefs(m, MasterDocument, 'centreId', id), one: 'document' },
      ]);
      await trainingCentreRepository.softDelete(id, m);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.TRAINING_CENTRE_DELETE,
        resource: 'training-centre',
        resourceId: id,
        details: { name: centre.name, code: centre.code },
      });
    });
  }

  /*
   * Brings a soft-deleted centre back, inactive. Refused when a parent it names is no longer usable or
   * its name / code has been taken meanwhile.
   */
  async restore(id: string, req?: Request): Promise<PublicTrainingCentreDetail> {
    await AppDataSource.transaction(async (m) => {
      const existing = await trainingCentreRepository.findByIdIncludingDeleted(id, m);
      if (!existing) throw AppError.notFound('Training centre not found');
      if (!existing.isDelete) throw AppError.conflict('Training centre is not deleted');
      await assertUsableRef(m, District, existing.districtId, 'districtId', 'district');
      if (existing.talukaId) await this.assertTalukaInDistrict(existing.talukaId, existing.districtId, m);
      if (existing.centreTypeId) await assertUsableRef(m, CentreType, existing.centreTypeId, 'centreTypeId', 'centre type');
      await this.assertUniqueName(existing.districtId, existing.name, id, m);
      await this.assertUniqueCode(existing.code, id, m);
      await trainingCentreRepository.restore(id, m);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.TRAINING_CENTRE_RESTORE,
        resource: 'training-centre',
        resourceId: id,
        details: { name: existing.name, code: existing.code },
      });
    });
    return this.get(id);
  }
}

export const trainingCentreService = new TrainingCentreService();
