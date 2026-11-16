import { Column, Entity, Index } from 'typeorm';
import { AppBaseEntity } from '../../database/base.entity';

/*
 * Reference-data masters (Region, Caste, Document type, Education). Each has code, name, description and the common
 * active / soft-delete flags. Code and name are unique across every row, deleted ones included, so a value used by a
 * soft-deleted record can never be created again (indexes in migration 1792700000000).
 */
export abstract class MasterEntity extends AppBaseEntity {
  /* Upper-case, letters / digits / underscore / hyphen. */
  @Column({ type: 'varchar', length: 20 }) code!: string;
  @Column({ type: 'varchar', length: 150 }) name!: string;
  @Column({ type: 'varchar', length: 500, nullable: true }) description!: string | null;
}

/* Region = course centre (district / location) a student registers for; code is stored in students.centreCode. */
@Entity({ name: 'regions' })
@Index('UQ_regions_code', ['code'], { unique: true })
export class Region extends MasterEntity {}

/*
 * `name` is the Marathi name (the official list's spelling); `nameEn` is shown on the English website. Castes are
 * listed in `displayOrder` (the official sequence), not by name (migration 1796600000000).
 */
@Entity({ name: 'castes' })
@Index('UQ_castes_code', ['code'], { unique: true })
export class Caste extends MasterEntity {
  @Column({ type: 'varchar', length: 150, name: 'nameEn', nullable: true }) nameEn!: string | null;
  @Column({ type: 'integer', name: 'displayOrder', default: 0 }) displayOrder!: number;
}

/* Document type definitions (PAN, Aadhaar, LC, …); code matches the import's doc_<code> column and student_documents.docType. */
@Entity({ name: 'document_types' })
@Index('UQ_document_types_code', ['code'], { unique: true })
export class DocumentType extends MasterEntity {
  @Column({ type: 'boolean', name: 'isMandatory', default: false }) isMandatory!: boolean;
}

@Entity({ name: 'educations' })
@Index('UQ_educations_code', ['code'], { unique: true })
export class Education extends MasterEntity {}
