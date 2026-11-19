import { Column, Entity, Index } from 'typeorm';
import { AppBaseEntity } from '../../../database/base.entity';

/*
 * Student master register (A-18). Rows come from import finalisation (source IMPORT, approved) or from the public
 * registration API (source PUBLIC_REGISTRATION, status REGISTRATION_PENDING, not approved until an approved import
 * row is reconciled onto it as the same person; finalisation then makes it RECEIVED and keeps the source).
 * Aadhaar is stored encrypted with a blind index and last four digits; it is never returned unmasked.
 */
@Entity({ name: 'students' })
@Index('UQ_students_code', ['code'], { unique: true })
@Index('UQ_students_source_record', ['sourceRecordId'], { unique: true, where: '"isDelete" = false AND "sourceRecordId" IS NOT NULL' })
@Index('IDX_students_bidx', ['aadhaarBidx'])
@Index('UQ_students_registration_number', ['registrationNumber'], { unique: true })
@Index('IDX_students_regionId', ['regionId'])
@Index('IDX_students_casteId', ['casteId'])
@Index('IDX_students_educationId', ['educationId'])
@Index('UQ_students_registration_aadhaar', ['aadhaarBidx'], {
  unique: true,
  where: `"isDelete" = false AND "source" = 'PUBLIC_REGISTRATION' AND "aadhaarBidx" IS NOT NULL`,
})
export class Student extends AppBaseEntity {
  @Column({ type: 'varchar', length: 20 }) code!: string;
  @Column({ type: 'varchar', length: 64, name: 'sourceRecordId', nullable: true }) sourceRecordId!: string | null;
  @Column({ type: 'char', length: 64, name: 'sourceChecksum' }) sourceChecksum!: string;
  @Column({ type: 'varchar', length: 100, name: 'firstName' }) firstName!: string;
  @Column({ type: 'varchar', length: 100, name: 'lastName' }) lastName!: string;
  @Column({ type: 'varchar', length: 150, name: 'fatherName' }) fatherName!: string;
  @Column({ type: 'varchar', length: 150, name: 'motherName' }) motherName!: string;
  @Column({ type: 'varchar', length: 254, nullable: true }) email!: string | null;
  @Column({ type: 'date', name: 'dateOfBirth', nullable: true }) dateOfBirth!: string | null;
  @Column({ type: 'varchar', length: 500, name: 'currentAddress' }) currentAddress!: string;
  @Column({ type: 'bytea', name: 'aadhaarEnc', nullable: true }) aadhaarEnc!: Buffer | null;
  @Column({ type: 'char', length: 64, name: 'aadhaarBidx', nullable: true }) aadhaarBidx!: string | null;
  @Column({ type: 'char', length: 4, name: 'aadhaarLast4', nullable: true }) aadhaarLast4!: string | null;
  @Column({ type: 'varchar', length: 16, nullable: true }) mobile!: string | null;
  @Column({ type: 'varchar', length: 60 }) religion!: string;
  @Column({ type: 'varchar', length: 80 }) caste!: string;
  @Column({ type: 'varchar', length: 10, name: 'centreCode', nullable: true }) centreCode!: string | null;
  /* Null = track to be confirmed (source option not an approved track). */
  @Column({ type: 'varchar', length: 4, name: 'trackCode', nullable: true }) trackCode!: string | null;
  @Column({ type: 'varchar', length: 120, name: 'trackSourceValue' }) trackSourceValue!: string;
  @Column({ type: 'varchar', length: 150, name: 'educationQualification' }) educationQualification!: string;
  @Column({ type: 'varchar', length: 30, name: 'externalStatus' }) externalStatus!: string;
  @Column({ type: 'timestamptz', name: 'approvedAt', nullable: true }) approvedAt!: Date | null;
  @Column({ type: 'varchar', length: 120, name: 'evidenceRef', nullable: true }) evidenceRef!: string | null;
  @Column({ type: 'boolean', name: 'declarationAccepted', nullable: true }) declarationAccepted!: boolean | null;
  @Column({ type: 'jsonb', default: () => `'{}'::jsonb` }) documents!: Record<
    string,
    { supplied: boolean; barcode: string | null; documentTypeId?: string }
  >;
  @Column({ type: 'varchar', length: 30, default: 'RECEIVED' }) status!: string;
  @Column({ type: 'uuid', name: 'importBatchId', nullable: true }) importBatchId!: string | null;
  @Column({ type: 'varchar', length: 30, default: 'IMPORT' }) source!: string;
  /* Master references (migration 1792700000000); the text columns above keep the values as received. */
  @Column({ type: 'uuid', name: 'regionId', nullable: true }) regionId!: string | null;
  @Column({ type: 'uuid', name: 'casteId', nullable: true }) casteId!: string | null;
  @Column({ type: 'uuid', name: 'educationId', nullable: true }) educationId!: string | null;
  /* MMDDHHmmssSSSfff, allocated by the backend for registrations and at import finalisation (registration-number.ts). */
  @Column({ type: 'varchar', length: 16, name: 'registrationNumber', nullable: true }) registrationNumber!: string | null;
  /*
   * EDP portal details (migration 1795300000000). Null for imported and admin-entered records. Basic Details first,
   * then the Main Form's centre and qualification (the technology is trackCode).
   */
  @Column({ type: 'varchar', length: 20, nullable: true }) gender!: string | null;
  @Column({ type: 'varchar', length: 20, name: 'maritalStatus', nullable: true }) maritalStatus!: string | null;
  @Column({ type: 'varchar', length: 500, name: 'permanentAddress', nullable: true }) permanentAddress!: string | null;
  @Column({ type: 'varchar', length: 150, nullable: true }) landmark!: string | null;
  @Column({ type: 'uuid', name: 'districtId', nullable: true }) districtId!: string | null;
  @Column({ type: 'uuid', name: 'talukaId', nullable: true }) talukaId!: string | null;
  @Column({ type: 'char', length: 6, name: 'pinCode', nullable: true }) pinCode!: string | null;
  @Column({ type: 'varchar', length: 16, name: 'alternateMobile', nullable: true }) alternateMobile!: string | null;
  @Column({ type: 'varchar', length: 254, name: 'alternateEmail', nullable: true }) alternateEmail!: string | null;
  @Column({ type: 'boolean', name: 'disabilityStatus', nullable: true }) disabilityStatus!: boolean | null;
  @Column({ type: 'varchar', length: 100, name: 'disabilityType', nullable: true }) disabilityType!: string | null;
  @Column({ type: 'varchar', length: 50, name: 'disabilityCertificateNumber', nullable: true }) disabilityCertificateNumber!: string | null;
  @Column({ type: 'boolean', name: 'nameChanged', nullable: true }) nameChanged!: boolean | null;
  @Column({ type: 'uuid', name: 'centreId', nullable: true }) centreId!: string | null;
  @Column({ type: 'varchar', length: 150, name: 'qualificationName', nullable: true }) qualificationName!: string | null;
  @Column({ type: 'varchar', length: 150, name: 'qualificationStream', nullable: true }) qualificationStream!: string | null;
  @Column({ type: 'varchar', length: 200, name: 'qualificationBoard', nullable: true }) qualificationBoard!: string | null;
  @Column({ type: 'date', name: 'qualificationCompletedOn', nullable: true }) qualificationCompletedOn!: string | null;
  @Column({ type: 'varchar', length: 12, name: 'gradingType', nullable: true }) gradingType!: string | null;
  @Column({ type: 'smallint', name: 'cgpaScale', nullable: true }) cgpaScale!: number | null;
  /* numeric(5,2): returned by the driver as a string, e.g. "78.50". */
  @Column({ type: 'numeric', precision: 5, scale: 2, nullable: true }) score!: string | null;
  @Column({ type: 'varchar', length: 40, name: 'qualificationClass', nullable: true }) qualificationClass!: string | null;
  /*
   * Source details of an imported application (migration 1796100000000): district, taluka and division as received
   * (districtId / talukaId are set only when they match the geography masters), the scheme, the source's own
   * submission and last-update date-times and remarks, and the file's other columns as supplied (sourceExtra).
   */
  @Column({ type: 'varchar', length: 100, name: 'districtName', nullable: true }) districtName!: string | null;
  /* Also an EDP portal record's taluka, which is typed rather than selected (backfilled by migration 1798100000000). */
  @Column({ type: 'varchar', length: 100, name: 'talukaName', nullable: true }) talukaName!: string | null;
  @Column({ type: 'varchar', length: 100, nullable: true }) division!: string | null;
  @Column({ type: 'varchar', length: 150, name: 'schemeName', nullable: true }) schemeName!: string | null;
  @Column({ type: 'timestamptz', name: 'sourceSubmittedAt', nullable: true }) sourceSubmittedAt!: Date | null;
  @Column({ type: 'timestamptz', name: 'sourceUpdatedAt', nullable: true }) sourceUpdatedAt!: Date | null;
  @Column({ type: 'varchar', length: 1000, name: 'sourceRemarks', nullable: true }) sourceRemarks!: string | null;
  @Column({ type: 'jsonb', name: 'sourceExtra', default: () => `'{}'::jsonb` }) sourceExtra!: Record<string, string>;
}

/* The EDP portal's details as registrationService.register stores them (every key optional; absent = null). */
export type StudentProfile = Partial<
  Pick<
    Student,
    | 'gender'
    | 'maritalStatus'
    | 'permanentAddress'
    | 'landmark'
    | 'districtId'
    | 'talukaId'
    | 'pinCode'
    | 'alternateMobile'
    | 'alternateEmail'
    | 'disabilityStatus'
    | 'disabilityType'
    | 'disabilityCertificateNumber'
    | 'nameChanged'
    | 'centreId'
    | 'qualificationName'
    | 'qualificationStream'
    | 'qualificationBoard'
    | 'qualificationCompletedOn'
    | 'gradingType'
    | 'cgpaScale'
    | 'score'
    | 'qualificationClass'
  >
>;
