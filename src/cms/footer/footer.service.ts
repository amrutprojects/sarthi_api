import type { Request } from 'express';
import { AppDataSource } from '../../config/database.config';
import { AUDIT_ACTIONS } from '../../shared/constants/app.constants';
import { auditService } from '../../modules/audit/audit.service';
import { AppError } from '../../shared/errors/app-error';
import type { FooterLink, FooterSection, FooterSettings } from './footer.model';
import { MAX_LINK_COLUMNS } from './footer.model';
import { footerRepository } from './footer.repository';
import type {
  AdminFooter,
  AdminFooterColumn,
  AdminFooterLink,
  PublicFooter,
  PublicFooterItem,
  PublicFooterLinkKind,
  UpdateFooterInput,
  UpdateFooterLinkInput,
} from './footer.types';

const NOT_CONFIGURED = 'The footer has not been configured yet. Run the database seed to create it.';

const toAdminLink = (l: FooterLink): AdminFooterLink => ({
  id: l.id,
  kind: l.kind,
  label: { mr: l.labelMr, en: l.labelEn },
  href: l.href,
  displayOrder: l.displayOrder,
  isActive: l.isActive,
});

/*
 * The website's own union is lower-cased (`internal | external | text | unavailable` in
 * data/footer.ts). Translating here rather than there keeps the storage convention — SCREAMING_CASE
 * enums, as everywhere else in this API — without making the site carry a mapping for one endpoint.
 */
const toPublicKind = (kind: FooterLink['kind']): PublicFooterLinkKind => kind.toLowerCase() as PublicFooterLinkKind;

/* Only what the footer prints. `href` is absent rather than null so the site can test presence. */
const toPublicItem = (l: FooterLink): PublicFooterItem => ({
  kind: toPublicKind(l.kind),
  label: { mr: l.labelMr, en: l.labelEn },
  ...(l.href ? { href: l.href } : {}),
});

/* Columns for one link. A line with no destination stores NULL, never a stale href. */
const toLinkColumns = (input: UpdateFooterLinkInput, displayOrder: number) => ({
  kind: input.kind,
  labelMr: input.label.mr,
  labelEn: input.label.en,
  href: input.kind === 'INTERNAL' || input.kind === 'EXTERNAL' ? (input.href ?? null) : null,
  displayOrder: input.displayOrder ?? displayOrder,
  isActive: input.isActive ?? true,
});

/*
 * Footer content (CMS).
 *
 * The configuration is a singleton enforced by the database, so there is no create endpoint: the
 * row is written once by the seed and edited thereafter. A missing row is a deployment problem (the
 * seed has not run), not something a request should silently repair — the admin read reports it
 * plainly and the public read degrades to "nothing published" so the website shows its own copy.
 *
 * The one rule that is not a database constraint is the cap on link columns, because it comes from
 * the stylesheet rather than from the data: `.gov-foot-in` is a four-column grid, so a third link
 * column would wrap the footer onto a second row on every page. It is checked in the validator and
 * again here, so a direct service call cannot bypass it.
 */
export class FooterService {
  /* The configuration an administrator edits, including inactive columns and links. */
  async getForAdmin(): Promise<AdminFooter> {
    const settings = await footerRepository.findSettings();
    if (!settings) throw AppError.notFound(NOT_CONFIGURED);

    const sections = await footerRepository.findSections(settings.id);
    const links = await footerRepository.findLinks(sections.map((s) => s.id));
    return this.toAdmin(settings, sections, links);
  }

  private toAdmin(settings: FooterSettings, sections: FooterSection[], links: FooterLink[]): AdminFooter {
    const linksOf = (sectionId: string) => links.filter((l) => l.sectionId === sectionId).map(toAdminLink);

    const columns: AdminFooterColumn[] = sections
      .filter((s) => s.kind === 'LINK_COLUMN')
      .map((s) => ({
        id: s.id,
        heading: { mr: s.headingMr ?? '', en: s.headingEn ?? '' },
        displayOrder: s.displayOrder,
        isActive: s.isActive,
        links: linksOf(s.id),
      }));

    const contactSection = sections.find((s) => s.kind === 'CONTACT');

    return {
      id: settings.id,
      about: {
        heading: { mr: settings.aboutHeadingMr, en: settings.aboutHeadingEn },
        body: { mr: settings.aboutBodyMr, en: settings.aboutBodyEn },
        partnerLabel: { mr: settings.partnerLabelMr, en: settings.partnerLabelEn },
        partnerName: { mr: settings.partnerNameMr, en: settings.partnerNameEn },
      },
      linkColumns: columns,
      contact: {
        heading: { mr: settings.contactHeadingMr, en: settings.contactHeadingEn },
        address: { mr: settings.contactAddressMr, en: settings.contactAddressEn },
        email: settings.contactEmail,
        phone: settings.contactPhone,
        links: contactSection ? linksOf(contactSection.id) : [],
      },
      bottom: {
        copyright: { mr: settings.copyrightMr, en: settings.copyrightEn },
        disclaimer: { mr: settings.disclaimerMr, en: settings.disclaimerEn },
      },
      isPublished: settings.isPublished,
      createdAt: settings.createdAt,
      updatedAt: settings.updatedAt,
    };
  }

  /*
   * What the website reads. Returns null — not an error — when the footer is unpublished or has
   * never been configured, because "there is nothing to show" is a normal state the site handles by
   * rendering its own bundled copy.
   *
   * The column cap is applied here too. The validator stops an administrator saving a third column,
   * but data that predates the rule, or arrives by any other route, must still not reach a page.
   */
  async getPublic(): Promise<PublicFooter | null> {
    const settings = await footerRepository.findSettings();
    if (!settings || !settings.isPublished || !settings.isActive) return null;

    const sections = await footerRepository.findSections(settings.id, { activeOnly: true });
    const links = await footerRepository.findLinks(
      sections.map((s) => s.id),
      { activeOnly: true },
    );
    const itemsOf = (sectionId: string) => links.filter((l) => l.sectionId === sectionId).map(toPublicItem);

    const contactSection = sections.find((s) => s.kind === 'CONTACT');

    return {
      about: {
        heading: { mr: settings.aboutHeadingMr, en: settings.aboutHeadingEn },
        body: { mr: settings.aboutBodyMr, en: settings.aboutBodyEn },
        partnerLabel: { mr: settings.partnerLabelMr, en: settings.partnerLabelEn },
        partnerName: { mr: settings.partnerNameMr, en: settings.partnerNameEn },
      },
      linkColumns: sections
        .filter((s) => s.kind === 'LINK_COLUMN')
        .slice(0, MAX_LINK_COLUMNS)
        .map((s) => ({
          heading: { mr: s.headingMr ?? '', en: s.headingEn ?? '' },
          items: itemsOf(s.id),
        })),
      contact: {
        heading: { mr: settings.contactHeadingMr, en: settings.contactHeadingEn },
        address: { mr: settings.contactAddressMr, en: settings.contactAddressEn },
        email: settings.contactEmail,
        phone: settings.contactPhone,
        items: contactSection ? itemsOf(contactSection.id) : [],
      },
      bottom: {
        copyright: { mr: settings.copyrightMr, en: settings.copyrightEn },
        disclaimer: { mr: settings.disclaimerMr, en: settings.disclaimerEn },
      },
    };
  }

  /*
   * Replaces the whole footer in one transaction: the text, the columns and every link commit
   * together or not at all, so no page is ever served a half-updated footer.
   *
   * Columns are matched by position rather than by id. The admin screen submits the footer as it
   * should look, and position is what the layout actually cares about — matching by id would mean
   * reordering two columns had to be expressed as a pair of edits rather than as the new order.
   * Links are replaced wholesale within their column, because merging two lists item by item would
   * leave an administrator unable to remove a link.
   */
  async update(input: UpdateFooterInput, req?: Request): Promise<AdminFooter> {
    if (input.linkColumns.length > MAX_LINK_COLUMNS) {
      throw AppError.badRequest(`The footer layout holds at most ${MAX_LINK_COLUMNS} link columns`, [
        { field: 'linkColumns', message: `At most ${MAX_LINK_COLUMNS} columns` },
      ]);
    }

    await AppDataSource.transaction(async (m) => {
      const settings = await footerRepository.findSettings(m);
      if (!settings) throw AppError.notFound(NOT_CONFIGURED);

      await footerRepository.update(
        settings.id,
        {
          aboutHeadingMr: input.about.heading.mr,
          aboutHeadingEn: input.about.heading.en,
          aboutBodyMr: input.about.body.mr,
          aboutBodyEn: input.about.body.en,
          partnerLabelMr: input.about.partnerLabel.mr,
          partnerLabelEn: input.about.partnerLabel.en,
          partnerNameMr: input.about.partnerName.mr,
          partnerNameEn: input.about.partnerName.en,
          contactHeadingMr: input.contact.heading.mr,
          contactHeadingEn: input.contact.heading.en,
          contactAddressMr: input.contact.address.mr,
          contactAddressEn: input.contact.address.en,
          contactEmail: input.contact.email,
          contactPhone: input.contact.phone,
          copyrightMr: input.bottom.copyright.mr,
          copyrightEn: input.bottom.copyright.en,
          disclaimerMr: input.bottom.disclaimer.mr,
          disclaimerEn: input.bottom.disclaimer.en,
          ...(input.isPublished === undefined ? {} : { isPublished: input.isPublished }),
        },
        m,
      );

      const sectionRepo = footerRepository.sections(m);
      const linkRepo = footerRepository.links(m);
      const existing = await footerRepository.findSections(settings.id, { manager: m });
      const existingColumns = existing.filter((s) => s.kind === 'LINK_COLUMN');

      /* The columns, by position. */
      const columnIds: string[] = [];
      for (const [index, column] of input.linkColumns.entries()) {
        const current = existingColumns[index];
        const columns = {
          kind: 'LINK_COLUMN' as const,
          headingMr: column.heading.mr,
          headingEn: column.heading.en,
          displayOrder: column.displayOrder ?? index,
          isActive: column.isActive ?? true,
        };
        if (current) {
          await sectionRepo.update(current.id, columns);
          columnIds.push(current.id);
        } else {
          const created = await sectionRepo.save(sectionRepo.create({ settingsId: settings.id, ...columns }));
          columnIds.push(created.id);
        }
      }

      /* A column the payload no longer carries is retired, along with the links inside it. */
      for (const stale of existingColumns.slice(input.linkColumns.length)) {
        await linkRepo.update({ sectionId: stale.id }, { isDelete: true, isActive: false });
        await sectionRepo.update(stale.id, { isDelete: true, isActive: false });
      }

      /* The CONTACT row owns the extra lines under the phone number; created on first use. */
      let contactSection = existing.find((s) => s.kind === 'CONTACT');
      if (!contactSection) {
        contactSection = await sectionRepo.save(
          sectionRepo.create({
            settingsId: settings.id,
            kind: 'CONTACT',
            headingMr: null,
            headingEn: null,
            displayOrder: MAX_LINK_COLUMNS,
            isActive: true,
          }),
        );
      }

      /* Links are rewritten per column: retire what is there, insert what was submitted. */
      const writeLinks = async (sectionId: string, links: UpdateFooterLinkInput[]) => {
        await linkRepo.update({ sectionId }, { isDelete: true, isActive: false });
        for (const [index, link] of links.entries()) {
          await linkRepo.insert({ sectionId, ...toLinkColumns(link, index) });
        }
      };

      for (const [index, column] of input.linkColumns.entries()) {
        await writeLinks(columnIds[index]!, column.links);
      }
      await writeLinks(contactSection.id, input.contact.links ?? []);

      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.FOOTER_UPDATE,
        resource: 'footer',
        resourceId: settings.id,
        details: {
          isPublished: input.isPublished ?? settings.isPublished,
          columns: input.linkColumns.map((c) => c.heading.en),
          links: input.linkColumns.reduce((n, c) => n + c.links.length, 0),
          contactLinks: input.contact.links?.length ?? 0,
        },
      });
    });

    return this.getForAdmin();
  }

  /* Publish / unpublish on its own, so visibility can be changed without resubmitting the content. */
  async setPublished(isPublished: boolean, req?: Request): Promise<AdminFooter> {
    await AppDataSource.transaction(async (m) => {
      const settings = await footerRepository.findSettings(m);
      if (!settings) throw AppError.notFound(NOT_CONFIGURED);

      await footerRepository.update(settings.id, { isPublished }, m);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.FOOTER_STATUS,
        resource: 'footer',
        resourceId: settings.id,
        details: { isPublished },
      });
    });
    return this.getForAdmin();
  }
}

export const footerService = new FooterService();
