import type { Request, Response } from 'express';
import type { EntityManager } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { AppDataSource } from '../../config/database.config';
import { ERROR_CODES, HTTP_STATUS } from '../../constants/api-response.constants';
import { auditService } from '../../modules/audit/audit.service';
import { logger } from '../../observability/logger';
import { AUDIT_ACTIONS } from '../../shared/constants/app.constants';
import { AppError } from '../../shared/errors/app-error';
import type { BoardMember, BoardSection } from './board.model';
import { photoStore } from './board.photo';
import { boardMemberRepository, boardSectionRepository } from './board.repository';
import type {
  AdminBoardMember,
  AdminBoardSection,
  Bilingual,
  CreateBoardMemberInput,
  PhotoUpload,
  PublicBoardMember,
  PublicBoardSection,
  UpdateBoardMemberInput,
  UpdateBoardSectionInput,
} from './board.types';

const NOT_FOUND = 'Board member not found';
const NOT_CONFIGURED = 'The board members section has not been configured yet. Run the database seed to create it.';
const STALE_MEMBER = 'This member was changed after you opened it. Reload to see the latest version, then make your changes again.';
const STALE_SECTION =
  'The section settings were changed after you opened them. Reload to see the latest version, then make your changes again.';
const STALE_ORDER = 'The member list changed after you loaded it. Reload the list, then reorder again.';
const STORE_FAILED = 'The photo could not be saved, so nothing was changed. Please try again.';

const pair = (mr: string, en: string): Bilingual => ({ mr, en });
/* Optional text is blank in both languages or filled in both (database CHECK), so one half decides. */
const orNull = (p: Bilingual): Bilingual | null => (p.mr ? p : null);
/* Both halves of a name are null together (database CHECK): null is "still to be supplied". */
const nameOf = (m: BoardMember): Bilingual | null => (m.nameMr !== null && m.nameEn !== null ? pair(m.nameMr, m.nameEn) : null);

const isStale = (expected: string | undefined, actual: Date) => expected !== undefined && new Date(expected).getTime() !== actual.getTime();

const toAdmin = (m: BoardMember): AdminBoardMember => ({
  id: m.id,
  name: nameOf(m),
  category: pair(m.categoryMr, m.categoryEn),
  designation: pair(m.designationMr, m.designationEn),
  description: pair(m.descriptionMr, m.descriptionEn),
  subtitle: pair(m.subtitleMr, m.subtitleEn),
  photoUrl: m.photoKey ? `/cms/board-members/photos/${photoStore.fileOf(m.photoKey)}` : null,
  displayOrder: m.displayOrder,
  isActive: m.isActive,
  createdAt: m.createdAt,
  updatedAt: m.updatedAt,
});

/* What the website prints — no order numbers, status, timestamps or storage keys. */
const toPublic = (m: BoardMember): PublicBoardMember => ({
  id: m.id,
  name: nameOf(m),
  category: pair(m.categoryMr, m.categoryEn),
  designation: pair(m.designationMr, m.designationEn),
  description: orNull(pair(m.descriptionMr, m.descriptionEn)),
  subtitle: orNull(pair(m.subtitleMr, m.subtitleEn)),
  photoUrl: m.photoKey ? `/public/board-members/photos/${photoStore.fileOf(m.photoKey)}` : null,
});

const toAdminSection = (s: BoardSection): AdminBoardSection => ({
  id: s.id,
  heading: pair(s.headingMr, s.headingEn),
  subtitle: pair(s.subtitleMr, s.subtitleEn),
  noticeTitle: pair(s.noticeTitleMr, s.noticeTitleEn),
  noticeBody: pair(s.noticeBodyMr, s.noticeBodyEn),
  showNotice: s.showNotice,
  showSection: s.showSection,
  createdAt: s.createdAt,
  updatedAt: s.updatedAt,
});

/* The member columns an input touches. Keys the input leaves out are not in the result at all. */
function memberColumns(input: Partial<CreateBoardMemberInput>): QueryDeepPartialEntity<BoardMember> {
  const out: QueryDeepPartialEntity<BoardMember> = {};
  if (input.name !== undefined) Object.assign(out, { nameMr: input.name?.mr ?? null, nameEn: input.name?.en ?? null });
  if (input.category) Object.assign(out, { categoryMr: input.category.mr, categoryEn: input.category.en });
  if (input.designation) Object.assign(out, { designationMr: input.designation.mr, designationEn: input.designation.en });
  if (input.description) Object.assign(out, { descriptionMr: input.description.mr, descriptionEn: input.description.en });
  if (input.subtitle) Object.assign(out, { subtitleMr: input.subtitle.mr, subtitleEn: input.subtitle.en });
  if (input.displayOrder !== undefined) out.displayOrder = input.displayOrder;
  if (input.isActive !== undefined) out.isActive = input.isActive;
  return out;
}

/*
 * The Leadership & Governing Board section (CMS): its members and its heading, subtitle and notice.
 *
 * Photos are written to storage BEFORE the database change and removed only AFTER it has committed:
 * - a failed save deletes the file it had just written, and the record keeps its previous photo;
 * - a replaced or deleted photo is removed once nothing references it any more.
 * The database is therefore never left pointing at a file that is gone because of this code.
 *
 * Members are soft-deleted, like every record here; a deleted member's photo is removed from storage
 * (and its key cleared), since a deleted member is never shown or restored.
 */
export class BoardService {
  async listForAdmin(): Promise<AdminBoardMember[]> {
    return (await boardMemberRepository.list()).map(toAdmin);
  }

  async getForAdmin(id: string): Promise<AdminBoardMember> {
    const m = await boardMemberRepository.findById(id);
    if (!m) throw AppError.notFound(NOT_FOUND);
    return toAdmin(m);
  }

  async create(input: CreateBoardMemberInput, photo: PhotoUpload | undefined, req?: Request): Promise<AdminBoardMember> {
    if (input.name) await this.assertUnique(input.name.en, input.designation.en);

    const key = await this.store(photo);
    try {
      const id = await AppDataSource.transaction(async (m) => {
        const created = await boardMemberRepository.create(
          {
            nameMr: input.name?.mr ?? null,
            nameEn: input.name?.en ?? null,
            categoryMr: input.category.mr,
            categoryEn: input.category.en,
            designationMr: input.designation.mr,
            designationEn: input.designation.en,
            descriptionMr: input.description?.mr ?? '',
            descriptionEn: input.description?.en ?? '',
            subtitleMr: input.subtitle?.mr ?? '',
            subtitleEn: input.subtitle?.en ?? '',
            /* A new member goes to the end of the list unless an order is given. */
            displayOrder: input.displayOrder ?? (await boardMemberRepository.maxOrder(m)) + 1,
            isActive: input.isActive ?? true,
            photoKey: key,
          },
          m,
        );
        await auditService.recordInTx(m, req, {
          action: AUDIT_ACTIONS.BOARD_MEMBER_CREATE,
          resource: 'board-member',
          resourceId: created.id,
          details: { name: created.nameEn, designation: created.designationEn, photo: key !== null, isActive: created.isActive },
        });
        return created.id;
      });
      return await this.getForAdmin(id);
    } catch (err) {
      await photoStore.discard(key, 'board member create failed');
      throw err;
    }
  }

  /*
   * A partial update. A new photo replaces the old one; `removePhoto` clears it; neither leaves it as
   * it is. `expectedUpdatedAt` is the version the admin screen loaded; a mismatch means someone else
   * saved first, and their work is kept rather than silently overwritten.
   */
  async update(id: string, input: UpdateBoardMemberInput, photo: PhotoUpload | undefined, req?: Request): Promise<AdminBoardMember> {
    if (photo && input.removePhoto) {
      throw AppError.validation([{ field: 'body.removePhoto', message: 'Send a new photo or remove the current one, not both' }]);
    }
    /* Checked before the upload is written, so a request for a missing member never stores a file. */
    if (!(await boardMemberRepository.exists({ id }))) throw AppError.notFound(NOT_FOUND);

    const newKey = await this.store(photo);
    let replacedKey: string | null;
    try {
      replacedKey = await AppDataSource.transaction(async (m) => {
        const current = await boardMemberRepository.findForUpdate(id, m);
        if (!current) throw AppError.notFound(NOT_FOUND);
        if (isStale(input.expectedUpdatedAt, current.updatedAt)) throw AppError.conflict(STALE_MEMBER);

        const name = input.name === undefined ? current.nameEn : (input.name?.en ?? null);
        if (name && (input.name !== undefined || input.designation)) {
          await this.assertUnique(name, input.designation?.en ?? current.designationEn, id, m);
        }

        const changes = memberColumns(input);
        const photoChange = newKey ? 'replaced' : input.removePhoto && current.photoKey ? 'removed' : 'unchanged';
        if (photoChange !== 'unchanged') changes.photoKey = newKey;
        if (Object.keys(changes).length) await boardMemberRepository.updateWhere({ id }, changes, m);

        await auditService.recordInTx(m, req, {
          action: AUDIT_ACTIONS.BOARD_MEMBER_UPDATE,
          resource: 'board-member',
          resourceId: id,
          details: { fields: Object.keys(memberColumns(input)), photo: photoChange },
        });
        return photoChange === 'unchanged' ? null : current.photoKey;
      });
    } catch (err) {
      await photoStore.discard(newKey, 'board member update failed');
      throw err;
    }

    await photoStore.discard(replacedKey, 'board member photo replaced or removed');
    return this.getForAdmin(id);
  }

  async setActive(id: string, isActive: boolean, req?: Request): Promise<AdminBoardMember> {
    await AppDataSource.transaction(async (m) => {
      const current = await boardMemberRepository.findForUpdate(id, m);
      if (!current) throw AppError.notFound(NOT_FOUND);
      await boardMemberRepository.updateWhere({ id }, { isActive }, m);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.BOARD_MEMBER_STATUS,
        resource: 'board-member',
        resourceId: id,
        details: { isActive },
      });
    });
    return this.getForAdmin(id);
  }

  async remove(id: string, req?: Request): Promise<void> {
    const photoKey = await AppDataSource.transaction(async (m) => {
      const current = await boardMemberRepository.findForUpdate(id, m);
      if (!current) throw AppError.notFound(NOT_FOUND);
      await boardMemberRepository.updateWhere({ id }, { isDelete: true, isActive: false, photoKey: null }, m);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.BOARD_MEMBER_DELETE,
        resource: 'board-member',
        resourceId: id,
        details: { name: current.nameEn, designation: current.designationEn, photo: current.photoKey !== null },
      });
      return current.photoKey;
    });
    await photoStore.discard(photoKey, 'board member deleted');
  }

  /*
   * Rewrites the display order from a full list of ids, in one transaction. The list must name every
   * member exactly once: anything else means the screen is out of date (someone added or deleted a
   * member meanwhile), and guessing where the missing rows go would move the wrong card.
   */
  async reorder(ids: string[], req?: Request): Promise<AdminBoardMember[]> {
    await AppDataSource.transaction(async (m) => {
      const all = await boardMemberRepository.lockAll(m);
      const byId = new Map(all.map((r) => [r.id, r]));
      if (ids.length !== all.length || ids.some((id) => !byId.has(id))) throw AppError.conflict(STALE_ORDER);

      for (const [index, id] of ids.entries()) {
        if (byId.get(id)!.displayOrder !== index + 1) await boardMemberRepository.updateWhere({ id }, { displayOrder: index + 1 }, m);
      }
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.BOARD_MEMBERS_REORDER,
        resource: 'board-member',
        details: { order: ids },
      });
    });
    return this.listForAdmin();
  }

  async getSection(): Promise<AdminBoardSection> {
    const s = await boardSectionRepository.find();
    if (!s) throw AppError.notFound(NOT_CONFIGURED);
    return toAdminSection(s);
  }

  async updateSection(input: UpdateBoardSectionInput, req?: Request): Promise<AdminBoardSection> {
    await AppDataSource.transaction(async (m) => {
      const s = await boardSectionRepository.findForUpdate(m);
      if (!s) throw AppError.notFound(NOT_CONFIGURED);
      if (isStale(input.expectedUpdatedAt, s.updatedAt)) throw AppError.conflict(STALE_SECTION);

      await boardSectionRepository.updateWhere(
        { id: s.id },
        {
          headingMr: input.heading.mr,
          headingEn: input.heading.en,
          subtitleMr: input.subtitle.mr,
          subtitleEn: input.subtitle.en,
          noticeTitleMr: input.noticeTitle.mr,
          noticeTitleEn: input.noticeTitle.en,
          noticeBodyMr: input.noticeBody.mr,
          noticeBodyEn: input.noticeBody.en,
          showNotice: input.showNotice,
        },
        m,
      );
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.BOARD_SECTION_UPDATE,
        resource: 'board-section',
        resourceId: s.id,
        details: { showNotice: input.showNotice },
      });
    });
    return this.getSection();
  }

  /*
   * What the website reads. Null — not an error — when the section has never been configured; the
   * site then shows that the board details are unavailable. A hidden section comes back with
   * `showSection: false` and no members, so the site leaves it out instead. Hidden members are left
   * out, the rest come in display order, and a hidden notice is null.
   */
  async getPublic(): Promise<PublicBoardSection | null> {
    const s = await boardSectionRepository.find();
    if (!s || !s.isActive) return null;
    const members = s.showSection ? await boardMemberRepository.list({ activeOnly: true }) : [];
    return {
      showSection: s.showSection,
      heading: pair(s.headingMr, s.headingEn),
      subtitle: orNull(pair(s.subtitleMr, s.subtitleEn)),
      notice: s.showNotice ? { title: orNull(pair(s.noticeTitleMr, s.noticeTitleEn)), body: pair(s.noticeBodyMr, s.noticeBodyEn) } : null,
      members: members.map(toPublic),
    };
  }

  /*
   * Streams a photo by its file name. Only a photo some member currently references is served — the
   * public route additionally requires that member to be visible — so a replaced, deleted or hidden
   * member's photo is not reachable from the website.
   */
  async sendPhoto(res: Response, file: string, scope: 'public' | 'admin'): Promise<void> {
    const key = photoStore.keyOf(file);
    const owner = await boardMemberRepository.findByPhotoKey(key, { activeOnly: scope === 'public' });
    if (!owner) throw AppError.notFound('Photo not found');
    await photoStore.send(
      res,
      key,
      scope === 'public' ? { cache: 'public, max-age=86400', corp: 'cross-origin' } : { cache: 'private, max-age=300', corp: 'same-site' },
    );
  }

  private async assertUnique(nameEn: string, designationEn: string, exceptId?: string, manager?: EntityManager): Promise<void> {
    if (await boardMemberRepository.findDuplicate(nameEn, designationEn, exceptId, manager)) {
      throw AppError.conflict(`${nameEn} is already listed with the designation "${designationEn}".`);
    }
  }

  /* Writes an accepted photo under a fresh key. Nothing has touched the database yet if this fails. */
  private async store(photo: PhotoUpload | undefined): Promise<string | null> {
    if (!photo) return null;
    const key = photoStore.newKey(photo.ext);
    try {
      await photoStore.write(key, photo);
    } catch (err) {
      logger.error({ err, key }, 'board member photo could not be written to storage');
      await photoStore.discard(key, 'board member photo write failed');
      throw new AppError(HTTP_STATUS.INTERNAL_SERVER_ERROR, STORE_FAILED, ERROR_CODES.INTERNAL_ERROR);
    }
    return key;
  }
}

export const boardService = new BoardService();
