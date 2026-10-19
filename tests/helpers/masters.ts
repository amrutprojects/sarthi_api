import crypto from 'crypto';
import { buildMasterLookup, type MasterLookup } from '../../src/modules/masters';
import { CASTES, CENTRES, DOCUMENTS } from '../../src/modules/students/student.constants';

/* Education values the test fixtures use (no list has been supplied for production; tests create their own). */
export const TEST_EDUCATIONS = ['Graduate', 'B.Com'];

/* In-memory masters mirroring the migration's seed, for unit tests of the (synchronous) validators. */
export function testMasters(): MasterLookup {
  const id = () => crypto.randomUUID();
  return buildMasterLookup({
    region: CENTRES.map((c) => ({ id: id(), code: c.code, name: c.name })),
    caste: CASTES.map((name, i) => ({ id: id(), code: `C${String(i + 1).padStart(2, '0')}`, name })),
    education: TEST_EDUCATIONS.map((name, i) => ({ id: id(), code: `E${i + 1}`, name })),
    documentType: DOCUMENTS.map((d) => ({ id: id(), code: d.key, name: d.label, isMandatory: d.required })),
  });
}
