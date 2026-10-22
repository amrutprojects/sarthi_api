import { Column, Entity } from 'typeorm';
import { AppBaseEntity } from '../../database/base.entity';

/*
 * One question on the public FAQ page (/faq), in Marathi and English.
 *
 * The site defaults to Marathi and renders every string through bi(), so both halves are required —
 * a question answered in one language only leaves half the visitors looking at a blank line.
 *
 * Each question is its own record rather than a row under a page singleton: the admin screen adds,
 * edits, reorders, deactivates and deletes questions one at a time, like the other CMS masters.
 * `isActive` is what the website filters on, and `displayOrder` is the order it lists them in.
 */
@Entity({ name: 'faqs' })
export class Faq extends AppBaseEntity {
  @Column({ type: 'varchar', length: 500, name: 'questionMr' })
  questionMr!: string;

  @Column({ type: 'varchar', length: 500, name: 'questionEn' })
  questionEn!: string;

  @Column({ type: 'varchar', length: 2000, name: 'answerMr' })
  answerMr!: string;

  @Column({ type: 'varchar', length: 2000, name: 'answerEn' })
  answerEn!: string;

  @Column({ type: 'integer', name: 'displayOrder', default: 0 })
  displayOrder!: number;
}
