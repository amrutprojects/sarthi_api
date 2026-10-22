import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { AppBaseEntity } from '../../database/base.entity';
import type { Student } from '../../modules/students';
import type { AssignmentReason } from '../shared/master.constants';
import type { Batch } from '../batch/batch.model';

/*
 * Assign Batch: one student allocated to one programme batch (AMRUT_KALASH_02 Table 41).
 *
 * At most one non-deleted assignment per student (partial unique index). An active assignment holds a
 * seat: the batch's active assignments may never exceed its capacity.
 */
@Entity({ name: 'batch_assignments' })
export class BatchAssignment extends AppBaseEntity {
  @Column({ type: 'uuid', name: 'batchId' })
  batchId!: string;

  @Column({ type: 'uuid', name: 'studentId' })
  studentId!: string;

  /* Required when the batch's centre differs from the student's preferred centre. */
  @Column({ type: 'varchar', length: 30, name: 'reasonCode', nullable: true })
  reasonCode!: AssignmentReason | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  remarks!: string | null;

  @Column({ type: 'timestamptz', name: 'assignedAt', default: () => 'now()' })
  assignedAt!: Date;

  @ManyToOne('Batch', { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'batchId' })
  batch!: Batch;

  @ManyToOne('Student', { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'studentId' })
  student!: Student;
}
