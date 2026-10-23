import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany } from 'typeorm';
import { AppBaseEntity } from '../../database/base.entity';

/*
 * The home page's hero: the rotating banner at the top of the page.
 *
 * This row holds what every slide shares — the labels of the two buttons printed on each of them
 * ("Learn more" → /programme, "Check Application Status" → /track) — and the publish switch. The
 * slides themselves are a list an administrator adds to, reorders and hides, so they get a table.
 *
 * The labels are the hero's OWN copies. The website prints the same words elsewhere from its global
 * strings; editing them here must change the hero only.
 *
 * NOT here: the "Programme at a glance" card beside the banner. Its figures are summed from the
 * modules, and its district count is stored with the Modules page content — the Home Hero Section
 * screen edits it, but through modulesRepository, not this table.
 */
@Entity({ name: 'home_hero' })
export class HomeHero extends AppBaseEntity {
  /* The first of the two buttons on every slide; it always goes to the Programme page. */
  @Column({ type: 'varchar', length: 60, name: 'readMoreLabelMr' })
  readMoreLabelMr!: string;

  @Column({ type: 'varchar', length: 60, name: 'readMoreLabelEn' })
  readMoreLabelEn!: string;

  /* The second one; it always goes to the application tracker. */
  @Column({ type: 'varchar', length: 60, name: 'checkStatusLabelMr' })
  checkStatusLabelMr!: string;

  @Column({ type: 'varchar', length: 60, name: 'checkStatusLabelEn' })
  checkStatusLabelEn!: string;

  @Column({ type: 'boolean', name: 'isPublished', default: true })
  isPublished!: boolean;

  @OneToMany('HomeHeroSlide', (s: HomeHeroSlide) => s.hero)
  slides!: HomeHeroSlide[];
}

/*
 * One slide of the banner: its tag, heading, description and its own button.
 *
 * `ctaLink` is a page of this site ('/apply'), never a full URL: it lands in an href on the home
 * page, so the database refuses anything else (see the migration's CHECK).
 */
@Entity({ name: 'home_hero_slides' })
@Index('IDX_home_hero_slides_heroId', ['heroId'])
export class HomeHeroSlide extends AppBaseEntity {
  @Column({ type: 'uuid', name: 'heroId' })
  heroId!: string;

  /* The small label above the heading — "प्रवेश सुरू" / "Admissions open". */
  @Column({ type: 'varchar', length: 60, name: 'tagMr' })
  tagMr!: string;

  @Column({ type: 'varchar', length: 60, name: 'tagEn' })
  tagEn!: string;

  /* Printed as the page's h1. */
  @Column({ type: 'varchar', length: 200, name: 'titleMr' })
  titleMr!: string;

  @Column({ type: 'varchar', length: 200, name: 'titleEn' })
  titleEn!: string;

  @Column({ type: 'varchar', length: 400, name: 'descriptionMr' })
  descriptionMr!: string;

  @Column({ type: 'varchar', length: 400, name: 'descriptionEn' })
  descriptionEn!: string;

  @Column({ type: 'varchar', length: 60, name: 'ctaLabelMr' })
  ctaLabelMr!: string;

  @Column({ type: 'varchar', length: 60, name: 'ctaLabelEn' })
  ctaLabelEn!: string;

  @Column({ type: 'varchar', length: 200, name: 'ctaLink' })
  ctaLink!: string;

  @Column({ type: 'integer', name: 'displayOrder', default: 0 })
  displayOrder!: number;

  @ManyToOne('HomeHero', (h: HomeHero) => h.slides, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'heroId' })
  hero!: HomeHero;
}
