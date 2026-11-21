import type { Env } from '../../../src/config/env.config';
import { lmsLinkConfigIssues } from '../../../src/config/lms-link-config';

/*
 * No Amrut/LMS link value is preset (user rule, 21 Nov 2026): the base URL, tenant key and tenant code are entered by
 * hand. Empty is fine while the sync is off; once it is on, all three are required and startup stops.
 */
const LMS_KEYS = ['LMS_SYNC_ENABLED', 'LMS_READS_ENABLED', 'LMS_EXTERNAL_BASE_URL', 'LMS_TENANT_API_KEY', 'LMS_TENANT_CODE'] as const;
const FAKE_KEY = 'unit-test-tenant-key-not-a-secret-0123';

describe('lmsLinkConfigIssues', () => {
  const full = {
    LMS_SYNC_ENABLED: true,
    LMS_EXTERNAL_BASE_URL: 'http://lms.test',
    LMS_TENANT_API_KEY: FAKE_KEY,
    LMS_TENANT_CODE: 'TEST_TENANT',
  };

  it('accepts empty values while the sync is off', () => {
    expect(lmsLinkConfigIssues({ LMS_SYNC_ENABLED: false })).toEqual([]);
  });

  it('accepts the sync on when all three values are entered', () => {
    expect(lmsLinkConfigIssues(full)).toEqual([]);
  });

  it.each(['LMS_EXTERNAL_BASE_URL', 'LMS_TENANT_API_KEY', 'LMS_TENANT_CODE'] as const)('needs %s once the sync is on', (k) => {
    const issues = lmsLinkConfigIssues({ ...full, [k]: undefined });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain(k);
    expect(issues[0]).not.toContain(FAKE_KEY);
  });

  it('names every missing value in one line', () => {
    expect(lmsLinkConfigIssues({ LMS_SYNC_ENABLED: true })[0]).toMatch(/LMS_EXTERNAL_BASE_URL, LMS_TENANT_API_KEY, LMS_TENANT_CODE/);
  });

  it('reads need the base URL and the key, not the tenant code', () => {
    expect(
      lmsLinkConfigIssues({
        LMS_SYNC_ENABLED: false,
        LMS_READS_ENABLED: true,
        LMS_EXTERNAL_BASE_URL: 'http://lms.test',
        LMS_TENANT_API_KEY: FAKE_KEY,
      }),
    ).toEqual([]);
    const issues = lmsLinkConfigIssues({ LMS_SYNC_ENABLED: false, LMS_READS_ENABLED: true });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatch(/^LMS_READS_ENABLED=true needs LMS_EXTERNAL_BASE_URL, LMS_TENANT_API_KEY \(/);
  });

  it('sync on without a tenant code fails even when the reads are fine', () => {
    const issues = lmsLinkConfigIssues({ ...full, LMS_READS_ENABLED: true, LMS_TENANT_CODE: undefined });
    expect(issues).toEqual([expect.stringMatching(/^LMS_SYNC_ENABLED=true needs LMS_TENANT_CODE /)]);
  });
});

describe('env.config LMS link values at startup', () => {
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of LMS_KEYS) saved[k] = process.env[k];
  });
  afterEach(() => {
    for (const k of LMS_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    jest.restoreAllMocks();
  });

  /* Loads env.config fresh with these LMS values (set, even if empty, so a local .env.test cannot fill them in). */
  async function load(values: Partial<Record<(typeof LMS_KEYS)[number], string>>) {
    for (const k of LMS_KEYS) process.env[k] = values[k] ?? (k.endsWith('_ENABLED') ? 'false' : '');
    const exit = jest.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit ${code}`);
    }) as never);
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    let env: Env | undefined;
    let failure: unknown;
    await jest.isolateModulesAsync(async () => {
      try {
        env = (await import('../../../src/config/env.config')).env;
      } catch (e) {
        failure = e;
      }
    });
    return { env, failure, exit, printed: error.mock.calls.map((c) => c.join(' ')).join('\n') };
  }

  it('has no default tenant code (empty stays unset, never AMRUT)', async () => {
    const { env, exit } = await load({ LMS_SYNC_ENABLED: 'false' });
    expect(exit).not.toHaveBeenCalled();
    expect(env?.LMS_TENANT_CODE).toBeUndefined();
    expect(env?.LMS_EXTERNAL_BASE_URL).toBeUndefined();
    expect(env?.LMS_TENANT_API_KEY).toBeUndefined();
  });

  it('keeps the tenant code that was entered', async () => {
    const { env } = await load({ LMS_SYNC_ENABLED: 'false', LMS_TENANT_CODE: 'TEST_TENANT' });
    expect(env?.LMS_TENANT_CODE).toBe('TEST_TENANT');
  });

  it('stops startup when the sync is on without a tenant code, without printing values', async () => {
    const { exit, printed } = await load({
      LMS_SYNC_ENABLED: 'true',
      LMS_EXTERNAL_BASE_URL: 'http://lms.test',
      LMS_TENANT_API_KEY: FAKE_KEY,
    });
    expect(exit).toHaveBeenCalledWith(1);
    expect(printed).toContain('LMS_TENANT_CODE');
    expect(printed).not.toContain(FAKE_KEY);
    expect(printed).not.toContain('http://lms.test');
  });

  it('stops startup when the sync is on without base URL and key', async () => {
    const { exit, printed } = await load({ LMS_SYNC_ENABLED: 'true', LMS_TENANT_CODE: 'TEST_TENANT' });
    expect(exit).toHaveBeenCalledWith(1);
    expect(printed).toContain('LMS_EXTERNAL_BASE_URL');
    expect(printed).toContain('LMS_TENANT_API_KEY');
  });

  it('starts with the sync on when all three values are entered', async () => {
    const { env, exit } = await load({
      LMS_SYNC_ENABLED: 'true',
      LMS_EXTERNAL_BASE_URL: 'http://lms.test',
      LMS_TENANT_API_KEY: FAKE_KEY,
      LMS_TENANT_CODE: 'TEST_TENANT',
    });
    expect(exit).not.toHaveBeenCalled();
    expect(env?.LMS_SYNC_ENABLED).toBe(true);
  });
});
