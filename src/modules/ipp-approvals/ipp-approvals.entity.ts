import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { AppBaseEntity } from '../../database/base.entity';
import type { District } from '../../cms/masters/district/district.model';
import type { User } from '../users';
import type { DecisionAction, DecisionStatus, IppEvent, MoveEvent, Stage } from './ipp-approvals.constants';

/* The form as IPP reads it out, the documents it lists and the Auditor's corrections: stored as IPP sent them. */
export interface SnapshotField {
  key: string;
  step: 1 | 2;
  label_en: string;
  label_mr: string;
  type: string;
  text: string;
}
export interface SnapshotDocument {
  code: string;
  name: string;
  name_mr: string | null;
  required: boolean;
  kind: 'DOCUMENT' | 'VIDEO';
  file: { name: string; mime: string; size: number; uploaded_at: string } | null;
  verified: boolean;
  verified_at: string | null;
  verified_by: string | null;
}
export interface SnapshotEdit {
  at: string;
  by: string | null;
  changes: { key: string; label: string; from: string; to: string }[];
}

/* A batch of IPP (migration 1798900000000). Its district decides which Divisional Officers get it. */
@Entity({ name: 'ipp_batches' })
@Index('UQ_ipp_batches_ippId', ['ippId'], { unique: true })
@Index('IDX_ipp_batches_districtId', ['districtId'])
@Index('IDX_ipp_batches_receivedAt', ['receivedAt'])
export class IppBatch {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @CreateDateColumn({ type: 'timestamptz', name: 'createdAt' }) createdAt!: Date;
  @UpdateDateColumn({ type: 'timestamptz', name: 'updatedAt' }) updatedAt!: Date;
  /* The batch's id in IPP. */
  @Column({ type: 'varchar', length: 64, name: 'ippId' }) ippId!: string;
  @Column({ type: 'varchar', length: 40 }) code!: string;
  @Column({ type: 'varchar', length: 200 }) name!: string;
  @Column({ type: 'integer' }) size!: number;
  @Column({ type: 'uuid', name: 'districtId' }) districtId!: string;
  @Column({ type: 'varchar', length: 60, name: 'centreCode' }) centreCode!: string;
  @Column({ type: 'varchar', length: 200, name: 'centreName' }) centreName!: string;
  @Column({ type: 'date', name: 'startDate', nullable: true }) startDate!: string | null;
  @Column({ type: 'date', name: 'endDate', nullable: true }) endDate!: string | null;
  @Column({ type: 'varchar', length: 10, name: 'deliveryMode' }) deliveryMode!: 'OFFLINE' | 'ONLINE' | 'BLENDED';
  @Column({ type: 'varchar', length: 60, name: 'technologyCode', nullable: true }) technologyCode!: string | null;
  @Column({ type: 'varchar', length: 200, name: 'technologyName', nullable: true }) technologyName!: string | null;
  @Column({ type: 'varchar', length: 200, name: 'sentBy', nullable: true }) sentBy!: string | null;
  @Column({ type: 'timestamptz', name: 'ippCreatedAt' }) ippCreatedAt!: Date;
  /* When the first message of the batch came. */
  @Column({ type: 'timestamptz', name: 'receivedAt', default: () => 'now()' }) receivedAt!: Date;
  /* seq of the message the batch was last written from (bigint: text in JavaScript). */
  @Column({ type: 'bigint', name: 'lastSeq' }) lastSeq!: string;

  @ManyToOne('District', { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'districtId' })
  district!: District;
}

/* One student's form: the snapshot IPP last sent and where its approval stands. Its id is the id of the IPP application. */
@Entity({ name: 'ipp_applications' })
@Index('IDX_ipp_applications_batchId', ['batchId'])
@Index('IDX_ipp_applications_stage', ['stage', 'stageUpdatedAt'])
export class IppApplication {
  @PrimaryColumn({ type: 'uuid' }) id!: string;
  @CreateDateColumn({ type: 'timestamptz', name: 'createdAt' }) createdAt!: Date;
  @UpdateDateColumn({ type: 'timestamptz', name: 'updatedAt' }) updatedAt!: Date;
  @Column({ type: 'uuid', name: 'batchId' }) batchId!: string;
  @Column({ type: 'varchar', length: 40, name: 'registrationId' }) registrationId!: string;
  @Column({ type: 'varchar', length: 60, name: 'registrationNumber', nullable: true }) registrationNumber!: string | null;
  @Column({ type: 'varchar', length: 200 }) name!: string;
  @Column({ type: 'varchar', length: 254 }) email!: string;
  @Column({ type: 'varchar', length: 30, name: 'mobile' }) mobile!: string;
  /* XXXX-XXXX-1234: the number itself never leaves IPP. */
  @Column({ type: 'varchar', length: 14, name: 'aadhaarMasked', nullable: true }) aadhaarMasked!: string | null;
  /* District, category, centre and technology of the form, as read (the batch has its own). */
  @Column({ type: 'varchar', length: 200, name: 'formDistrict', nullable: true }) formDistrict!: string | null;
  @Column({ type: 'varchar', length: 200, nullable: true }) category!: string | null;
  @Column({ type: 'varchar', length: 200, nullable: true }) centre!: string | null;
  @Column({ type: 'varchar', length: 200, nullable: true }) technology!: string | null;
  @Column({ type: 'timestamptz', name: 'submittedAt' }) submittedAt!: Date;
  @Column({ type: 'timestamptz', name: 'auditorApprovedAt', nullable: true }) auditorApprovedAt!: Date | null;
  @Column({ type: 'varchar', length: 200, name: 'auditorApprovedBy', nullable: true }) auditorApprovedBy!: string | null;
  @Column({ type: 'jsonb' }) fields!: SnapshotField[];
  @Column({ type: 'jsonb' }) documents!: SnapshotDocument[];
  @Column({ type: 'jsonb' }) edits!: SnapshotEdit[];
  @Column({ type: 'varchar', length: 12 }) stage!: Stage;
  /* The event that brought it to this stage. */
  @Column({ type: 'varchar', length: 12, name: 'stageEvent' }) stageEvent!: MoveEvent;
  @Column({ type: 'timestamptz', name: 'stageUpdatedAt' }) stageUpdatedAt!: Date;
  /* The highest level so far: 1 DIVISION, 2 COEP, 3 the final level, 4 APPROVED. */
  @Column({ type: 'smallint' }) reached!: number;
  /* seq of the message the snapshot is from: an older one never replaces it. */
  @Column({ type: 'bigint', name: 'lastSeq' }) lastSeq!: string;

  @ManyToOne('IppBatch', { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'batchId' })
  batch!: IppBatch;
}

/* What happened to an application, in order of seq. Append-only (trigger). */
@Entity({ name: 'ipp_approval_events' })
@Index('IDX_ipp_approval_events_application', ['applicationId', 'seq'])
export class IppApprovalEvent {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'bigint', generated: 'increment' }) seq!: string;
  @Column({ type: 'uuid', name: 'applicationId' }) applicationId!: string;
  @Column({ type: 'varchar', length: 12 }) event!: IppEvent;
  @Column({ type: 'varchar', length: 12, name: 'fromStage', nullable: true }) fromStage!: Stage | null;
  @Column({ type: 'varchar', length: 12, name: 'toStage' }) toStage!: Stage;
  @Column({ type: 'varchar', length: 500, nullable: true }) reason!: string | null;
  /* The officer (decisions and moves), or the message of IPP (the rest). */
  @Column({ type: 'uuid', name: 'byUserId', nullable: true }) byUserId!: string | null;
  @Column({ type: 'varchar', length: 200, name: 'byName' }) byName!: string;
  @Column({ type: 'varchar', length: 60, name: 'byRole', nullable: true }) byRole!: string | null;
  @Column({ type: 'uuid', name: 'messageId', nullable: true }) messageId!: string | null;
  @Column({ type: 'timestamptz', default: () => 'now()' }) at!: Date;

  @ManyToOne('IppApplication', { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'applicationId' })
  application!: IppApplication;

  @ManyToOne('User', { onDelete: 'RESTRICT', nullable: true })
  @JoinColumn({ name: 'byUserId' })
  byUser!: User | null;
}

/* A decision on its way to IPP (outbox): written in the transaction of the decision, sent by the worker. */
@Entity({ name: 'ipp_decisions' })
@Index('IDX_ipp_decisions_open', ['seq'], { where: `"status" <> 'SENT'` })
@Index('IDX_ipp_decisions_application', ['applicationId', 'seq'])
export class IppDecision {
  /* The id IPP gets: the same id again is done once there. */
  @PrimaryGeneratedColumn('uuid') id!: string;
  @CreateDateColumn({ type: 'timestamptz', name: 'createdAt' }) createdAt!: Date;
  @UpdateDateColumn({ type: 'timestamptz', name: 'updatedAt' }) updatedAt!: Date;
  @Column({ type: 'bigint', generated: 'increment' }) seq!: string;
  @Column({ type: 'uuid', name: 'applicationId' }) applicationId!: string;
  @Column({ type: 'varchar', length: 8 }) action!: DecisionAction;
  @Column({ type: 'varchar', length: 12, name: 'fromStage' }) fromStage!: Stage;
  @Column({ type: 'varchar', length: 12, name: 'toStage' }) toStage!: Stage;
  @Column({ type: 'varchar', length: 500, nullable: true }) reason!: string | null;
  @Column({ type: 'varchar', length: 200, name: 'byName' }) byName!: string;
  @Column({ type: 'varchar', length: 60, name: 'byRole' }) byRole!: string;
  @Column({ type: 'timestamptz', name: 'decidedAt' }) decidedAt!: Date;
  @Column({ type: 'varchar', length: 8, default: 'PENDING' }) status!: DecisionStatus;
  @Column({ type: 'integer', default: 0 }) attempts!: number;
  @Column({ type: 'timestamptz', name: 'nextAttemptAt', nullable: true }) nextAttemptAt!: Date | null;
  /* Codes and stages only: never a form value or the secret. */
  @Column({ type: 'varchar', length: 300, name: 'lastError', nullable: true }) lastError!: string | null;
  @Column({ type: 'timestamptz', name: 'sentAt', nullable: true }) sentAt!: Date | null;

  @ManyToOne('IppApplication', { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'applicationId' })
  application!: IppApplication;
}

/* Ids of IPP's messages already done: a repeated one changes nothing. */
@Entity({ name: 'ipp_messages' })
@Index('IDX_ipp_messages_receivedAt', ['receivedAt'])
export class IppMessage {
  @PrimaryColumn({ type: 'uuid' }) id!: string;
  @Column({ type: 'bigint' }) seq!: string;
  @Column({ type: 'uuid', name: 'batchId' }) batchId!: string;
  @Column({ type: 'uuid', array: true, name: 'applicationIds' }) applicationIds!: string[];
  @Column({ type: 'timestamptz', name: 'receivedAt', default: () => 'now()' }) receivedAt!: Date;

  @ManyToOne('IppBatch', { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'batchId' })
  batch!: IppBatch;
}

/* The districts of a Divisional Officer. */
@Entity({ name: 'user_districts' })
@Index('UQ_user_districts_active', ['userId', 'districtId'], { unique: true, where: '"isDelete" = false' })
@Index('IDX_user_districts_districtId', ['districtId'])
export class UserDistrict extends AppBaseEntity {
  @Column({ type: 'uuid', name: 'userId' }) userId!: string;
  @Column({ type: 'uuid', name: 'districtId' }) districtId!: string;

  @ManyToOne('User', { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'userId' })
  user!: User;

  @ManyToOne('District', { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'districtId' })
  district!: District;
}

export const IPP_APPROVAL_ENTITIES = [IppBatch, IppApplication, IppApprovalEvent, IppDecision, IppMessage, UserDistrict];
