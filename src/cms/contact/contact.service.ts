import type { Request } from 'express';
import { In, type EntityManager } from 'typeorm';
import { AppDataSource } from '../../config/database.config';
import { ERROR_CODES, HTTP_STATUS } from '../../constants/api-response.constants';
import { AUDIT_ACTIONS } from '../../shared/constants/app.constants';
import { auditService } from '../../modules/audit/audit.service';
import { AppError } from '../../shared/errors/app-error';
import type { Paginated } from '../../shared/utils/pagination';
import { District } from '../masters/district/district.model';
import {
  ContactCoordinator,
  ContactCoordinatorDistrict,
  ContactDistrictOffice,
  type ContactOrganization,
  type ContactPageSettings,
  type OrgType,
} from './contact.model';
import { contactRepository } from './contact.repository';
import type {
  AdminContactPage,
  AdminCoordinator,
  AdminDistrictOffice,
  AdminOrganization,
  Bilingual,
  CoordinatorListQuery,
  CreateCoordinatorInput,
  CreateDistrictOfficeInput,
  DistrictOfficeListQuery,
  DistrictRef,
  MoveDistrictsOption,
  PatchCoordinatorInput,
  PatchDistrictOfficeInput,
  PublicContactPage,
  PublicCoordinator,
  PublicDistrictOffice,
  PublicOrganization,
  UpdateContactPageInput,
  UpdateCoordinatorInput,
  UpdateDistrictOfficeInput,
  UpdateOrganizationInput,
} from './contact.types';

const NOT_CONFIGURED = 'The Contact page has not been configured yet. Run the database seed to create it.';
const COORDINATOR_NOT_FOUND = 'Coordinator not found';
const OFFICE_NOT_FOUND = 'District office not found';

/* A 409 that also names the field, so the admin form can show it against the right input. */
const conflict = (message: string, details: { field: string; message: string }[]) =>
  new AppError(HTTP_STATUS.CONFLICT, message, ERROR_CODES.CONFLICT, details);

/* Null when neither half is stored — the two columns are always written together. */
const pair = (mr: string | null, en: string | null): Bilingual | null => (mr !== null && en !== null ? { mr, en } : null);

const toAdminOrganization = (o: ContactOrganization): AdminOrganization => ({
  id: o.id,
  orgType: o.orgType,
  name: { mr: o.nameMr, en: o.nameEn },
  role: pair(o.roleMr, o.roleEn),
  address: pair(o.addressMr, o.addressEn),
  email: o.email,
  phone: o.phone,
  websiteUrl: o.websiteUrl,
  helpdeskHours: pair(o.helpdeskHoursMr, o.helpdeskHoursEn),
  displayOrder: o.displayOrder,
  isActive: o.isActive,
});

/* Only the words the page prints. Absent rather than null, so the website can test for presence. */
const toPublicOrganization = (o: ContactOrganization): PublicOrganization => {
  const role = pair(o.roleMr, o.roleEn);
  const address = pair(o.addressMr, o.addressEn);
  const helpdeskHours = pair(o.helpdeskHoursMr, o.helpdeskHoursEn);
  return {
    orgType: o.orgType,
    name: { mr: o.nameMr, en: o.nameEn },
    ...(role ? { role } : {}),
    ...(address ? { address } : {}),
    ...(o.email ? { email: o.email } : {}),
    ...(o.phone ? { phone: o.phone } : {}),
    ...(o.websiteUrl ? { websiteUrl: o.websiteUrl } : {}),
    ...(helpdeskHours ? { helpdeskHours } : {}),
  };
};

/* Columns for one card. Fields that do not apply to its type are written as NULL, never left stale. */
const toColumns = (input: UpdateOrganizationInput) => ({
  orgType: input.orgType,
  nameMr: input.name.mr,
  nameEn: input.name.en,
  roleMr: input.role?.mr ?? null,
  roleEn: input.role?.en ?? null,
  addressMr: input.address?.mr ?? null,
  addressEn: input.address?.en ?? null,
  email: input.email ?? null,
  phone: input.phone ?? null,
  websiteUrl: input.websiteUrl ?? null,
  helpdeskHoursMr: input.helpdeskHours?.mr ?? null,
  helpdeskHoursEn: input.helpdeskHours?.en ?? null,
  displayOrder: input.displayOrder ?? 0,
  isActive: input.isActive ?? true,
});

const districtRef = (d: District): DistrictRef => ({ id: d.id, name: d.name, code: d.code });

/* The covered districts that still exist, in their saved order (the query already sorts them). */
const coveredDistricts = (c: ContactCoordinator): District[] =>
  (c.districts ?? []).map((cd) => cd.district).filter((d): d is District => Boolean(d));

const toAdminCoordinator = (c: ContactCoordinator): AdminCoordinator => ({
  id: c.id,
  name: c.name,
  phone: c.phone,
  email: c.email,
  districts: coveredDistricts(c).map(districtRef),
  displayOrder: c.displayOrder,
  isActive: c.isActive,
  createdAt: c.createdAt,
  updatedAt: c.updatedAt,
});

const toAdminDistrictOffice = (o: ContactDistrictOffice): AdminDistrictOffice => ({
  id: o.id,
  district: districtRef(o.district),
  collectorName: o.collectorName,
  address: pair(o.addressMr, o.addressEn),
  phone: o.phone,
  email: o.email,
  officeHours: pair(o.officeHoursMr, o.officeHoursEn),
  isActive: o.isActive,
  createdAt: o.createdAt,
  updatedAt: o.updatedAt,
});

const toPublicCoordinator = (c: ContactCoordinator): PublicCoordinator => ({
  name: c.name,
  phone: c.phone,
  ...(c.email ? { email: c.email } : {}),
  districts: coveredDistricts(c).map((d) => ({ code: d.code, name: d.name })),
});

const toPublicDistrictOffice = (o: ContactDistrictOffice): PublicDistrictOffice => {
  const address = pair(o.addressMr, o.addressEn);
  const officeHours = pair(o.officeHoursMr, o.officeHoursEn);
  return {
    district: { code: o.district.code, name: o.district.name },
    ...(o.collectorName ? { collectorName: o.collectorName } : {}),
    ...(address ? { address } : {}),
    ...(o.phone ? { phone: o.phone } : {}),
    ...(o.email ? { email: o.email } : {}),
    ...(officeHours ? { officeHours } : {}),
  };
};

const officeColumns = (input: UpdateDistrictOfficeInput) => ({
  collectorName: input.collectorName || null,
  addressMr: input.address?.mr ?? null,
  addressEn: input.address?.en ?? null,
  phone: input.phone || null,
  email: input.email || null,
  officeHoursMr: input.officeHours?.mr ?? null,
  officeHoursEn: input.officeHours?.en ?? null,
  isActive: input.isActive ?? true,
});

/* The columns an office update changes: only the fields it carries. Null (or a blank name) clears one. */
const officePatchColumns = (input: PatchDistrictOfficeInput) => ({
  ...(input.districtId === undefined ? {} : { districtId: input.districtId }),
  ...(input.collectorName === undefined ? {} : { collectorName: input.collectorName || null }),
  ...(input.address === undefined ? {} : { addressMr: input.address?.mr ?? null, addressEn: input.address?.en ?? null }),
  ...(input.phone === undefined ? {} : { phone: input.phone || null }),
  ...(input.email === undefined ? {} : { email: input.email || null }),
  ...(input.officeHours === undefined
    ? {}
    : { officeHoursMr: input.officeHours?.mr ?? null, officeHoursEn: input.officeHours?.en ?? null }),
  ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
});

/*
 * Contact page content (CMS).
 *
 * The configuration is a singleton enforced by the database, so there is no create endpoint: the row
 * is written once by the seed and edited thereafter. A missing row is therefore a deployment problem
 * (the seed has not run), not something a request should silently repair — the admin read reports it
 * plainly and the public read degrades to "nothing published" so the website shows its own copy.
 *
 * The coordinator and district office sections can also be edited one entry at a time (list, get,
 * create, update, status, soft delete), which is what the admin's per-section pages use; the PUT keeps
 * accepting them as whole lists. Either way every write is audited as a Contact page change.
 *
 * Every rule here is also a database constraint (per-type required fields, one card per type, the
 * single settings row, one coordinator and one live office per district). The checks exist to return a
 * readable 4xx instead of a raw constraint error.
 */
export class ContactService {
  /* The live configuration. Every admin read and write needs it, and its absence is reported plainly. */
  private async requireSettings(m?: EntityManager): Promise<ContactPageSettings> {
    const settings = await contactRepository.findSettings(m);
    if (!settings) throw AppError.notFound(NOT_CONFIGURED);
    return settings;
  }

  /* The configuration an administrator edits, including inactive cards. */
  async getForAdmin(): Promise<AdminContactPage> {
    const settings = await this.requireSettings();
    const [organizations, coordinators, offices] = await Promise.all([
      contactRepository.findOrganizations(settings.id),
      contactRepository.findCoordinators(settings.id),
      contactRepository.findDistrictOffices(settings.id),
    ]);
    return this.toAdmin(settings, organizations, coordinators, offices);
  }

  private toAdmin(
    settings: ContactPageSettings,
    organizations: ContactOrganization[],
    coordinators: ContactCoordinator[],
    offices: ContactDistrictOffice[],
  ): AdminContactPage {
    return {
      id: settings.id,
      pageTitle: { mr: settings.pageTitleMr, en: settings.pageTitleEn },
      pageSubtitle: { mr: settings.pageSubtitleMr, en: settings.pageSubtitleEn },
      isPublished: settings.isPublished,
      createdAt: settings.createdAt,
      updatedAt: settings.updatedAt,
      organizations: organizations.map(toAdminOrganization),
      coordinators: coordinators.map(toAdminCoordinator),
      districtOffices: offices.map(toAdminDistrictOffice),
    };
  }

  /*
   * What the website reads. Returns null — not an error — when the page is unpublished or has never
   * been configured, because "there is nothing to show" is a normal state the site handles by
   * rendering its own bundled copy.
   */
  async getPublic(): Promise<PublicContactPage | null> {
    const settings = await contactRepository.findSettings();
    if (!settings || !settings.isPublished || !settings.isActive) return null;
    const [organizations, coordinators, offices] = await Promise.all([
      contactRepository.findOrganizations(settings.id, { activeOnly: true }),
      contactRepository.findCoordinators(settings.id, { activeOnly: true }),
      contactRepository.findDistrictOffices(settings.id, { activeOnly: true }),
    ]);
    return {
      pageTitle: { mr: settings.pageTitleMr, en: settings.pageTitleEn },
      pageSubtitle: { mr: settings.pageSubtitleMr, en: settings.pageSubtitleEn },
      organizations: organizations.map(toPublicOrganization),
      coordinators: coordinators.map(toPublicCoordinator),
      districtOffices: offices.map(toPublicDistrictOffice),
    };
  }

  /*
   * Replaces the whole configuration in one transaction: the banner and every card commit together
   * or not at all, so the page is never served half-updated.
   *
   * Cards are matched by type. A type present in the payload is updated (or re-created if it had
   * been removed); a type absent from the payload is soft-deleted, which keeps its history and frees
   * the partial unique index for a future card of the same type.
   */
  async update(input: UpdateContactPageInput, req?: Request): Promise<AdminContactPage> {
    await AppDataSource.transaction(async (m) => {
      const settings = await this.requireSettings(m);

      const seen = new Set<OrgType>();
      for (const org of input.organizations) {
        if (seen.has(org.orgType)) {
          throw AppError.badRequest(`Duplicate card for ${org.orgType}: each organisation type may appear once`, [
            { field: 'organizations', message: `Duplicate ${org.orgType}` },
          ]);
        }
        seen.add(org.orgType);
      }

      await contactRepository.update(
        settings.id,
        {
          pageTitleMr: input.pageTitle.mr,
          pageTitleEn: input.pageTitle.en,
          pageSubtitleMr: input.pageSubtitle.mr,
          pageSubtitleEn: input.pageSubtitle.en,
          ...(input.isPublished === undefined ? {} : { isPublished: input.isPublished }),
        },
        m,
      );

      const repo = contactRepository.organizations(m);
      const existing = await contactRepository.findOrganizations(settings.id, { manager: m });
      const byType = new Map(existing.map((o) => [o.orgType, o]));

      for (const org of input.organizations) {
        const current = byType.get(org.orgType);
        if (current) await repo.update(current.id, toColumns(org));
        else await repo.insert({ settingsId: settings.id, ...toColumns(org) });
      }

      /* A card the payload no longer carries is retired, not left behind to reappear on the site. */
      const removed = existing.filter((o) => !seen.has(o.orgType));
      for (const o of removed) await repo.update(o.id, { isDelete: true, isActive: false });

      if (input.coordinators) await this.replaceCoordinators(m, settings.id, input.coordinators);
      if (input.districtOffices) await this.replaceDistrictOffices(m, settings.id, input.districtOffices);

      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.CONTACT_PAGE_UPDATE,
        resource: 'contact-page',
        resourceId: settings.id,
        details: {
          isPublished: input.isPublished ?? settings.isPublished,
          cards: input.organizations.map((o) => o.orgType),
          removed: removed.map((o) => o.orgType),
          ...(input.coordinators ? { coordinators: input.coordinators.length } : {}),
          ...(input.districtOffices ? { districtOffices: input.districtOffices.length } : {}),
        },
      });
    });
    return this.getForAdmin();
  }

  /* Rejects ids that are not live districts. */
  private async assertDistrictsExist(m: EntityManager, ids: string[], field: string): Promise<void> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return;
    const found = await m.getRepository(District).count({ where: { id: In(unique), isDelete: false } });
    if (found !== unique.length) {
      throw AppError.badRequest('One or more selected districts do not exist', [{ field, message: 'Unknown district' }]);
    }
  }

  /*
   * Coordinators are replaced as a list: the previous cards are retired (soft-deleted, their district
   * links removed so the districts are free again) and the submitted ones written in order. A district
   * may be covered by one coordinator only, so the website never has two answers for one district.
   */
  private async replaceCoordinators(m: EntityManager, settingsId: string, input: UpdateCoordinatorInput[]): Promise<void> {
    const owner = new Set<string>();
    input.forEach((c, index) => {
      for (const districtId of new Set(c.districtIds)) {
        if (owner.has(districtId)) {
          throw AppError.badRequest('A district can be assigned to one coordinator only', [
            { field: `coordinators.${index}.districtIds`, message: 'This district is already assigned to another coordinator' },
          ]);
        }
        owner.add(districtId);
      }
    });
    await this.assertDistrictsExist(m, [...owner], 'coordinators');

    const coordinators = m.getRepository(ContactCoordinator);
    const links = m.getRepository(ContactCoordinatorDistrict);
    const existing = await coordinators.find({ where: { settingsId, isDelete: false }, select: { id: true } });
    if (existing.length) {
      const ids = existing.map((c) => c.id);
      await links.delete({ coordinatorId: In(ids) });
      await coordinators.update({ id: In(ids) }, { isDelete: true, isActive: false });
    }

    for (const [index, c] of input.entries()) {
      const saved = await coordinators.save(
        coordinators.create({
          settingsId,
          name: c.name,
          phone: c.phone,
          email: c.email || null,
          displayOrder: c.displayOrder ?? index,
          isActive: c.isActive ?? true,
        }),
      );
      await this.linkDistricts(m, saved.id, [...new Set(c.districtIds)]);
    }
  }

  /* Writes a coordinator's district links in the order given, lead district first. */
  private async linkDistricts(m: EntityManager, coordinatorId: string, districtIds: string[]): Promise<void> {
    if (districtIds.length === 0) return;
    await m
      .getRepository(ContactCoordinatorDistrict)
      .insert(districtIds.map((districtId, displayOrder) => ({ coordinatorId, districtId, displayOrder })));
  }

  /* District offices are matched by district: present ones are updated or created, absent ones retired. */
  private async replaceDistrictOffices(m: EntityManager, settingsId: string, input: UpdateDistrictOfficeInput[]): Promise<void> {
    const seen = new Set<string>();
    input.forEach((o, index) => {
      if (seen.has(o.districtId)) {
        throw AppError.badRequest('Each district may have one office entry only', [
          { field: `districtOffices.${index}.districtId`, message: 'Duplicate district' },
        ]);
      }
      seen.add(o.districtId);
    });
    await this.assertDistrictsExist(m, [...seen], 'districtOffices');

    const repo = m.getRepository(ContactDistrictOffice);
    const existing = await repo.find({ where: { settingsId, isDelete: false } });
    const byDistrict = new Map(existing.map((o) => [o.districtId, o]));

    for (const o of input) {
      const current = byDistrict.get(o.districtId);
      if (current) await repo.update(current.id, officeColumns(o));
      else await repo.insert({ settingsId, districtId: o.districtId, ...officeColumns(o) });
    }
    const removed = existing.filter((o) => !seen.has(o.districtId));
    for (const o of removed) await repo.update(o.id, { isDelete: true, isActive: false });
  }

  /* Publish / unpublish on its own, so visibility can be changed without resubmitting the content. */
  async setPublished(isPublished: boolean, req?: Request): Promise<AdminContactPage> {
    await AppDataSource.transaction(async (m) => {
      const settings = await this.requireSettings(m);
      await contactRepository.update(settings.id, { isPublished }, m);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.CONTACT_PAGE_STATUS,
        resource: 'contact-page',
        resourceId: settings.id,
        details: { isPublished },
      });
    });
    return this.getForAdmin();
  }

  /*
   * Every write to the coordinator and district office sections is audited as a change to the Contact
   * page, naming the section, the operation and the entry.
   */
  private recordSectionChange(
    m: EntityManager,
    req: Request | undefined,
    settingsId: string,
    section: 'coordinators' | 'district-offices',
    op: 'create' | 'update' | 'status' | 'delete',
    id: string,
    movedDistricts: string[] = [],
  ): Promise<void> {
    return auditService.recordInTx(m, req, {
      action: AUDIT_ACTIONS.CONTACT_PAGE_UPDATE,
      resource: 'contact-page',
      resourceId: settingsId,
      details: { section, op, id, ...(movedDistricts.length ? { movedDistricts } : {}) },
    });
  }

  /* ---------------- coordinators, one card at a time ---------------- */

  async listCoordinators(q: CoordinatorListQuery): Promise<Paginated<AdminCoordinator>> {
    const settings = await this.requireSettings();
    const page = await contactRepository.listCoordinators(settings.id, q);
    return { items: page.items.map(toAdminCoordinator), meta: page.meta };
  }

  async getCoordinator(id: string): Promise<AdminCoordinator> {
    const settings = await this.requireSettings();
    const coordinator = await contactRepository.findCoordinator(settings.id, id);
    if (!coordinator) throw AppError.notFound(COORDINATOR_NOT_FOUND);
    return toAdminCoordinator(coordinator);
  }

  private async requireCoordinator(m: EntityManager, settingsId: string, id: string): Promise<ContactCoordinator> {
    const coordinator = await contactRepository.coordinators(m).findOne({ where: { id, settingsId, isDelete: false } });
    if (!coordinator) throw AppError.notFound(COORDINATOR_NOT_FOUND);
    return coordinator;
  }

  /*
   * The districts a coordinator is given: live districts only (400 otherwise), and none already covered
   * by another live coordinator (409 naming the district and its coordinator) — the website must have
   * one answer to "who is the coordinator for this district?".
   *
   * With move = true (the administrator confirmed it) a district another coordinator covers is not refused:
   * it is taken from that coordinator, in the same transaction, so it still has exactly one coordinator.
   * Returns the names of the districts that were moved, for the audit trail.
   */
  private async assertCoordinatorDistricts(
    m: EntityManager,
    districtIds: string[],
    coordinatorId?: string,
    move = false,
  ): Promise<string[]> {
    if (districtIds.length === 0) return [];
    await this.assertDistrictsExist(m, districtIds, 'districtIds');
    const covered = await contactRepository.findCoveredDistricts(districtIds, { excludeId: coordinatorId, manager: m });
    if (covered.length === 0) return [];
    if (move) {
      await m.getRepository(ContactCoordinatorDistrict).delete({ districtId: In(covered.map((cd) => cd.districtId)) });
      return covered.map((cd) => `${cd.district.name} (from ${cd.coordinator.name})`);
    }
    const details = covered.map((cd) => ({
      field: 'districtIds',
      message: `${cd.district.name} is already covered by ${cd.coordinator.name}`,
    }));
    throw conflict(
      details.length === 1 ? details[0].message : 'Some of the selected districts are already covered by other coordinators',
      details,
    );
  }

  /* A new card goes after every live card unless an order is given. */
  async createCoordinator(input: CreateCoordinatorInput & MoveDistrictsOption, req?: Request): Promise<AdminCoordinator> {
    const id = await AppDataSource.transaction(async (m) => {
      const settings = await this.requireSettings(m);
      const districtIds = [...new Set(input.districtIds)];
      const moved = await this.assertCoordinatorDistricts(m, districtIds, undefined, input.moveDistricts);
      const repo = contactRepository.coordinators(m);
      const saved = await repo.save(
        repo.create({
          settingsId: settings.id,
          name: input.name,
          phone: input.phone,
          email: input.email || null,
          displayOrder: input.displayOrder ?? (await contactRepository.nextCoordinatorOrder(settings.id, m)),
          isActive: input.isActive ?? true,
        }),
      );
      await this.linkDistricts(m, saved.id, districtIds);
      await this.recordSectionChange(m, req, settings.id, 'coordinators', 'create', saved.id, moved);
      return saved.id;
    });
    return this.getCoordinator(id);
  }

  /* Any subset of the fields. districtIds, when sent, replaces the card's districts in the order given. */
  async updateCoordinator(id: string, input: PatchCoordinatorInput & MoveDistrictsOption, req?: Request): Promise<AdminCoordinator> {
    await AppDataSource.transaction(async (m) => {
      const settings = await this.requireSettings(m);
      await this.requireCoordinator(m, settings.id, id);
      const districtIds = input.districtIds && [...new Set(input.districtIds)];
      const moved = districtIds ? await this.assertCoordinatorDistricts(m, districtIds, id, input.moveDistricts) : [];
      /* Written even when only the districts change, so updatedAt still records the edit. */
      await contactRepository.coordinators(m).update(id, {
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.phone === undefined ? {} : { phone: input.phone }),
        ...(input.email === undefined ? {} : { email: input.email || null }),
        ...(input.displayOrder === undefined ? {} : { displayOrder: input.displayOrder }),
        ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
      });
      if (districtIds) {
        await m.getRepository(ContactCoordinatorDistrict).delete({ coordinatorId: id });
        await this.linkDistricts(m, id, districtIds);
      }
      await this.recordSectionChange(m, req, settings.id, 'coordinators', 'update', id, moved);
    });
    return this.getCoordinator(id);
  }

  /* Deactivation hides the card from the website but keeps it, and its districts, here. */
  async setCoordinatorStatus(id: string, isActive: boolean, req?: Request): Promise<AdminCoordinator> {
    await AppDataSource.transaction(async (m) => {
      const settings = await this.requireSettings(m);
      await this.requireCoordinator(m, settings.id, id);
      await contactRepository.coordinators(m).update(id, { isActive });
      await this.recordSectionChange(m, req, settings.id, 'coordinators', 'status', id);
    });
    return this.getCoordinator(id);
  }

  /* Soft-deletes the card and removes its district links, so its districts are free for another coordinator. */
  async removeCoordinator(id: string, req?: Request): Promise<void> {
    await AppDataSource.transaction(async (m) => {
      const settings = await this.requireSettings(m);
      await this.requireCoordinator(m, settings.id, id);
      await m.getRepository(ContactCoordinatorDistrict).delete({ coordinatorId: id });
      await contactRepository.coordinators(m).update(id, { isDelete: true, isActive: false });
      await this.recordSectionChange(m, req, settings.id, 'coordinators', 'delete', id);
    });
  }

  /* ---------------- district offices, one entry at a time ---------------- */

  async listDistrictOffices(q: DistrictOfficeListQuery): Promise<Paginated<AdminDistrictOffice>> {
    const settings = await this.requireSettings();
    const page = await contactRepository.listDistrictOffices(settings.id, q);
    return { items: page.items.map(toAdminDistrictOffice), meta: page.meta };
  }

  async getDistrictOffice(id: string): Promise<AdminDistrictOffice> {
    const settings = await this.requireSettings();
    const office = await contactRepository.findDistrictOffice(settings.id, id);
    if (!office) throw AppError.notFound(OFFICE_NOT_FOUND);
    return toAdminDistrictOffice(office);
  }

  private async requireOffice(m: EntityManager, settingsId: string, id: string): Promise<ContactDistrictOffice> {
    const office = await contactRepository.findDistrictOffice(settingsId, id, m);
    if (!office) throw AppError.notFound(OFFICE_NOT_FOUND);
    return office;
  }

  /* An office's district: a live district (400 otherwise) that has no other live office entry (409). */
  private async assertOfficeDistrict(m: EntityManager, districtId: string, officeId?: string): Promise<void> {
    await this.assertDistrictsExist(m, [districtId], 'districtId');
    const clash = await contactRepository.findOfficeOfDistrict(districtId, { excludeId: officeId, manager: m });
    if (clash) {
      const message = `${clash.district.name} already has an office entry`;
      throw conflict(message, [{ field: 'districtId', message }]);
    }
  }

  async createDistrictOffice(input: CreateDistrictOfficeInput, req?: Request): Promise<AdminDistrictOffice> {
    const id = await AppDataSource.transaction(async (m) => {
      const settings = await this.requireSettings(m);
      await this.assertOfficeDistrict(m, input.districtId);
      const repo = m.getRepository(ContactDistrictOffice);
      const saved = await repo.save(repo.create({ settingsId: settings.id, districtId: input.districtId, ...officeColumns(input) }));
      await this.recordSectionChange(m, req, settings.id, 'district-offices', 'create', saved.id);
      return saved.id;
    });
    return this.getDistrictOffice(id);
  }

  /* Any subset of the fields; a new districtId moves the entry to that district. */
  async updateDistrictOffice(id: string, input: PatchDistrictOfficeInput, req?: Request): Promise<AdminDistrictOffice> {
    await AppDataSource.transaction(async (m) => {
      const settings = await this.requireSettings(m);
      const current = await this.requireOffice(m, settings.id, id);
      if (input.districtId !== undefined && input.districtId !== current.districtId)
        await this.assertOfficeDistrict(m, input.districtId, id);
      await m.getRepository(ContactDistrictOffice).update(id, officePatchColumns(input));
      await this.recordSectionChange(m, req, settings.id, 'district-offices', 'update', id);
    });
    return this.getDistrictOffice(id);
  }

  async setDistrictOfficeStatus(id: string, isActive: boolean, req?: Request): Promise<AdminDistrictOffice> {
    await AppDataSource.transaction(async (m) => {
      const settings = await this.requireSettings(m);
      await this.requireOffice(m, settings.id, id);
      await m.getRepository(ContactDistrictOffice).update(id, { isActive });
      await this.recordSectionChange(m, req, settings.id, 'district-offices', 'status', id);
    });
    return this.getDistrictOffice(id);
  }

  /* Soft-deletes the entry, which frees its district for a new one. */
  async removeDistrictOffice(id: string, req?: Request): Promise<void> {
    await AppDataSource.transaction(async (m) => {
      const settings = await this.requireSettings(m);
      await this.requireOffice(m, settings.id, id);
      await m.getRepository(ContactDistrictOffice).update(id, { isDelete: true, isActive: false });
      await this.recordSectionChange(m, req, settings.id, 'district-offices', 'delete', id);
    });
  }
}

export const contactService = new ContactService();
