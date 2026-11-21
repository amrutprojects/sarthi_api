import { In, type EntityManager } from 'typeorm';
import { AppDataSource } from '../../../config/database.config';
import { Student } from '../register/student.entity';
import type { NormalisedRow } from '../import/row-validator';

/*
 * The import's tiered identity match (import.service.ts `validate`), for one person coming from the LMS.
 *
 * The import keeps its own copy inline and is not changed (M1 rule: the student import does not change at all). This
 * file repeats the same rules over the same normalised values (validateRow's output, called as it is), and
 * tests/integration/lms-integration/student-match.parity.test.ts runs both on the same register and the same people
 * and requires identical tiers and students:
 *
 *   T0  same source record ID
 *   T1  same Aadhaar blind index (CONFLICT when the name or the date of birth differs)
 *   T2  same date of birth + same name key + (same mobile or same email)
 *   T3  same mobile or same email (information only: no student is matched)
 *
 * Deleted students are never matched. Within a tier the first student found wins, as in the import.
 */
export type MatchTier = 'T0' | 'T1' | 'T2' | 'T3';

/* The values of a person the match reads (a subset of validateRow's normalised row). */
export type MatchProbe = Pick<NormalisedRow, 'sourceRecordId' | 'aadhaarBidx' | 'dateOfBirth' | 'nameKey' | 'mobile' | 'email'>;

type Candidate = Pick<
  Student,
  'id' | 'code' | 'sourceRecordId' | 'aadhaarBidx' | 'dateOfBirth' | 'firstName' | 'lastName' | 'mobile' | 'email'
>;

export interface MatchCandidates {
  bySrc: Candidate[];
  byBidx: Candidate[];
  byDob: Candidate[];
  byMobile: Candidate[];
  byEmail: Candidate[];
}

export interface MatchOutcome {
  tier: MatchTier | null;
  /* The matched student (T0–T2); null for T3 and no match. */
  student: { id: string; code: string } | null;
  /* T1 only: same Aadhaar but a different name or date of birth. */
  conflict: boolean;
  /* The import's note wording (shown to reviewers; names the student code only). */
  note: string | null;
}

/* The import's name key of a register row (import.service.ts). */
const nameKey = (s: Pick<Student, 'firstName' | 'lastName'>) => `${s.firstName} ${s.lastName}`.toLowerCase().replace(/\s+/g, ' ').trim();

/* The tier decision, exactly as the import decides it for a row with no earlier duplicate in its file. */
export function decideMatch(row: MatchProbe, c: MatchCandidates): MatchOutcome {
  const t0 = row.sourceRecordId ? c.bySrc.find((s) => s.sourceRecordId === row.sourceRecordId) : undefined;
  const t1 = row.aadhaarBidx ? c.byBidx.find((s) => s.aadhaarBidx === row.aadhaarBidx) : undefined;
  const t2 = row.dateOfBirth
    ? c.byDob.find(
        (s) =>
          s.dateOfBirth === row.dateOfBirth &&
          nameKey(s) === row.nameKey &&
          ((row.mobile && s.mobile === row.mobile) || (row.email && s.email === row.email)),
      )
    : undefined;
  if (t0)
    return { tier: 'T0', student: { id: t0.id, code: t0.code }, conflict: false, note: `Source record already imported as ${t0.code}` };
  if (t1) {
    const conflict = nameKey(t1) !== row.nameKey || t1.dateOfBirth !== row.dateOfBirth;
    return {
      tier: 'T1',
      student: { id: t1.id, code: t1.code },
      conflict,
      note: conflict ? `Same Aadhaar as ${t1.code} but different name or date of birth (CONFLICT)` : `Same Aadhaar as ${t1.code}`,
    };
  }
  if (t2)
    return {
      tier: 'T2',
      student: { id: t2.id, code: t2.code },
      conflict: false,
      note: `Same name, date of birth and contact as ${t2.code}`,
    };
  const t3 = (row.mobile && c.byMobile.find((s) => s.mobile === row.mobile)) || (row.email && c.byEmail.find((s) => s.email === row.email));
  if (t3) return { tier: 'T3', student: null, conflict: false, note: `Shares mobile or email with ${t3.code} (informational only)` };
  return { tier: null, student: null, conflict: false, note: null };
}

/* Loads the register rows that could match (the same five lookups as the import, for one person). */
export async function loadCandidates(row: MatchProbe, m?: EntityManager): Promise<MatchCandidates> {
  const students = (m ?? AppDataSource.manager).getRepository(Student);
  const load = async (col: keyof Student, val: string | null) =>
    val ? students.find({ where: { [col]: In([val]), isDelete: false } as never }) : Promise.resolve([] as Student[]);
  const [bySrc, byBidx, byDob, byMobile, byEmail] = await Promise.all([
    load('sourceRecordId', row.sourceRecordId),
    load('aadhaarBidx', row.aadhaarBidx),
    load('dateOfBirth', row.dateOfBirth),
    load('mobile', row.mobile),
    load('email', row.email),
  ]);
  return { bySrc, byBidx, byDob, byMobile, byEmail };
}

export async function matchStudent(row: MatchProbe, m?: EntityManager): Promise<MatchOutcome> {
  return decideMatch(row, await loadCandidates(row, m));
}

/*
 * The contract's answer for a match (amrut-student-api.md §2): T0, or T1 with the same name and date of birth, is a
 * MATCH; a T1 conflict or T2 is POSSIBLE (a person decides); T3 is information only (NONE with the tier).
 */
export type MatchResult = 'NONE' | 'MATCH' | 'POSSIBLE';
export function resultOf(o: MatchOutcome): MatchResult {
  if (o.tier === 'T0' || (o.tier === 'T1' && !o.conflict)) return 'MATCH';
  if (o.tier === 'T1' || o.tier === 'T2') return 'POSSIBLE';
  return 'NONE';
}
