import type { MasterKey } from './master.definitions';

/* An active, non-deleted master record as other modules see it. */
export interface MasterRef {
  id: string;
  code: string;
  name: string;
  isMandatory?: boolean;
  /* Castes only: the English name, or null when none is set. */
  nameEn?: string | null;
}

export type MasterRecords = Record<MasterKey, MasterRef[]>;

/*
 * In-memory view of the active masters, loaded once per import batch or registration and passed to the
 * (synchronous) validators. Values match by code or name, case-insensitively, after Unicode NFC and space collapsing.
 */
export interface MasterLookup {
  find(key: MasterKey, value: string): MasterRef | null;
  byId(key: MasterKey, id: string): MasterRef | null;
  list(key: MasterKey): MasterRef[];
}

export const masterKey = (v: string) => v.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();

export function buildMasterLookup(records: MasterRecords): MasterLookup {
  const byValue = new Map<MasterKey, Map<string, MasterRef>>();
  const byId = new Map<MasterKey, Map<string, MasterRef>>();
  for (const [key, refs] of Object.entries(records) as [MasterKey, MasterRef[]][]) {
    const values = new Map<string, MasterRef>();
    for (const r of refs) {
      values.set(masterKey(r.name), r);
      values.set(masterKey(r.code), r);
    }
    byValue.set(key, values);
    byId.set(key, new Map(refs.map((r) => [r.id, r])));
  }
  return {
    find: (key, value) => (value.trim() ? (byValue.get(key)?.get(masterKey(value)) ?? null) : null),
    byId: (key, id) => byId.get(key)?.get(id) ?? null,
    list: (key) => records[key] ?? [],
  };
}
