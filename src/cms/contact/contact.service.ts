import type { Request } from 'express';
import { AppDataSource } from '../../config/database.config';
import { AUDIT_ACTIONS } from '../../constants/app.constants';
import { auditService } from '../../services/audit.service';
import { AppError } from '../../utils/app-error';
import type { ContactOrganization, ContactPageSettings, OrgType } from './contact.model';
import { contactRepository } from './contact.repository';
import type {
  AdminContactPage, AdminOrganization, Bilingual, PublicContactPage, PublicOrganization,
  UpdateContactPageInput, UpdateOrganizationInput,
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
    const organizations = await contactRepository.findOrganizations(settings.id);
    return this.toAdmin(settings, organizations);
  }

  private toAdmin(settings: ContactPageSettings, organizations: ContactOrganization[]): AdminContactPage {
    return {
      id: settings.id,
      pageTitle: { mr: settings.pageTitleMr, en: settings.pageTitleEn },
      pageSubtitle: { mr: settings.pageSubtitleMr, en: settings.pageSubtitleEn },
      isPublished: settings.isPublished,
      createdAt: settings.createdAt,
      updatedAt: settings.updatedAt,
      organizations: organizations.map(toAdminOrganization),
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
    const organizations = await contactRepository.findOrganizations(settings.id, { activeOnly: true });
    return {
      pageTitle: { mr: settings.pageTitleMr, en: settings.pageTitleEn },
      pageSubtitle: { mr: settings.pageSubtitleMr, en: settings.pageSubtitleEn },
      organizations: organizations.map(toPublicOrganization),
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

      await contactRepository.update(settings.id, {
        pageTitleMr: input.pageTitle.mr,
        pageTitleEn: input.pageTitle.en,
        pageSubtitleMr: input.pageSubtitle.mr,
        pageSubtitleEn: input.pageSubtitle.en,
        ...(input.isPublished === undefined ? {} : { isPublished: input.isPublished }),
      }, m);

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

      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.CONTACT_PAGE_UPDATE,
        resource: 'contact-page',
        resourceId: settings.id,
        details: {
          isPublished: input.isPublished ?? settings.isPublished,
          cards: input.organizations.map((o) => o.orgType),
          removed: removed.map((o) => o.orgType),
        },
      });
    });
    return this.getForAdmin();
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
