import type { Request } from 'express';
import type { EntityManager } from 'typeorm';
import { AppDataSource } from '../../config/database.config';
import { AUDIT_ACTIONS } from '../../shared/constants/app.constants';
import { auditService } from '../../modules/audit/audit.service';
import { AppError } from '../../shared/errors/app-error';
import type { Paginated } from '../../shared/utils/pagination';
import type { Faq } from './faq.model';
import { faqRepository } from './faq.repository';
import type { AdminFaq, Bilingual, CreateFaqInput, FaqListQuery, PublicFaq, UpdateFaqInput } from './faq.types';

const NOT_FOUND = 'FAQ not found';

const toAdmin = (f: Faq): AdminFaq => ({
  id: f.id,
  question: { mr: f.questionMr, en: f.questionEn },
  answer: { mr: f.answerMr, en: f.answerEn },
  displayOrder: f.displayOrder,
  isActive: f.isActive,
  createdAt: f.createdAt,
  updatedAt: f.updatedAt,
});

const toPublic = (f: Faq): PublicFaq => ({
  question: { mr: f.questionMr, en: f.questionEn },
  answer: { mr: f.answerMr, en: f.answerEn },
});

/*
 * The same question cannot be listed twice, in either language. Checked against the live questions
 * only (soft-deleted ones keep their history without blocking a new one), exactly as the partial
 * unique indexes on the table do.
 */
async function assertQuestionFree(question: Bilingual, m: EntityManager, excludeId?: string): Promise<void> {
  if (await faqRepository.findByQuestion('En', question.en, { excludeId, manager: m })) {
    throw AppError.conflict('Another FAQ already asks this question (English)');
  }
  if (await faqRepository.findByQuestion('Mr', question.mr, { excludeId, manager: m })) {
    throw AppError.conflict('Another FAQ already asks this question (Marathi)');
  }
}

/*
 * FAQ page content (CMS).
 *
 * Each question is an independent record with the usual master lifecycle — create, edit, activate /
 * deactivate, soft-delete, restore — and every write is audited. The website reads only the active
 * questions, in display order, through getPublic().
 *
 * Every rule here is also a database constraint (non-blank text, unique questions among live rows, a
 * non-negative order). The checks exist to return a readable 4xx instead of a raw constraint error.
 */
export class FaqService {
  async list(q: FaqListQuery): Promise<Paginated<AdminFaq>> {
    const page = await faqRepository.list(q);
    return { items: page.items.map(toAdmin), meta: page.meta };
  }

  async get(id: string): Promise<AdminFaq> {
    const faq = await faqRepository.findById(id);
    if (!faq) throw AppError.notFound(NOT_FOUND);
    return toAdmin(faq);
  }

  /*
   * What the website reads: active questions only, in display order. An empty list is a legitimate
   * answer — every question has been deactivated — and the site renders it as such.
   */
  async getPublic(): Promise<PublicFaq[]> {
    return (await faqRepository.findPublished()).map(toPublic);
  }

  async create(input: CreateFaqInput, req?: Request): Promise<AdminFaq> {
    const id = await AppDataSource.transaction(async (m) => {
      await assertQuestionFree(input.question, m);
      const faq = await faqRepository.create(
        {
          questionMr: input.question.mr,
          questionEn: input.question.en,
          answerMr: input.answer.mr,
          answerEn: input.answer.en,
          displayOrder: input.displayOrder ?? (await faqRepository.nextDisplayOrder(m)),
          isActive: input.isActive ?? true,
        },
        m,
      );
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.FAQ_CREATE,
        resource: 'faq',
        resourceId: faq.id,
        details: { question: faq.questionEn, displayOrder: faq.displayOrder, isActive: faq.isActive },
      });
      return faq.id;
    });
    return this.get(id);
  }

  async update(id: string, input: UpdateFaqInput, req?: Request): Promise<AdminFaq> {
    await AppDataSource.transaction(async (m) => {
      const faq = await faqRepository.findById(id, { manager: m });
      if (!faq) throw AppError.notFound(NOT_FOUND);
      if (input.question) await assertQuestionFree(input.question, m, id);
      await faqRepository.update(
        id,
        {
          ...(input.question ? { questionMr: input.question.mr, questionEn: input.question.en } : {}),
          ...(input.answer ? { answerMr: input.answer.mr, answerEn: input.answer.en } : {}),
          ...(input.displayOrder === undefined ? {} : { displayOrder: input.displayOrder }),
        },
        m,
      );
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.FAQ_UPDATE,
        resource: 'faq',
        resourceId: id,
        details: { fields: Object.keys(input), from: { question: faq.questionEn, displayOrder: faq.displayOrder } },
      });
    });
    return this.get(id);
  }

  /* Deactivation hides the question from the website but keeps it here, ready to bring back. */
  async setStatus(id: string, isActive: boolean, req?: Request): Promise<AdminFaq> {
    await AppDataSource.transaction(async (m) => {
      const faq = await faqRepository.findById(id, { manager: m });
      if (!faq) throw AppError.notFound(NOT_FOUND);
      await faqRepository.update(id, { isActive }, m);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.FAQ_STATUS,
        resource: 'faq',
        resourceId: id,
        details: { isActive, question: faq.questionEn },
      });
    });
    return this.get(id);
  }

  /* Soft-deletes the question: it leaves the website and the list, and stays in the table for audit. */
  async remove(id: string, req?: Request): Promise<void> {
    await AppDataSource.transaction(async (m) => {
      const faq = await faqRepository.findById(id, { manager: m });
      if (!faq) throw AppError.notFound(NOT_FOUND);
      await faqRepository.softDelete(id, m);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.FAQ_DELETE,
        resource: 'faq',
        resourceId: id,
        details: { question: faq.questionEn },
      });
    });
  }

  /* Brings a soft-deleted question back, inactive. Refused when the same question has been added meanwhile. */
  async restore(id: string, req?: Request): Promise<AdminFaq> {
    await AppDataSource.transaction(async (m) => {
      const existing = await faqRepository.findByIdIncludingDeleted(id, m);
      if (!existing) throw AppError.notFound(NOT_FOUND);
      if (!existing.isDelete) throw AppError.conflict('FAQ is not deleted');
      await assertQuestionFree({ mr: existing.questionMr, en: existing.questionEn }, m);
      await faqRepository.restore(id, m);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.FAQ_RESTORE,
        resource: 'faq',
        resourceId: id,
        details: { question: existing.questionEn },
      });
    });
    return this.get(id);
  }
}

export const faqService = new FaqService();
