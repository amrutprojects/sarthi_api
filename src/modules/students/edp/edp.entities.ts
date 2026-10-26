import { Column, Entity } from 'typeorm';
import { AppBaseEntity } from '../../../database/base.entity';

/* A student's EDP portal sign-in (migration 1794700000000). Usable once the emailed one-time code is verified. */
@Entity({ name: 'edp_accounts' })
export class EdpAccount extends AppBaseEntity {
  @Column({ type: 'varchar', length: 100, name: 'firstName' }) firstName!: string;
  @Column({ type: 'varchar', length: 100, name: 'middleName', nullable: true }) middleName!: string | null;
  @Column({ type: 'varchar', length: 100, name: 'lastName' }) lastName!: string;
  /* Always lower-cased. */
  @Column({ type: 'varchar', length: 254 }) email!: string;
  /* 10 digits. */
  @Column({ type: 'varchar', length: 16 }) mobile!: string;
  @Column({ type: 'varchar', length: 255, name: 'passwordHash', select: false }) passwordHash!: string;
  @Column({ type: 'timestamptz', name: 'emailVerifiedAt', nullable: true }) emailVerifiedAt!: Date | null;
  /* HMAC of the pending one-time code; null when none is pending. */
  @Column({ type: 'char', length: 64, name: 'otpHash', nullable: true, select: false }) otpHash!: string | null;
  @Column({ type: 'timestamptz', name: 'otpExpiresAt', nullable: true }) otpExpiresAt!: Date | null;
  @Column({ type: 'timestamptz', name: 'otpSentAt', nullable: true }) otpSentAt!: Date | null;
  @Column({ type: 'integer', name: 'otpAttempts', default: 0 }) otpAttempts!: number;
  /* Codes sent since otpWindowStart (a rolling hour), for the per-account send limit. */
  @Column({ type: 'integer', name: 'otpSendCount', default: 0 }) otpSendCount!: number;
  @Column({ type: 'timestamptz', name: 'otpWindowStart', nullable: true }) otpWindowStart!: Date | null;
  @Column({ type: 'timestamptz', name: 'lastLoginAt', nullable: true }) lastLoginAt!: Date | null;
  /* HMAC of the pending password reset link's token (migration 1795000000000); null when none is pending. */
  @Column({ type: 'char', length: 64, name: 'resetTokenHash', nullable: true, select: false }) resetTokenHash!: string | null;
  @Column({ type: 'timestamptz', name: 'resetExpiresAt', nullable: true }) resetExpiresAt!: Date | null;
  @Column({ type: 'timestamptz', name: 'resetSentAt', nullable: true }) resetSentAt!: Date | null;
  /* Links sent since resetWindowStart (a rolling hour), for the per-account limit. */
  @Column({ type: 'integer', name: 'resetSendCount', default: 0 }) resetSendCount!: number;
  @Column({ type: 'timestamptz', name: 'resetWindowStart', nullable: true }) resetWindowStart!: Date | null;
  /* Last password change through a reset link: portal sessions signed in before it are refused. */
  @Column({ type: 'timestamptz', name: 'passwordChangedAt', nullable: true }) passwordChangedAt!: Date | null;
}

/*
 * The account's application. Before submission `data` holds the form draft (Aadhaar only in aadhaarEnc, encrypted);
 * from submission on (once, final) the students row (studentId) is the record and the draft is cleared.
 * (The table's resubmittedAt and editUsed columns belonged to the dropped edit-once feature: no longer used, kept.)
 */
@Entity({ name: 'edp_applications' })
export class EdpApplication extends AppBaseEntity {
  @Column({ type: 'uuid', name: 'accountId' }) accountId!: string;
  @Column({ type: 'varchar', length: 20, default: 'DRAFT' }) status!: string;
  @Column({ type: 'smallint', name: 'currentStep', default: 1 }) currentStep!: number;
  @Column({ type: 'jsonb', default: () => `'{}'::jsonb` }) data!: Record<string, string>;
  @Column({ type: 'jsonb', default: () => `'{}'::jsonb` }) barcodes!: Record<string, string>;
  @Column({ type: 'bytea', name: 'aadhaarEnc', nullable: true, select: false }) aadhaarEnc!: Buffer | null;
  @Column({ type: 'timestamptz', name: 'basicCompletedAt', nullable: true }) basicCompletedAt!: Date | null;
  @Column({ type: 'timestamptz', name: 'mainCompletedAt', nullable: true }) mainCompletedAt!: Date | null;
  @Column({ type: 'uuid', name: 'studentId', nullable: true }) studentId!: string | null;
  @Column({ type: 'timestamptz', name: 'submittedAt', nullable: true }) submittedAt!: Date | null;
}

/* A document uploaded in step 3, held until the application is submitted. */
@Entity({ name: 'edp_application_files' })
export class EdpApplicationFile extends AppBaseEntity {
  @Column({ type: 'uuid', name: 'applicationId' }) applicationId!: string;
  @Column({ type: 'varchar', length: 40, name: 'docType' }) docType!: string;
  @Column({ type: 'varchar', length: 500, name: 'storageKey' }) storageKey!: string;
  @Column({ type: 'varchar', length: 255, name: 'originalName' }) originalName!: string;
  @Column({ type: 'varchar', length: 100, name: 'mimeType' }) mimeType!: string;
  @Column({ type: 'integer', name: 'sizeBytes' }) sizeBytes!: number;
  @Column({ type: 'char', length: 64 }) sha256!: string;
}

/* Sign-in of the EDP tracking panel (edp.sumago.ai/manage). Separate from Amrut admin panel users. */
@Entity({ name: 'edp_admins' })
export class EdpAdmin extends AppBaseEntity {
  @Column({ type: 'varchar', length: 150 }) name!: string;
  @Column({ type: 'varchar', length: 254 }) email!: string;
  @Column({ type: 'varchar', length: 255, name: 'passwordHash', select: false }) passwordHash!: string;
  @Column({ type: 'timestamptz', name: 'lastLoginAt', nullable: true }) lastLoginAt!: Date | null;
}

/* One follow-up of a student by the EDP team (migration 1794800000000); the newest is the current follow-up status. */
@Entity({ name: 'edp_follow_ups' })
export class EdpFollowUp extends AppBaseEntity {
  @Column({ type: 'uuid', name: 'accountId' }) accountId!: string;
  @Column({ type: 'varchar', length: 20 }) status!: string;
  @Column({ type: 'varchar', length: 1000, nullable: true }) note!: string | null;
  @Column({ type: 'uuid', name: 'adminId', nullable: true }) adminId!: string | null;
}

export const EDP_ENTITIES = [EdpAccount, EdpApplication, EdpApplicationFile, EdpAdmin, EdpFollowUp];
