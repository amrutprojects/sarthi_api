import type { Request } from 'express';
import { In, type EntityManager } from 'typeorm';
import { AppDataSource } from '../../config/database.config';
import { AUDIT_ACTIONS } from '../../shared/constants/app.constants';
import { auditService } from '../../modules/audit/audit.service';
import { AppError } from '../../shared/errors/app-error';
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
  DistrictRef,
  PublicContactPage,
  PublicCoordinator,
  PublicDistrictOffice,
  PublicOrganization,
  UpdateContactPageInput,
  UpdateCoordinatorInput,
  UpdateDistrictOfficeInput,
  UpdateOrganizationInput,
} from './contact.types';

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

/*
 * Contact page content (CMS).
 *
 * The configuration is a singleton enforced by the database, so there is no create endpoint: the row
 * is written once by the seed and edited thereafter. A missing row is therefore a deployment problem
 * (the seed has not run), not something a request should silently repair — the admin read reports it
 * plainly and the public read degrades to "nothing published" so the website shows its own copy.
 *
 * Every rule here is also a database constraint (per-type required fields, one card per type, the
 * single settings row). The checks exist to return a readable 4xx instead of a raw constraint error.
 */
export class ContactService {
  /* The configuration an administrator edits, including inactive cards. */
  async getForAdmin(): Promise<AdminContactPage> {
    const settings = await contactRepository.findSettings();
    if (!settings) {
      throw AppError.notFound('The Contact page has not been configured yet. Run the database seed to create it.');
    }
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
      const settings = await contactRepository.findSettings(m);
      if (!settings) {
        throw AppError.notFound('The Contact page has not been configured yet. Run the database seed to create it.');
      }

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
      const districtIds = [...new Set(c.districtIds)];
      if (districtIds.length) {
        await links.insert(districtIds.map((districtId, displayOrder) => ({ coordinatorId: saved.id, districtId, displayOrder })));
      }
    }
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
      const settings = await contactRepository.findSettings(m);
      if (!settings) {
        throw AppError.notFound('The Contact page has not been configured yet. Run the database seed to create it.');
      }
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
}

export const contactService = new ContactService();
