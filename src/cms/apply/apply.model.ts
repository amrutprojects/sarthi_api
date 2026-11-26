import { Column, Entity, Index } from 'typeorm';
import { AppBaseEntity } from '../../database/base.entity';

/*
 * The public Apply page (/apply, "How to Apply"), in Marathi and English.
 *
 * The site defaults to Marathi and renders every string through bi(), so both halves of every pair
 * are required — a line in one language only leaves half the visitors looking at a blank.
 *
 * Two tables, because the page has two shapes of content:
 * - the text around the lists (hero title and subtitle, the note under the steps, the two card
 *   headings, the call to action and its portal link) is single-valued, so it lives on one settings row;
 * - the application steps and the "At a glance" rows are lists the admin screen adds to, edits,
 *   reorders, deactivates and deletes one entry at a time, like the other CMS masters, so each is
 *   its own row.
 *
 * The "Documents to keep ready" card is NOT stored here: it is the same list the Eligibility page
 * shows, so the public feed reads the active DOCUMENT rows of eligibility_items and an administrator
 * edits it once, in Eligibility Page Management. The "Check status" button is a site route, not
 * page content, and stays in the website's code.
 */

/*
 * What one list row is:
 *   STEP — one numbered step of the application ladder: a title and a description
 *          ("Online application" — "Apply online on the Sarthi portal …")
 *   FACT — one label/value row in the "At a glance" card ("Security deposit" — "₹2,000 (refundable)")
 * Both carry a value, so unlike the eligibility items there is no value-by-kind rule.
 */
export const APPLY_ITEM_KINDS = ['STEP', 'FACT'] as const;
export type ApplyItemKind = (typeof APPLY_ITEM_KINDS)[number];

/*
 * The page text. A singleton, enforced the same way the Contact, footer, Modules and Eligibility
 * pages are: UQ_apply_page_settings_singleton, a unique index on a constant expression that admits
 * exactly one non-deleted row. The migration creates it; there is no create or delete endpoint.
 */
@Entity({ name: 'apply_page_settings' })
export class ApplyPageSettings extends AppBaseEntity {
  @Column({ type: 'varchar', length: 200, name: 'pageTitleMr' })
  pageTitleMr!: string;

  @Column({ type: 'varchar', length: 200, name: 'pageTitleEn' })
  pageTitleEn!: string;

  @Column({ type: 'varchar', length: 500, name: 'pageSubtitleMr' })
  pageSubtitleMr!: string;

  @Column({ type: 'varchar', length: 500, name: 'pageSubtitleEn' })
  pageSubtitleEn!: string;

  /* The info callout under the steps ("Important" — apply at least 30 days ahead). */
  @Column({ type: 'varchar', length: 200, name: 'noteTitleMr' })
  noteTitleMr!: string;

  @Column({ type: 'varchar', length: 200, name: 'noteTitleEn' })
  noteTitleEn!: string;

  @Column({ type: 'varchar', length: 2000, name: 'noteBodyMr' })
  noteBodyMr!: string;

  @Column({ type: 'varchar', length: 2000, name: 'noteBodyEn' })
  noteBodyEn!: string;

  /* The two card headings of the right-hand rail. */
  @Column({ type: 'varchar', length: 200, name: 'glanceHeadingMr' })
  glanceHeadingMr!: string;

  @Column({ type: 'varchar', length: 200, name: 'glanceHeadingEn' })
  glanceHeadingEn!: string;

  @Column({ type: 'varchar', length: 200, name: 'documentsHeadingMr' })
  documentsHeadingMr!: string;

  @Column({ type: 'varchar', length: 200, name: 'documentsHeadingEn' })
  documentsHeadingEn!: string;

  /* The call to action: intro text, the button label, the portal it opens and the hint under it. */
  @Column({ type: 'varchar', length: 1000, name: 'ctaTextMr' })
  ctaTextMr!: string;

  @Column({ type: 'varchar', length: 1000, name: 'ctaTextEn' })
  ctaTextEn!: string;

  @Column({ type: 'varchar', length: 100, name: 'ctaLabelMr' })
  ctaLabelMr!: string;

  @Column({ type: 'varchar', length: 100, name: 'ctaLabelEn' })
  ctaLabelEn!: string;

  /* One link for both languages; always https (CHK_apply_page_settings_cta_url), as it ends up in an href. */
  @Column({ type: 'varchar', length: 500, name: 'ctaUrl' })
  ctaUrl!: string;

  @Column({ type: 'varchar', length: 300, name: 'ctaHintMr' })
  ctaHintMr!: string;

  @Column({ type: 'varchar', length: 300, name: 'ctaHintEn' })
  ctaHintEn!: string;
}

/*
 * One application step or one "At a glance" row.
 *
 * `label` is a step's title or a fact's label; `value` is a step's description or a fact's value.
 * The kind is fixed at creation: moving a row between the two lists is a delete and a create.
 * `isActive` is what the website filters on, and `displayOrder` is the order it lists each kind in
 * (a step's number on the page is its position, not this value).
 */
@Entity({ name: 'apply_page_items' })
@Index('IDX_apply_page_items_kind', ['kind'])
export class ApplyPageItem extends AppBaseEntity {
  @Column({ type: 'varchar', length: 16, name: 'kind' })
  kind!: ApplyItemKind;

  @Column({ type: 'varchar', length: 300, name: 'labelMr' })
  labelMr!: string;

  @Column({ type: 'varchar', length: 300, name: 'labelEn' })
  labelEn!: string;

  @Column({ type: 'varchar', length: 2000, name: 'valueMr' })
  valueMr!: string;

  @Column({ type: 'varchar', length: 2000, name: 'valueEn' })
  valueEn!: string;

  @Column({ type: 'integer', name: 'displayOrder', default: 0 })
  displayOrder!: number;
}
