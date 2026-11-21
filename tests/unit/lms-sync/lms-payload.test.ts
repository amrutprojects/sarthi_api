import {
  LMS_REQUIRED_FIELDS,
  RESTRICTED_FIELDS,
  SENT_FIELDS,
  buildLmsRecord,
  idempotencyKeyFor,
  missingRequiredFields,
  recordChecksum,
  type StudentSyncRow,
} from '../../../src/modules/lms-sync/lms-payload';
import { flagForItem, flagForLmsStatus } from '../../../src/modules/lms-sync/lms-sync.constants';

/* Synthetic student with every column filled, restricted ones included (they must never reach the payload). */
const row = (over: Partial<StudentSyncRow> & Record<string, unknown> = {}): StudentSyncRow =>
  ({
    id: '6f1c1f0e-1d7a-4c51-9a3e-0e6c1b9a7a10',
    code: 'STU-000123',
    firstName: 'Asha',
    lastName: 'Example',
    fatherName: 'Synthetic Father',
    motherName: 'Synthetic Mother',
    email: 'asha.example@example.test',
    dateOfBirth: '2004-05-17',
    gender: 'Female',
    maritalStatus: 'Unmarried',
    permanentAddress: 'Synthetic permanent address',
    landmark: 'Synthetic landmark',
    districtName: 'Nagpur',
    talukaName: 'Nagpur Rural',
    division: 'Nagpur',
    pinCode: '440001',
    mobile: '9876500001',
    alternateMobile: null,
    alternateEmail: '  ',
    centreCode: 'NAG',
    trackCode: 'T03',
    trackSourceValue: 'Web Design & Development',
    educationQualification: 'Graduate',
    qualificationName: 'B.Sc',
    qualificationStream: null,
    qualificationBoard: null,
    qualificationCompletedOn: '2025-06-01',
    score: '78.50',
    gradingType: 'PERCENTAGE',
    qualificationClass: 'First',
    externalStatus: 'APPROVED',
    approvedAt: new Date('2026-11-01T10:00:00Z'),
    schemeName: 'SANDBOX SCHEME',
    sourceSubmittedAt: '2026-10-20T05:00:00Z',
    evidenceRef: 'EV-1',
    declarationAccepted: true,
    documents: {
      PHOTO: { supplied: true },
      AADHAAR_CARD: { supplied: false },
      CASTE_CERT: { supplied: true },
      INCOME_EWS: { supplied: true, barcode: '123456789012345678' } as { supplied: boolean },
    },
    /* Columns of the students table that must never be sent. */
    aadhaarLast4: '9012',
    aadhaarEnc: Buffer.from('cipher'),
    religion: 'SyntheticReligion',
    caste: 'SyntheticCaste',
    currentAddress: 'Synthetic CURRENT address',
    disabilityStatus: true,
    disabilityType: 'SyntheticDisability',
    disabilityCertificateNumber: 'DIS-123',
    sourceRemarks: 'free text remark',
    ...over,
  }) as StudentSyncRow;

describe('lms payload mapping', () => {
  it('maps the student onto the LMS record with external_student_id = students.id', () => {
    const r = buildLmsRecord(row());
    expect(r.external_student_id).toBe('6f1c1f0e-1d7a-4c51-9a3e-0e6c1b9a7a10');
    expect(r.source_record_id).toBe('STU-000123');
    expect(r).toMatchObject({
      first_name: 'Asha',
      mobile_number: '9876500001',
      district: 'Nagpur',
      taluka: 'Nagpur Rural',
      technology: 'T03',
      score: '78.50',
      score_type: 'PERCENTAGE',
      approved_at: '2026-11-01T10:00:00.000Z',
      submitted_at: '2026-10-20T05:00:00.000Z',
      declaration_accepted: true,
    });
    expect(missingRequiredFields(r)).toEqual([]);
  });

  it('never carries Aadhaar, caste, religion, disability, current address, remarks or files', () => {
    const r = buildLmsRecord(row());
    for (const f of RESTRICTED_FIELDS) expect(r).not.toHaveProperty(f);
    const json = JSON.stringify(r);
    for (const value of [
      '9012',
      'SyntheticReligion',
      'SyntheticCaste',
      'CURRENT address',
      'SyntheticDisability',
      'DIS-123',
      'free text',
      '123456789012345678',
      'cipher',
    ])
      expect(json).not.toContain(value);
    /* Only whitelisted keys, and documents as booleans without the caste certificate. */
    for (const k of Object.keys(r)) expect(SENT_FIELDS).toContain(k);
    expect(r.documents_supplied).toEqual({ doc_photo: true, doc_aadhaar_card: false, doc_income_ews: true });
  });

  it('leaves out empty values and falls back to the source technology', () => {
    const r = buildLmsRecord(row({ trackCode: null, alternateMobile: '', qualificationStream: null }));
    expect(r.technology).toBe('Web Design & Development');
    expect(r).not.toHaveProperty('alternate_mobile_number');
    expect(r).not.toHaveProperty('alternate_email');
    expect(r).not.toHaveProperty('qualification_stream');
  });

  it('reports the LMS-required fields that are empty', () => {
    const r = buildLmsRecord(row({ landmark: null, pinCode: ' ', gender: null }));
    expect(missingRequiredFields(r)).toEqual(['gender', 'landmark', 'pin_code']);
    expect(LMS_REQUIRED_FIELDS).toHaveLength(14);
  });
});

describe('checksum and idempotency key', () => {
  it('is stable, ignores source_updated_at and key order, and changes with the data', () => {
    const a = buildLmsRecord(row());
    const same = recordChecksum(a);
    expect(same).toMatch(/^[0-9a-f]{64}$/);
    expect(recordChecksum({ ...a, source_updated_at: '2026-11-21T00:00:00Z' })).toBe(same);
    const reordered = Object.fromEntries(Object.entries(a).reverse()) as typeof a;
    expect(recordChecksum(reordered)).toBe(same);
    expect(recordChecksum(buildLmsRecord(row({ mobile: '9876500002' })))).not.toBe(same);
    /* A restricted column changing does not change what is sent, so it is not a reason to resend. */
    expect(recordChecksum(buildLmsRecord(row({ caste: 'Other' } as Partial<StudentSyncRow>)))).toBe(same);
  });

  it('derives the Idempotency-Key from the body', () => {
    const body = [buildLmsRecord(row())];
    expect(idempotencyKeyFor(body)).toBe(idempotencyKeyFor(body));
    expect(idempotencyKeyFor(body)).toMatch(/^amrut-sync-[0-9a-f]{48}$/);
    expect(idempotencyKeyFor(body).length).toBeLessThanOrEqual(100);
    expect(idempotencyKeyFor([buildLmsRecord(row({ firstName: 'Other' }))])).not.toBe(idempotencyKeyFor(body));
  });
});

describe('LMS status → sync flag', () => {
  it.each([
    ['PROVISIONED', 'SYNCED'],
    ['DUPLICATE_SUSPECT', 'REVIEW'],
    ['INVALID', 'FAILED'],
    ['REJECTED', 'FAILED'],
    ['NOT_APPROVED', 'FAILED'],
    ['WITHDRAWN', 'FAILED'],
    ['FAILED', 'FAILED'],
    ['RECEIVED', 'SENT'],
    ['PENDING_ALLOTMENT', 'SENT'],
    ['ALLOTTED', 'SENT'],
    ['ON_HOLD', 'SENT'],
  ])('%s → %s', (lms, flag) => expect(flagForLmsStatus(lms)).toBe(flag));
});

/* M2-F1: an item of the LMS request view, with the outcome of that call. */
describe('flagForItem (request view outcome)', () => {
  const learner = '6f1c2a3b-0000-4000-8000-000000000001';
  it.each([
    ['unchanged re-send of a provisioned student', { status: 'PROVISIONED', outcome: 'SKIPPED_UNCHANGED' }, 'SYNCED'],
    ['unchanged re-send, learner id only', { status: 'PENDING_ALLOTMENT', outcome: 'SKIPPED_UNCHANGED', learner_id: learner }, 'SYNCED'],
    ['unchanged re-send, learner code only', { status: 'ALLOTTED', outcome: 'SKIPPED_UNCHANGED', learner_code: 'AMK-L-0000001' }, 'SYNCED'],
    ['unchanged re-send still being processed', { status: 'RECEIVED', outcome: 'SKIPPED_UNCHANGED', learner_id: null }, 'SENT'],
    ['unchanged re-send of a duplicate suspect', { status: 'DUPLICATE_SUSPECT', outcome: 'SKIPPED_UNCHANGED' }, 'REVIEW'],
    ['unchanged re-send of a rejected record', { status: 'REJECTED', outcome: 'SKIPPED_UNCHANGED' }, 'FAILED'],
    ['older copy of a provisioned student', { status: 'PROVISIONED', outcome: 'STALE' }, 'SYNCED'],
    ['written and provisioned', { status: 'PROVISIONED', outcome: 'ACCEPTED' }, 'SYNCED'],
    ['written, still waiting', { status: 'RECEIVED', outcome: 'ACCEPTED' }, 'SENT'],
    ['an older LMS (no outcome)', { status: 'PROVISIONED' }, 'SYNCED'],
    ['an older LMS, still waiting', { status: 'ALLOTTED' }, 'SENT'],
  ])('%s', (_name, item, flag) => expect(flagForItem(item)).toBe(flag));
});
