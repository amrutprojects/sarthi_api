import { P } from '../modules/roles-permissions/permission.constants';
import { defineDependencies, rowsWhere, type DependencyKind } from '../shared/dependencies/dependencies';

/*
 * What keeps website content from being deleted (shared/dependencies). Nearly all of it is leaf content that nothing
 * points at, so it has no rules; it goes through the same check so that a reference added later needs one line here.
 * An advisory group is used by its members: it is no longer ungrouped silently, the members move first.
 * A contact coordinator's districts are part of the coordinator (the website's contact list), not something that uses it.
 * The geography masters (state, district, taluka) are in masters/geography.dependencies.ts.
 */
const leaf = (kind: string, noun: string, table: string, permission: string): DependencyKind =>
  defineDependencies({ kind, noun, table, permission, rules: [] });

export const ABOUT_FACT_DEPENDENCIES = leaf('about-fact', 'information row', 'about_facts', P.CMS_ABOUT_DELETE);
export const ABOUT_CARD_DEPENDENCIES = leaf('about-card', 'card', 'about_cards', P.CMS_ABOUT_DELETE);
export const ADVISORY_MEMBER_DEPENDENCIES = leaf('advisory-member', 'member', 'advisory_members', P.CMS_ADVISORY_DELETE);
export const ANNOUNCEMENT_DEPENDENCIES = leaf('announcement', 'announcement', 'announcements', P.CMS_ANNOUNCEMENTS_DELETE);
export const APPLY_ITEM_DEPENDENCIES = leaf('apply-item', 'item', 'apply_page_items', P.CMS_APPLY_DELETE);
export const BOARD_MEMBER_DEPENDENCIES = leaf('board-member', 'board member', 'board_members', P.CMS_BOARD_DELETE);
export const CONTACT_COORDINATOR_DEPENDENCIES = leaf('contact-coordinator', 'coordinator', 'contact_coordinators', P.CMS_CONTACT_UPDATE);
export const CONTACT_DISTRICT_OFFICE_DEPENDENCIES = leaf(
  'contact-district-office',
  'district office',
  'contact_district_offices',
  P.CMS_CONTACT_UPDATE,
);
export const CONTACT_TRAINING_CENTRE_DEPENDENCIES = leaf(
  'contact-training-centre',
  'training centre',
  'contact_training_centres',
  P.CMS_CONTACT_UPDATE,
);
export const ECOSYSTEM_PROGRAMME_DEPENDENCIES = leaf('ecosystem-programme', 'programme', 'ecosystem_programmes', P.CMS_ECOSYSTEM_DELETE);
export const ELIGIBILITY_ITEM_DEPENDENCIES = leaf('eligibility-item', 'item', 'eligibility_items', P.CMS_ELIGIBILITY_DELETE);
export const FAQ_DEPENDENCIES = leaf('faq', 'FAQ', 'faqs', P.CMS_FAQS_DELETE);
export const IMPACT_STAT_DEPENDENCIES = leaf('impact-stat', 'impact figure', 'impact_stats', P.CMS_IMPACT_DELETE);
export const LIVE_DASHBOARD_CARD_DEPENDENCIES = leaf('live-dashboard-card', 'dashboard card', 'live_dashboard_cards', P.CMS_LIVEDASHBOARD_DELETE);
export const LIVE_DASHBOARD_STAT_DEPENDENCIES = leaf('live-dashboard-stat', 'dashboard figure', 'live_dashboard_stats', P.CMS_LIVEDASHBOARD_DELETE);
export const QUICK_ACTION_DEPENDENCIES = leaf('quick-action', 'quick action', 'quick_actions', P.CMS_QUICKACTIONS_DELETE);
export const SCHEME_DEPENDENCIES = leaf('scheme', 'scheme', 'amrut_schemes', P.CMS_SCHEMES_DELETE);
export const TOP_BAR_LINK_DEPENDENCIES = leaf('top-bar-link', 'link', 'top_bar_links', P.CMS_TOPBAR_DELETE);

export const ADVISORY_GROUP_DEPENDENCIES = defineDependencies({
  kind: 'advisory-group',
  noun: 'group',
  table: 'advisory_groups',
  permission: P.CMS_ADVISORY_DELETE,
  hint: 'Move its members to another group, or out of every group, first.',
  rules: [rowsWhere('advisory committee members', 'advisory_members', 'groupId')],
});
