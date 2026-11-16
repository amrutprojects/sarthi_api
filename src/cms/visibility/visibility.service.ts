import type { Request } from 'express';
import { AppDataSource } from '../../config/database.config';
import { auditService } from '../../modules/audit/audit.service';
import { AUDIT_ACTIONS } from '../../shared/constants/app.constants';
import { AppError } from '../../shared/errors/app-error';
import { SECTIONS, sectionOf, type SectionDefinition, type SectionRow } from './visibility.registry';
import type { SectionKey, SectionVisibility } from './visibility.types';

const NOT_CONFIGURED = 'This section has not been configured yet. Run the database seed to create it.';

/* Nothing hides a section that has no row, so it reads as visible — and not configured, so the switch is disabled. */
const toItem = (s: SectionDefinition, row: SectionRow | null): SectionVisibility => ({
  key: s.key,
  menu: s.menu,
  visible: row?.visible ?? true,
  configured: row !== null,
  updatedAt: row?.updatedAt ?? null,
});

/*
 * "Show on website" (CMS → Home Page Management): one switch per tab, each driving one flag of that
 * section's settings row. A section's own settings screen and public feed are untouched; the feed
 * reports the flag (`showSection`, `showGlance`) and the website leaves a hidden section out.
 *
 * Only the flag column is written, so the section's text and its other settings cannot change here.
 * The write does bump the row's `updatedAt` — deliberately: a settings page opened before the switch
 * then gets the usual "changed after you opened it" 409 instead of silently saving over a version
 * it never saw.
 */
export class VisibilityService {
  /* The switches whose tab the user may open (`<menu>.view`), in tab order. */
  async list(permissions: ReadonlySet<string>): Promise<SectionVisibility[]> {
    const visible = SECTIONS.filter((s) => permissions.has(`${s.menu}.view`));
    return Promise.all(visible.map(async (s) => toItem(s, await s.find())));
  }

  /*
   * Sets one switch, in one transaction with its audit entry. The row is locked first, so the switch
   * serialises with a concurrent save of the section's settings.
   *
   * Setting the current value succeeds without writing the row — so its version stays and a settings
   * page open elsewhere can still save — but is still audited, as the administrator's action it was.
   */
  async set(key: SectionKey, visible: boolean, req?: Request): Promise<SectionVisibility> {
    const section = sectionOf(key);
    await AppDataSource.transaction(async (m) => {
      const row = await section.findForUpdate(m);
      if (!row) throw AppError.notFound(NOT_CONFIGURED);
      if (row.visible !== visible) await section.write(row.id, visible, m);
      await auditService.recordInTx(m, req, {
        action: AUDIT_ACTIONS.SECTION_VISIBILITY_UPDATE,
        resource: 'section-visibility',
        resourceId: key,
        details: { key, visible },
      });
    });
    return toItem(section, await section.find());
  }
}

export const visibilityService = new VisibilityService();
