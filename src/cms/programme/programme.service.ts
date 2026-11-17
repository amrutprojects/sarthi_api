import type { Request } from 'express';
import { AppDataSource } from '../../config/database.config';
import { AUDIT_ACTIONS } from '../../shared/constants/app.constants';
import { auditService } from '../../modules/audit/audit.service';
import { AppError } from '../../shared/errors/app-error';
import {
  PROGRAMME_FACT_KEYS,
  ProgrammePageSettings,
  type AssessmentRow,
  type BilingualText,
  type MethodologyRow,
  type ProgrammeFactKey,
  type ProgrammeFacts,
  type TrainingModes,
} from './programme.model';
import type { UpdateProgrammePageBody } from './programme.validator';

const NOT_CONFIGURED = 'The Programme page has not been configured yet. Run the database seed to create it.';

/*
 * What the public site prints: words and numbers only (no ids, timestamps or publication flag). The fact sheet's totals
 * (hours, module line, elective count) are not here: the site sums them from the published modules.
 */
export interface PublicProgrammePage {
  intro: BilingualText;
  objectives: BilingualText[];
  methodology: MethodologyRow[];
  assessment: AssessmentRow[];
  assessmentNote: BilingualText;
  certification: BilingualText[];
  trainingModes: TrainingModes;
  facts: ProgrammeFacts;
  /* The fact sheet rows the website leaves out, as keys in display order. Empty: every row is shown. */
  hiddenFacts: ProgrammeFactKey[];
}
export interface AdminProgrammePage extends PublicProgrammePage {
  id: string;
  isPublished: boolean;
  updatedAt: Date;
}

const repo = () => AppDataSource.getRepository(ProgrammePageSettings);
const current = () => repo().findOne({ where: { isDelete: false } });

/* Known keys only, once each, in display order, whatever order the column holds them in. */
const orderedHidden = (hidden: readonly string[]): ProgrammeFactKey[] => PROGRAMME_FACT_KEYS.filter((k) => hidden.includes(k));

const toPublic = (s: ProgrammePageSettings): PublicProgrammePage => ({
  intro: { mr: s.introMr, en: s.introEn },
  objectives: s.objectives,
  methodology: s.methodology,
  assessment: s.assessment,
  assessmentNote: { mr: s.assessmentNoteMr, en: s.assessmentNoteEn },
  certification: s.certification,
  trainingModes: s.trainingModes,
  facts: {
    idealMonths: s.idealMonths,
    validityMonths: s.validityMonths,
    securityDeposit: s.securityDeposit,
    applyLeadDays: s.applyLeadDays,
    partnerName: s.partnerName,
  },
  hiddenFacts: orderedHidden(s.hiddenFacts),
});
const toAdmin = (s: ProgrammePageSettings): AdminProgrammePage => ({
  id: s.id,
  ...toPublic(s),
  isPublished: s.isPublished,
  updatedAt: s.updatedAt,
});

export const programmeService = {
  /* Admin read: the whole page, published or not. */
  async getForAdmin(): Promise<AdminProgrammePage> {
    const s = await current();
    if (!s) throw AppError.notFound(NOT_CONFIGURED);
    return toAdmin(s);
  },

  /* Replaces the whole page in one transaction (what the admin screen submits). Audited with the section sizes and the fact sheet. */
  async update(input: UpdateProgrammePageBody, req: Request): Promise<AdminProgrammePage> {
    await AppDataSource.transaction(async (m) => {
      const s = await m.getRepository(ProgrammePageSettings).findOne({ where: { isDelete: false } });
      if (!s) throw AppError.notFound(NOT_CONFIGURED);
      await m.getRepository(ProgrammePageSettings).update(s.id, {
        introMr: input.intro.mr,
        introEn: input.intro.en,
        objectives: input.objectives,
        methodology: input.methodology,
        assessment: input.assessment,
        assessmentNoteMr: input.assessmentNote.mr,
        assessmentNoteEn: input.assessmentNote.en,
        certification: input.certification,
        trainingModes: input.trainingModes,
        idealMonths: input.facts.idealMonths,
        validityMonths: input.facts.validityMonths,
        securityDeposit: input.facts.securityDeposit,
        applyLeadDays: input.facts.applyLeadDays,
        partnerName: input.facts.partnerName,
        ...(input.isPublished !== undefined ? { isPublished: input.isPublished } : {}),
      });
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.PROGRAMME_PAGE_UPDATE,
        resource: 'programme-page',
        resourceId: s.id,
        details: {
          objectives: input.objectives.length,
          methodology: input.methodology.length,
          assessment: input.assessment.length,
          certification: input.certification.length,
          trainingModes: input.trainingModes.modes.length,
          facts: input.facts,
          isPublished: input.isPublished,
        },
      });
    });
    return this.getForAdmin();
  },

  async setPublished(isPublished: boolean, req: Request): Promise<AdminProgrammePage> {
    await AppDataSource.transaction(async (m) => {
      const s = await m.getRepository(ProgrammePageSettings).findOne({ where: { isDelete: false } });
      if (!s) throw AppError.notFound(NOT_CONFIGURED);
      await m.getRepository(ProgrammePageSettings).update(s.id, { isPublished });
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.PROGRAMME_PAGE_STATUS,
        resource: 'programme-page',
        resourceId: s.id,
        details: { isPublished },
      });
    });
    return this.getForAdmin();
  },

  /*
   * Shows or hides one fact sheet row, in one transaction with its audit entry. The row is locked first, so two
   * switches flipped at once cannot overwrite each other's change to the list. Only "hiddenFacts" is written, so the
   * figures cannot change here. Setting the current value writes nothing but is still audited, as the
   * administrator's action it was.
   */
  async setFactVisibility(key: ProgrammeFactKey, show: boolean, req: Request): Promise<AdminProgrammePage> {
    await AppDataSource.transaction(async (m) => {
      const s = await m.getRepository(ProgrammePageSettings).findOne({ where: { isDelete: false }, lock: { mode: 'pessimistic_write' } });
      if (!s) throw AppError.notFound(NOT_CONFIGURED);
      const hide = !show;
      if (s.hiddenFacts.includes(key) !== hide) {
        const next = PROGRAMME_FACT_KEYS.filter((k) => (k === key ? hide : s.hiddenFacts.includes(k)));
        await m.getRepository(ProgrammePageSettings).update(s.id, { hiddenFacts: next });
      }
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.PROGRAMME_FACT_VISIBILITY,
        resource: 'programme-page',
        resourceId: s.id,
        details: { key, show },
      });
    });
    return this.getForAdmin();
  },

  /* Public read: null when unpublished or not configured; the website then shows its bundled copy. */
  async getPublic(): Promise<PublicProgrammePage | null> {
    const s = await current();
    if (!s || !s.isPublished || !s.isActive) return null;
    return toPublic(s);
  },
};
