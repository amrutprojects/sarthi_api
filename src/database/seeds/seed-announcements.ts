import type { DataSource, EntityManager } from 'typeorm';
import { Announcement, AnnouncementSettings } from '../../cms/announcements/announcements.model';

export interface AnnouncementsSeedSummary {
  created: boolean;
  announcementsCreated: number;
}

/*
 * The announcement ticker: its label ("सूचना" / "Announcements") and no announcements, so the
 * website shows no strip until an administrator adds one in the admin panel.
 */
const SETTINGS = {
  labelMr: 'सूचना',
  labelEn: 'Announcements',
  showSection: true,
};

const ANNOUNCEMENTS: { titleMr: string; titleEn: string }[] = [];

/*
 * Idempotent, and deliberately all-or-nothing about it: if the ticker's settings row already exists
 * this does NOTHING AT ALL. Seeding is a first-run step; after that the content belongs to whoever
 * edits it in the admin panel, and re-running the seed must never undo that work or bring back an
 * announcement someone deleted.
 *
 * Runs in one transaction so a half-seeded ticker can never be committed.
 */
export async function seedAnnouncements(ds: DataSource): Promise<AnnouncementsSeedSummary> {
  return ds.transaction(async (m: EntityManager) => {
    const settings = m.getRepository(AnnouncementSettings);
    if (await settings.findOne({ where: { isDelete: false } })) return { created: false, announcementsCreated: 0 };

    await settings.save(settings.create(SETTINGS));
    if (ANNOUNCEMENTS.length > 0) {
      await m.getRepository(Announcement).insert(
        ANNOUNCEMENTS.map((a, i) => ({
          detailMr: '',
          detailEn: '',
          link: null,
          ...a,
          displayOrder: i + 1,
        })),
      );
    }
    return { created: true, announcementsCreated: ANNOUNCEMENTS.length };
  });
}
