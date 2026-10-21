import type { Request } from 'express';
import { AppDataSource } from '../../config/database.config';
import { AUDIT_ACTIONS } from '../../shared/constants/app.constants';
import { auditService } from '../../modules/audit/audit.service';
import { AppError } from '../../shared/errors/app-error';
import { ProgrammePageSettings, type AssessmentRow, type BilingualText, type MethodologyRow, type TrainingModes } from './programme.model';
import type { UpdateProgrammePageBody } from './programme.validator';

const NOT_CONFIGURED = 'The Programme page has not been configured yet. Run the database seed to create it.';

/* What the public site prints: words and numbers only (no ids, timestamps or publication flag). */
export interface PublicProgrammePage {
  intro: BilingualText;
  objectives: BilingualText[];
  methodology: MethodologyRow[];
  assessment: AssessmentRow[];
  assessmentNote: BilingualText;
  certification: BilingualText[];
  trainingModes: TrainingModes;
}
export interface AdminProgrammePage extends PublicProgrammePage {
  id: string;
  isPublished: boolean;
  updatedAt: Date;
}

const repo = () => AppDataSource.getRepository(ProgrammePageSettings);
const current = () => repo().findOne({ where: { isDelete: false } });

const toPublic = (s: ProgrammePageSettings): PublicProgrammePage => ({
  intro: { mr: s.introMr, en: s.introEn },
  objectives: s.objectives,
  methodology: s.methodology,
  assessment: s.assessment,
  assessmentNote: { mr: s.assessmentNoteMr, en: s.assessmentNoteEn },
  certification: s.certification,
  trainingModes: s.trainingModes,
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

  /* Replaces the whole page in one transaction (what the admin screen submits). Audited with the section names. */
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

  /* Public read: null when unpublished or not configured; the website then shows its bundled copy. */
  async getPublic(): Promise<PublicProgrammePage | null> {
    const s = await current();
    if (!s || !s.isPublished || !s.isActive) return null;
    return toPublic(s);
  },
};
