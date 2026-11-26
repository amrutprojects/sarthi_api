import { matchDistrict, type DistrictRef } from '../../../src/modules/ipp-approvals/ipp-districts';

/* Which district of the District Master a batch of IPP belongs to: code, then name, then other spellings; never a guess. */
const d = (code: string, name: string, stateCode = 'MH'): DistrictRef => ({ id: `${stateCode}/${code}`, code, name, stateCode });
const MASTER = [
  d('PUN', 'Pune'),
  d('NAS', 'Nashik'),
  d('AHL', 'Ahilyanagar'),
  d('CSN', 'Chhatrapati Sambhajinagar'),
  d('MUC', 'Mumbai City'),
  d('MUS', 'Mumbai Suburban'),
];
const match = (code: string, name: string, state: string | null = 'MH', master = MASTER) =>
  matchDistrict(master, { code, name, state_code: state })?.id ?? null;

describe('matchDistrict', () => {
  it('by code, any case', () => {
    expect(match('PUN', 'Pune')).toBe('MH/PUN');
    expect(match(' pun ', 'Poona')).toBe('MH/PUN');
    expect(match('PUN', 'A name nobody knows')).toBe('MH/PUN');
  });

  it('by code with or without the state in front, on either side', () => {
    expect(match('MH-PUN', 'Pune')).toBe('MH/PUN');
    expect(match('PUN', 'Pune', 'MH', [d('MH-PUN', 'Pune')])).toBe('MH/MH-PUN');
    /* Only the state's own code is a prefix. */
    expect(match('XX-PUN', 'Nowhere')).toBeNull();
  });

  it('by name when the code is unknown', () => {
    expect(match('521', 'pune')).toBe('MH/PUN');
    expect(match('999', 'Mumbai   suburban')).toBe('MH/MUS');
  });

  it('by a known other spelling or former name', () => {
    expect(match('466', 'Ahmednagar')).toBe('MH/AHL');
    expect(match('466', 'अहमदनगर')).toBe('MH/AHL');
    expect(match('469', 'Aurangabad')).toBe('MH/CSN');
    expect(match('518', 'Mumbai')).toBe('MH/MUC');
    /* The master may still have the former name. */
    expect(match('466', 'Ahilyanagar', 'MH', [d('ANR', 'Ahmednagar')])).toBe('MH/ANR');
  });

  it('not when the code says one district and the name another', () => {
    expect(match('PUN', 'Nashik')).toBeNull();
    expect(match('NAS', 'Ahmednagar')).toBeNull();
  });

  it('not when nothing matches', () => {
    expect(match('ZZZ', 'Nowhere')).toBeNull();
    expect(match('PUN', 'Pune', 'MH', [])).toBeNull();
  });

  it('within the state when the master has it; otherwise only what is clear', () => {
    const master = [...MASTER, d('PUN', 'Punem', 'GA')];
    expect(match('PUN', 'X', 'MH', master)).toBe('MH/PUN');
    expect(match('PUN', 'X', 'ga', master)).toBe('GA/PUN');
    expect(match('PUN', 'X', null, master)).toBeNull();
    expect(match('PUN', 'X', '27', master)).toBeNull();
    expect(match('PUN', 'Pune', '27', master)).toBe('MH/PUN');
    expect(match('NAS', 'Nashik', 'GA', master)).toBeNull();
  });
});
