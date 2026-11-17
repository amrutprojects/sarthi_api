import { Column, Entity } from 'typeorm';
import { AppBaseEntity } from '../../database/base.entity';

/*
 * The home page's "Programme Progress – Live Dashboard": its texts, which of its parts are shown, and
 * the two training-mode totals behind the donut. A singleton; the KPI cards, the side figures and the
 * district figures are rows of the three tables below.
 *
 * Every figure is stored as entered — nothing here counts candidates, batches or centres. Optional
 * texts (subtitle, disclaimer) are blank in both languages (left out) or filled in both.
 */
@Entity({ name: 'live_dashboard_settings' })
export class LiveDashboardSettings extends AppBaseEntity {
  @Column({ type: 'varchar', length: 150, name: 'headingMr' })
  headingMr!: string;

  @Column({ type: 'varchar', length: 150, name: 'headingEn' })
  headingEn!: string;

  @Column({ type: 'varchar', length: 300, name: 'subtitleMr', default: '' })
  subtitleMr!: string;

  @Column({ type: 'varchar', length: 300, name: 'subtitleEn', default: '' })
  subtitleEn!: string;

  /* The whole section. Written only by the "Show on website" switch (src/cms/visibility). */
  @Column({ type: 'boolean', name: 'showSection', default: true })
  showSection!: boolean;

  @Column({ type: 'varchar', length: 300, name: 'disclaimerMr', default: '' })
  disclaimerMr!: string;

  @Column({ type: 'varchar', length: 300, name: 'disclaimerEn', default: '' })
  disclaimerEn!: string;

  @Column({ type: 'boolean', name: 'showDisclaimer', default: true })
  showDisclaimer!: boolean;

  @Column({ type: 'varchar', length: 120, name: 'mapTitleMr' })
  mapTitleMr!: string;

  @Column({ type: 'varchar', length: 120, name: 'mapTitleEn' })
  mapTitleEn!: string;

  @Column({ type: 'boolean', name: 'showMap', default: true })
  showMap!: boolean;

  @Column({ type: 'varchar', length: 120, name: 'modesTitleMr' })
  modesTitleMr!: string;

  @Column({ type: 'varchar', length: 120, name: 'modesTitleEn' })
  modesTitleEn!: string;

  @Column({ type: 'boolean', name: 'showModes', default: true })
  showModes!: boolean;

  @Column({ type: 'varchar', length: 60, name: 'offlineLabelMr' })
  offlineLabelMr!: string;

  @Column({ type: 'varchar', length: 60, name: 'offlineLabelEn' })
  offlineLabelEn!: string;

  @Column({ type: 'varchar', length: 60, name: 'onlineLabelMr' })
  onlineLabelMr!: string;

  @Column({ type: 'varchar', length: 60, name: 'onlineLabelEn' })
  onlineLabelEn!: string;

  @Column({ type: 'integer', name: 'offlineCount', default: 0 })
  offlineCount!: number;

  @Column({ type: 'integer', name: 'onlineCount', default: 0 })
  onlineCount!: number;

  @Column({ type: 'varchar', length: 40, name: 'donutCenterLabelMr' })
  donutCenterLabelMr!: string;

  @Column({ type: 'varchar', length: 40, name: 'donutCenterLabelEn' })
  donutCenterLabelEn!: string;
}

/*
 * One KPI card ("Total target 2,000 — students"). `value` is free text as printed ("2,000", "87%").
 * `link` is '' (the card is not a link) or a page of this site — never an outside address: the
 * cards are the programme's own figures. `tone` is one of LIVE_DASHBOARD_TONES.
 */
@Entity({ name: 'live_dashboard_cards' })
export class LiveDashboardCard extends AppBaseEntity {
  @Column({ type: 'varchar', length: 60, name: 'labelMr' })
  labelMr!: string;

  @Column({ type: 'varchar', length: 60, name: 'labelEn' })
  labelEn!: string;

  @Column({ type: 'varchar', length: 20, name: 'value' })
  value!: string;

  @Column({ type: 'varchar', length: 120, name: 'detailMr', default: '' })
  detailMr!: string;

  @Column({ type: 'varchar', length: 120, name: 'detailEn', default: '' })
  detailEn!: string;

  @Column({ type: 'varchar', length: 200, name: 'link', default: '' })
  link!: string;

  @Column({ type: 'varchar', length: 10, name: 'tone', default: 'default' })
  tone!: string;

  @Column({ type: 'integer', name: 'displayOrder', default: 0 })
  displayOrder!: number;
}

/* One line of the figures list beside the training-modes donut ("Approved centres 10"). */
@Entity({ name: 'live_dashboard_stats' })
export class LiveDashboardStat extends AppBaseEntity {
  @Column({ type: 'varchar', length: 80, name: 'labelMr' })
  labelMr!: string;

  @Column({ type: 'varchar', length: 80, name: 'labelEn' })
  labelEn!: string;

  @Column({ type: 'varchar', length: 30, name: 'value' })
  value!: string;

  @Column({ type: 'integer', name: 'displayOrder', default: 0 })
  displayOrder!: number;
}

/*
 * One district tile of the map: its programme status and figures. The 36 rows are fixed — they are
 * the website's map tiles, joined by `districtCode` — so they are edited, never added or deleted.
 */
@Entity({ name: 'live_dashboard_districts' })
export class LiveDashboardDistrict extends AppBaseEntity {
  @Column({ type: 'varchar', length: 3, name: 'districtCode' })
  districtCode!: string;

  @Column({ type: 'varchar', length: 60, name: 'nameMr' })
  nameMr!: string;

  @Column({ type: 'varchar', length: 60, name: 'nameEn' })
  nameEn!: string;

  @Column({ type: 'varchar', length: 20, name: 'status' })
  status!: string;

  @Column({ type: 'integer', name: 'target', default: 0 })
  target!: number;

  @Column({ type: 'integer', name: 'enrolled', default: 0 })
  enrolled!: number;

  @Column({ type: 'integer', name: 'trainingActive', default: 0 })
  trainingActive!: number;

  @Column({ type: 'integer', name: 'completed', default: 0 })
  completed!: number;

  @Column({ type: 'integer', name: 'certified', default: 0 })
  certified!: number;

  @Column({ type: 'integer', name: 'attendancePct', default: 0 })
  attendancePct!: number;

  @Column({ type: 'integer', name: 'displayOrder', default: 0 })
  displayOrder!: number;
}
