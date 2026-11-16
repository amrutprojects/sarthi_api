import type { Request, Response } from 'express';
import type { EntityManager } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { AppDataSource } from '../../config/database.config';
import { ERROR_CODES, HTTP_STATUS } from '../../constants/api-response.constants';
import { auditService } from '../../modules/audit/audit.service';
import { logger } from '../../observability/logger';
import { AUDIT_ACTIONS } from '../../shared/constants/app.constants';
import { AppError } from '../../shared/errors/app-error';
import type { AdvisoryGroup, AdvisoryMember, AdvisorySection } from './advisory.model';
import { photoStore } from './advisory.photo';
import { advisoryGroupRepository, advisoryMemberRepository, advisorySectionRepository } from './advisory.repository';
import {
  PROFILE_LISTS,
  type AdminAdvisoryGroup,
  type AdminAdvisoryMember,
  type AdminAdvisorySection,
  type Bilingual,
  type BilingualList,
  type CreateAdvisoryGroupInput,
  type CreateAdvisoryMemberInput,
  type PhotoUpload,
  type ProfileList,
  type PublicAdvisoryGroup,
  type PublicAdvisoryMember,
  type PublicAdvisorySection,
  type PublicProfileText,
  type UpdateAdvisoryGroupInput,
  type UpdateAdvisoryMemberInput,
  type UpdateAdvisorySectionInput,
} from './advisory.types';
import { CHOOSE_GROUP } from './advisory.validator';

const NOT_FOUND = 'Advisory committee member not found';
const GROUP_NOT_FOUND = 'Advisory committee group not found';
const NOT_CONFIGURED = 'The advisory committee section has not been configured yet. Run the database seed to create it.';
const STALE_MEMBER = 'This member was changed after you opened it. Reload to see the latest version, then make your changes again.';
const STALE_GROUP = 'This group was changed after you opened it. Reload to see the latest version, then make your changes again.';
const STALE_SECTION =
  'The section settings were changed after you opened them. Reload to see the latest version, then make your changes again.';
const STALE_ORDER = 'The member list changed after you loaded it. Reload the list, then reorder again.';
const STALE_GROUP_ORDER = 'The group list changed after you loaded it. Reload the list, then reorder again.';
const STORE_FAILED = 'The photo could not be saved, so nothing was changed. Please try again.';

const pair = (mr: string, en: string): Bilingual => ({ mr, en });
/* Optional text is blank in both languages or filled in both (database CHECK), so one half decides. */
const orNull = (p: Bilingual): Bilingual | null => (p.mr ? p : null);

/*
 * A profile list is stored one item per line ('' when empty); the validator has already split,
 * trimmed and de-bulleted the items, so the lines are the items.
 */
const items = (stored: string): string[] => (stored ? stored.split('\n') : []);
const listOf = (m: AdvisoryMember, key: ProfileList): BilingualList => ({ mr: items(m[`${key}Mr`]), en: items(m[`${key}En`]) });

/*
 * Profile text may be filled in one language only, so — unlike orNull — each half is checked. No
 * language fallback here: the website picks the visitor's language and falls back itself.
 */
const textOrNull = (p: Bilingual): PublicProfileText | null => (p.mr || p.en ? { mr: p.mr || null, en: p.en || null } : null);
const listOrNull = (l: BilingualList): BilingualList | null => (l.mr.length || l.en.length ? l : null);

const isStale = (expected: string | undefined, actual: Date) => expected !== undefined && new Date(expected).getTime() !== actual.getTime();

/*
 * The live groups by id. A member whose groupId is not in it — none, or a group deleted under it — is
 * treated as ungrouped everywhere (deleting a group ungroups its members anyway; this is the backstop).
 */
type GroupsById = Map<string, AdvisoryGroup>;
const groupMap = (groups: AdvisoryGroup[]): GroupsById => new Map(groups.map((g) => [g.id, g]));
const groupOf = (m: AdvisoryMember, groups: GroupsById) => (m.groupId ? groups.get(m.groupId) : undefined);

const toAdmin = (m: AdvisoryMember, groups: GroupsById): AdminAdvisoryMember => {
  const g = groupOf(m, groups);
  return {
    id: m.id,
    name: pair(m.nameMr, m.nameEn),
    designation: pair(m.designationMr, m.designationEn),
    experience: pair(m.experienceMr, m.experienceEn),
    administrativeRoles: listOf(m, 'administrativeRoles'),
    keyAchievements: listOf(m, 'keyAchievements'),
    majorContributions: listOf(m, 'majorContributions'),
    researchLeadership: listOf(m, 'researchLeadership'),
    education: listOf(m, 'education'),
    photoUrl: m.photoKey ? `/cms/advisory-committee/photos/${photoStore.fileOf(m.photoKey)}` : null,
    displayOrder: m.displayOrder,
    isActive: m.isActive,
    groupId: g?.id ?? null,
    group: g ? { id: g.id, name: pair(g.nameMr, g.nameEn) } : null,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
  };
};

const toAdminGroup = (g: AdvisoryGroup, memberCount: number): AdminAdvisoryGroup => ({
  id: g.id,
  name: pair(g.nameMr, g.nameEn),
  displayOrder: g.displayOrder,
  isActive: g.isActive,
  memberCount,
  createdAt: g.createdAt,
  updatedAt: g.updatedAt,
});

/* What the website prints — no order numbers, status, timestamps or storage keys. */
const toPublic = (m: AdvisoryMember): PublicAdvisoryMember => ({
  id: m.id,
  name: pair(m.nameMr, m.nameEn),
  designation: orNull(pair(m.designationMr, m.designationEn)),
  photoUrl: m.photoKey ? `/public/advisory-committee/photos/${photoStore.fileOf(m.photoKey)}` : null,
  experience: textOrNull(pair(m.experienceMr, m.experienceEn)),
  administrativeRoles: listOrNull(listOf(m, 'administrativeRoles')),
  keyAchievements: listOrNull(listOf(m, 'keyAchievements')),
  majorContributions: listOrNull(listOf(m, 'majorContributions')),
  researchLeadership: listOrNull(listOf(m, 'researchLeadership')),
  education: listOrNull(listOf(m, 'education')),
});

const toAdminSection = (s: AdvisorySection): AdminAdvisorySection => ({
  id: s.id,
  heading: pair(s.headingMr, s.headingEn),
  subtitle: pair(s.subtitleMr, s.subtitleEn),
  createdAt: s.createdAt,
  updatedAt: s.updatedAt,
});

/* The member columns an input touches. Keys the input leaves out are not in the result at all. */
function memberColumns(input: Partial<CreateAdvisoryMemberInput>): QueryDeepPartialEntity<AdvisoryMember> {
  const out: QueryDeepPartialEntity<AdvisoryMember> = {};
  if (input.name) Object.assign(out, { nameMr: input.name.mr, nameEn: input.name.en });
  if (input.designation) Object.assign(out, { designationMr: input.designation.mr, designationEn: input.designation.en });
  if (input.experience) Object.assign(out, { experienceMr: input.experience.mr, experienceEn: input.experience.en });
  /* One item per line: the validator has already split any line break out of the items. */
  for (const key of PROFILE_LISTS) {
    const list = input[key];
    if (list) Object.assign(out, { [`${key}Mr`]: list.mr.join('\n'), [`${key}En`]: list.en.join('\n') });
  }
  if (input.groupId !== undefined) out.groupId = input.groupId;
  if (input.displayOrder !== undefined) out.displayOrder = input.displayOrder;
  if (input.isActive !== undefined) out.isActive = input.isActive;
  return out;
}

/*
 * The Advisory Committee page (CMS): its trainers and advisors, and its heading and subtitle. The
 * same model as Board Members (board.service.ts), photos included:
 *
 * Photos are written to storage BEFORE the database change and removed only AFTER it has committed:
 * - a failed save deletes the file it had just written, and the record keeps its previous photo;
 * - a replaced or deleted photo is removed once nothing references it any more.
 * The database is therefore never left pointing at a file that is gone because of this code.
 *
 * Members are soft-deleted, like every record here; a deleted member's photo is removed from storage
 * (and its key cleared), since a deleted member is never shown or restored.
 *
 * Members may be filed under groups (headings on the website). Groups are soft-deleted too; deleting
 * one ungroups its members in the same transaction, so the trainers stay listed, under no heading.
 */
export class AdvisoryService {
  async listForAdmin(): Promise<AdminAdvisoryMember[]> {
    const [members, groups] = await Promise.all([advisoryMemberRepository.list(), advisoryGroupRepository.list()]);
    const live = groupMap(groups);
    return members.map((m) => toAdmin(m, live));
  }

  async getForAdmin(id: string): Promise<AdminAdvisoryMember> {
    const m = await advisoryMemberRepository.findById(id);
    if (!m) throw AppError.notFound(NOT_FOUND);
    const g = m.groupId ? await advisoryGroupRepository.findById(m.groupId) : null;
    return toAdmin(m, groupMap(g ? [g] : []));
  }

  async create(input: CreateAdvisoryMemberInput, photo: PhotoUpload | undefined, req?: Request): Promise<AdminAdvisoryMember> {
    await this.assertUnique(input.name.en, input.designation?.en ?? '');

    const key = await this.store(photo);
    let id: string;
    try {
      id = await AppDataSource.transaction(async (m) => {
        await this.assertGroup(input.groupId, m);
        const created = await advisoryMemberRepository.create(
          {
            /* The name and whatever else was sent; every other text column defaults to '' (blank). */
            ...(memberColumns(input) as Partial<AdvisoryMember>),
            /* A new member goes to the end of the list unless an order is given. */
            displayOrder: input.displayOrder ?? (await advisoryMemberRepository.maxOrder(m)) + 1,
            isActive: input.isActive ?? true,
            photoKey: key,
          },
          m,
        );
        await auditService.recordInTx(m, req, {
          action: AUDIT_ACTIONS.ADVISORY_MEMBER_CREATE,
          resource: 'advisory-member',
          resourceId: created.id,
          details: {
            name: created.nameEn,
            designation: created.designationEn,
            group: created.groupId,
            photo: key !== null,
            isActive: created.isActive,
          },
        });
        return created.id;
      });
    } catch (err) {
      await photoStore.discard(key, 'advisory member create failed');
      throw err;
    }
    /*
     * Outside the try: once the transaction has committed the row references the photo, so a failure
     * of this read must not discard the file (update() reads back the same way).
     */
    return this.getForAdmin(id);
  }

  /*
   * A partial update. A new photo replaces the old one; `removePhoto` clears it; neither leaves it as
   * it is. `expectedUpdatedAt` is the version the admin screen loaded; a mismatch means someone else
   * saved first, and their work is kept rather than silently overwritten.
   */
  async update(id: string, input: UpdateAdvisoryMemberInput, photo: PhotoUpload | undefined, req?: Request): Promise<AdminAdvisoryMember> {
    if (photo && input.removePhoto) {
      throw AppError.validation([{ field: 'body.removePhoto', message: 'Send a new photo or remove the current one, not both' }]);
    }
    /* Checked before the upload is written, so a request for a missing member never stores a file. */
    if (!(await advisoryMemberRepository.exists({ id }))) throw AppError.notFound(NOT_FOUND);

    const newKey = await this.store(photo);
    let replacedKey: string | null;
    try {
      replacedKey = await AppDataSource.transaction(async (m) => {
        const current = await advisoryMemberRepository.findForUpdate(id, m);
        if (!current) throw AppError.notFound(NOT_FOUND);
        if (isStale(input.expectedUpdatedAt, current.updatedAt)) throw AppError.conflict(STALE_MEMBER);

        if (input.name || input.designation) {
          await this.assertUnique(input.name?.en ?? current.nameEn, input.designation?.en ?? current.designationEn, id, m);
        }
        await this.assertGroup(input.groupId, m);

        const changes = memberColumns(input);
        const photoChange = newKey ? 'replaced' : input.removePhoto && current.photoKey ? 'removed' : 'unchanged';
        if (photoChange !== 'unchanged') changes.photoKey = newKey;
        if (Object.keys(changes).length) await advisoryMemberRepository.updateWhere({ id }, changes, m);

        await auditService.recordInTx(m, req, {
          action: AUDIT_ACTIONS.ADVISORY_MEMBER_UPDATE,
          resource: 'advisory-member',
          resourceId: id,
          details: { fields: Object.keys(memberColumns(input)), photo: photoChange },
        });
        return photoChange === 'unchanged' ? null : current.photoKey;
      });
    } catch (err) {
      await photoStore.discard(newKey, 'advisory member update failed');
      throw err;
    }

    await photoStore.discard(replacedKey, 'advisory member photo replaced or removed');
    return this.getForAdmin(id);
  }

  async setActive(id: string, isActive: boolean, req?: Request): Promise<AdminAdvisoryMember> {
    await AppDataSource.transaction(async (m) => {
      const current = await advisoryMemberRepository.findForUpdate(id, m);
      if (!current) throw AppError.notFound(NOT_FOUND);
      await advisoryMemberRepository.updateWhere({ id }, { isActive }, m);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.ADVISORY_MEMBER_STATUS,
        resource: 'advisory-member',
        resourceId: id,
        details: { isActive },
      });
    });
    return this.getForAdmin(id);
  }

  async remove(id: string, req?: Request): Promise<void> {
    const photoKey = await AppDataSource.transaction(async (m) => {
      const current = await advisoryMemberRepository.findForUpdate(id, m);
      if (!current) throw AppError.notFound(NOT_FOUND);
      await advisoryMemberRepository.updateWhere({ id }, { isDelete: true, isActive: false, photoKey: null }, m);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.ADVISORY_MEMBER_DELETE,
        resource: 'advisory-member',
        resourceId: id,
        details: { name: current.nameEn, designation: current.designationEn, photo: current.photoKey !== null },
      });
      return current.photoKey;
    });
    await photoStore.discard(photoKey, 'advisory member deleted');
  }

  /*
   * Rewrites the display order from a full list of ids, in one transaction. The list must name every
   * member exactly once: anything else means the screen is out of date (someone added or deleted a
   * member meanwhile), and guessing where the missing rows go would move the wrong card.
   */
  async reorder(ids: string[], req?: Request): Promise<AdminAdvisoryMember[]> {
    await AppDataSource.transaction(async (m) => {
      const all = await advisoryMemberRepository.lockAll(m);
      const byId = new Map(all.map((r) => [r.id, r]));
      if (ids.length !== all.length || ids.some((id) => !byId.has(id))) throw AppError.conflict(STALE_ORDER);

      for (const [index, id] of ids.entries()) {
        if (byId.get(id)!.displayOrder !== index + 1) await advisoryMemberRepository.updateWhere({ id }, { displayOrder: index + 1 }, m);
      }
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.ADVISORY_MEMBERS_REORDER,
        resource: 'advisory-member',
        details: { order: ids },
      });
    });
    return this.listForAdmin();
  }

  async getSection(): Promise<AdminAdvisorySection> {
    const s = await advisorySectionRepository.find();
    if (!s) throw AppError.notFound(NOT_CONFIGURED);
    return toAdminSection(s);
  }

  async updateSection(input: UpdateAdvisorySectionInput, req?: Request): Promise<AdminAdvisorySection> {
    await AppDataSource.transaction(async (m) => {
      const s = await advisorySectionRepository.findForUpdate(m);
      if (!s) throw AppError.notFound(NOT_CONFIGURED);
      if (isStale(input.expectedUpdatedAt, s.updatedAt)) throw AppError.conflict(STALE_SECTION);

      await advisorySectionRepository.updateWhere(
        { id: s.id },
        { headingMr: input.heading.mr, headingEn: input.heading.en, subtitleMr: input.subtitle.mr, subtitleEn: input.subtitle.en },
        m,
      );
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.ADVISORY_SECTION_UPDATE,
        resource: 'advisory-section',
        resourceId: s.id,
        details: { heading: input.heading.en },
      });
    });
    return this.getSection();
  }

  /* ---- groups ---- */

  async listGroups(): Promise<AdminAdvisoryGroup[]> {
    const [groups, counts] = await Promise.all([advisoryGroupRepository.list(), advisoryMemberRepository.countByGroup()]);
    return groups.map((g) => toAdminGroup(g, counts.get(g.id) ?? 0));
  }

  async getGroup(id: string): Promise<AdminAdvisoryGroup> {
    const g = await advisoryGroupRepository.findById(id);
    if (!g) throw AppError.notFound(GROUP_NOT_FOUND);
    return toAdminGroup(g, await advisoryMemberRepository.count({ groupId: id }));
  }

  /* A new group goes to the end of the list. */
  async createGroup(input: CreateAdvisoryGroupInput, req?: Request): Promise<AdminAdvisoryGroup> {
    await this.assertGroupUnique(input.name.en);
    const id = await AppDataSource.transaction(async (m) => {
      const created = await advisoryGroupRepository.create(
        {
          nameMr: input.name.mr,
          nameEn: input.name.en,
          displayOrder: (await advisoryGroupRepository.maxOrder(m)) + 1,
          isActive: input.isActive ?? true,
        },
        m,
      );
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.ADVISORY_GROUP_CREATE,
        resource: 'advisory-group',
        resourceId: created.id,
        details: { name: created.nameEn, isActive: created.isActive },
      });
      return created.id;
    });
    return this.getGroup(id);
  }

  /* A partial update, refused over a newer version like a member's. */
  async updateGroup(id: string, input: UpdateAdvisoryGroupInput, req?: Request): Promise<AdminAdvisoryGroup> {
    await AppDataSource.transaction(async (m) => {
      const current = await advisoryGroupRepository.findForUpdate(id, m);
      if (!current) throw AppError.notFound(GROUP_NOT_FOUND);
      if (isStale(input.expectedUpdatedAt, current.updatedAt)) throw AppError.conflict(STALE_GROUP);
      if (input.name) await this.assertGroupUnique(input.name.en, id, m);

      const changes: QueryDeepPartialEntity<AdvisoryGroup> = {};
      if (input.name) Object.assign(changes, { nameMr: input.name.mr, nameEn: input.name.en });
      if (input.isActive !== undefined) changes.isActive = input.isActive;
      if (Object.keys(changes).length) await advisoryGroupRepository.updateWhere({ id }, changes, m);

      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.ADVISORY_GROUP_UPDATE,
        resource: 'advisory-group',
        resourceId: id,
        details: { fields: Object.keys(changes), name: input.name?.en ?? current.nameEn },
      });
    });
    return this.getGroup(id);
  }

  async setGroupActive(id: string, isActive: boolean, req?: Request): Promise<AdminAdvisoryGroup> {
    await AppDataSource.transaction(async (m) => {
      if (!(await advisoryGroupRepository.findForUpdate(id, m))) throw AppError.notFound(GROUP_NOT_FOUND);
      await advisoryGroupRepository.updateWhere({ id }, { isActive }, m);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.ADVISORY_GROUP_STATUS,
        resource: 'advisory-group',
        resourceId: id,
        details: { isActive },
      });
    });
    return this.getGroup(id);
  }

  /*
   * Soft-deletes a group. Its members are not deleted: they are ungrouped in the same transaction and
   * stay on the website (if visible) under no heading. The row lock makes a concurrent save that files
   * a member under this group wait (see findForShare), so no member is left in a deleted group.
   */
  async removeGroup(id: string, req?: Request): Promise<{ membersUngrouped: number }> {
    return AppDataSource.transaction(async (m) => {
      const current = await advisoryGroupRepository.findForUpdate(id, m);
      if (!current) throw AppError.notFound(GROUP_NOT_FOUND);
      await advisoryGroupRepository.softDelete(id, m);
      const membersUngrouped = await advisoryMemberRepository.ungroup(id, m);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.ADVISORY_GROUP_DELETE,
        resource: 'advisory-group',
        resourceId: id,
        details: { name: current.nameEn, membersUngrouped },
      });
      return { membersUngrouped };
    });
  }

  /* The groups' order from a full list of ids — every group exactly once, as for members. */
  async reorderGroups(ids: string[], req?: Request): Promise<AdminAdvisoryGroup[]> {
    await AppDataSource.transaction(async (m) => {
      const all = await advisoryGroupRepository.lockAll(m);
      const order = new Map(all.map((g) => [g.id, g.displayOrder]));
      if (ids.length !== all.length || ids.some((id) => !order.has(id))) throw AppError.conflict(STALE_GROUP_ORDER);

      for (const [index, id] of ids.entries()) {
        if (order.get(id) !== index + 1) await advisoryGroupRepository.updateWhere({ id }, { displayOrder: index + 1 }, m);
      }
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.ADVISORY_GROUPS_REORDER,
        resource: 'advisory-group',
        details: { order: ids },
      });
    });
    return this.listGroups();
  }

  /*
   * What the website reads. Null — not an error — when the section has never been configured (or is
   * switched off); the site then shows that the committee details are unavailable. Hidden members
   * are left out, the rest come in display order: first those in no group, then each visible group
   * with its members. A hidden group takes its members with it; a group left with no visible member
   * is not sent at all, so the site never prints a heading over nothing.
   */
  async getPublic(): Promise<PublicAdvisorySection | null> {
    const s = await advisorySectionRepository.find();
    if (!s || !s.isActive) return null;
    const [members, groups] = await Promise.all([advisoryMemberRepository.list({ activeOnly: true }), advisoryGroupRepository.list()]);
    const live = groupMap(groups);

    const ungrouped: PublicAdvisoryMember[] = [];
    const inGroup = new Map<string, PublicAdvisoryMember[]>();
    for (const m of members) {
      const g = groupOf(m, live);
      if (!g) ungrouped.push(toPublic(m));
      else if (g.isActive) inGroup.set(g.id, [...(inGroup.get(g.id) ?? []), toPublic(m)]);
    }
    const shown: PublicAdvisoryGroup[] = groups
      .filter((g) => inGroup.has(g.id))
      .map((g) => ({ id: g.id, name: pair(g.nameMr, g.nameEn), members: inGroup.get(g.id)! }));

    return {
      heading: pair(s.headingMr, s.headingEn),
      subtitle: orNull(pair(s.subtitleMr, s.subtitleEn)),
      members: ungrouped,
      groups: shown,
    };
  }

  /*
   * Streams a photo by its file name. Only a photo some member currently references is served — the
   * public route additionally requires that member to be on the website (visible, and not in a hidden
   * group) — so a replaced, deleted or hidden member's photo is not reachable from the website.
   */
  async sendPhoto(res: Response, file: string, scope: 'public' | 'admin'): Promise<void> {
    const key = photoStore.keyOf(file);
    const owner = await advisoryMemberRepository.findByPhotoKey(key, { activeOnly: scope === 'public' });
    if (!owner) throw AppError.notFound('Photo not found');
    if (scope === 'public' && owner.groupId && (await advisoryGroupRepository.findById(owner.groupId))?.isActive === false) {
      throw AppError.notFound('Photo not found');
    }
    await photoStore.send(
      res,
      key,
      scope === 'public' ? { cache: 'public, max-age=86400', corp: 'cross-origin' } : { cache: 'private, max-age=300', corp: 'same-site' },
    );
  }

  /* Checked before the insert so the admin sees which person clashes, not a constraint violation. */
  private async assertUnique(nameEn: string, designationEn: string, exceptId?: string, manager?: EntityManager): Promise<void> {
    if (await advisoryMemberRepository.findDuplicate(nameEn, designationEn, exceptId, manager)) {
      throw AppError.conflict(
        designationEn
          ? `${nameEn} is already listed with the position "${designationEn}".`
          : `${nameEn} is already listed without a position.`,
      );
    }
  }

  private async assertGroupUnique(nameEn: string, exceptId?: string, manager?: EntityManager): Promise<void> {
    if (await advisoryGroupRepository.findDuplicate(nameEn, exceptId, manager)) {
      throw AppError.conflict(`A group named "${nameEn}" already exists.`);
    }
  }

  /*
   * A member may only be filed under a live group. The group is share-locked until the member's save
   * commits, so it cannot be deleted in between. null and undefined (no group / unchanged) need nothing.
   */
  private async assertGroup(groupId: string | null | undefined, manager: EntityManager): Promise<void> {
    if (!groupId) return;
    if (!(await advisoryGroupRepository.findForShare(groupId, manager))) {
      throw AppError.validation([{ field: 'body.groupId', message: CHOOSE_GROUP }]);
    }
  }

  /* Writes an accepted photo under a fresh key. Nothing has touched the database yet if this fails. */
  private async store(photo: PhotoUpload | undefined): Promise<string | null> {
    if (!photo) return null;
    const key = photoStore.newKey(photo.ext);
    try {
      await photoStore.write(key, photo);
    } catch (err) {
      logger.error({ err, key }, 'advisory member photo could not be written to storage');
      await photoStore.discard(key, 'advisory member photo write failed');
      throw new AppError(HTTP_STATUS.INTERNAL_SERVER_ERROR, STORE_FAILED, ERROR_CODES.INTERNAL_ERROR);
    }
    return key;
  }
}

export const advisoryService = new AdvisoryService();
