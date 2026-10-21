import { Column, Entity, Index } from 'typeorm';
import { AppBaseEntity } from '../../database/base.entity';

/*
 * The public Eligibility page (/eligibility), in Marathi and English.
 *
 * The site defaults to Marathi and renders every string through bi(), so both halves of every pair
 * are required — a line in one language only leaves half the visitors looking at a blank.
 *
 * Two tables, because the page has two shapes of content:
 * - the text around the lists (hero title and subtitle, the two card headings, the note) is
 *   single-valued, so it lives on one settings row;
 * - the criteria and the required documents are lists the admin screen adds to, edits, reorders,
 *   deactivates and deletes one entry at a time, like the other CMS masters, so each is its own row.
 *
 * The "Apply now" / "Check status" buttons under the note are site-wide strings and routes, not
 * page content, and stay in the website's code.
 */

/*
 * What one list row is:
 *   CRITERION — a label/value row in the "Eligibility criteria" card ("Age" — "18 to 45 years")
 *   DOCUMENT  — a single line in the "Required documents" card ("Aadhaar card")
 */
export const ELIGIBILITY_ITEM_KINDS = ['CRITERION', 'DOCUMENT'] as const;
export type EligibilityItemKind = (typeof ELIGIBILITY_ITEM_KINDS)[number];

/*
 * The page text. A singleton, enforced the same way the Contact, footer and Modules pages are:
 * UQ_eligibility_page_settings_singleton, a unique index on a constant expression that admits
 * exactly one non-deleted row. The migration creates it; there is no create or delete endpoint.
 */
@Entity({ name: 'eligibility_page_settings' })
export class EligibilityPageSettings extends AppBaseEntity {
  @Column({ type: 'varchar', length: 200, name: 'pageTitleMr' })
  pageTitleMr!: string;

  @Column({ type: 'varchar', length: 200, name: 'pageTitleEn' })
  pageTitleEn!: string;

  @Column({ type: 'varchar', length: 500, name: 'pageSubtitleMr' })
  pageSubtitleMr!: string;

  @Column({ type: 'varchar', length: 500, name: 'pageSubtitleEn' })
  pageSubtitleEn!: string;

  @Column({ type: 'varchar', length: 200, name: 'criteriaHeadingMr' })
  criteriaHeadingMr!: string;

  @Column({ type: 'varchar', length: 200, name: 'criteriaHeadingEn' })
  criteriaHeadingEn!: string;

  @Column({ type: 'varchar', length: 200, name: 'documentsHeadingMr' })
  documentsHeadingMr!: string;

  @Column({ type: 'varchar', length: 200, name: 'documentsHeadingEn' })
  documentsHeadingEn!: string;

  /* The warning callout under the two cards. */
  @Column({ type: 'varchar', length: 200, name: 'noteTitleMr' })
  noteTitleMr!: string;

  @Column({ type: 'varchar', length: 200, name: 'noteTitleEn' })
  noteTitleEn!: string;

  @Column({ type: 'varchar', length: 2000, name: 'noteBodyMr' })
  noteBodyMr!: string;

  @Column({ type: 'varchar', length: 2000, name: 'noteBodyEn' })
  noteBodyEn!: string;
}

/*
 * One eligibility criterion or one required document.
 *
 * `value` is required for a CRITERION and forbidden for a DOCUMENT, enforced by
 * CHK_eligibility_items_value_by_kind. The kind is fixed at creation: turning a criterion into a
 * document would silently drop its value. `isActive` is what the website filters on, and
 * `displayOrder` is the order it lists each kind in.
 */
@Entity({ name: 'eligibility_items' })
@Index('IDX_eligibility_items_kind', ['kind'])
export class EligibilityItem extends AppBaseEntity {
  @Column({ type: 'varchar', length: 16, name: 'kind' })
  kind!: EligibilityItemKind;

  @Column({ type: 'varchar', length: 300, name: 'labelMr' })
  labelMr!: string;

  @Column({ type: 'varchar', length: 300, name: 'labelEn' })
  labelEn!: string;

  /* Null for a DOCUMENT. */
  @Column({ type: 'varchar', length: 1000, name: 'valueMr', nullable: true })
  valueMr!: string | null;

  @Column({ type: 'varchar', length: 1000, name: 'valueEn', nullable: true })
  valueEn!: string | null;

  @Column({ type: 'integer', name: 'displayOrder', default: 0 })
  displayOrder!: number;
}
