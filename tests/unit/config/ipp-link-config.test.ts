import type { Env } from '../../../src/config/env.config';
import { ippLinkConfigIssues, ippLinkConfigured } from '../../../src/config/ipp-link-config';

/* The link with IPP: off = anything goes; on = the address and a secret of at least 32 characters, or the API refuses to start. */
const KEYS = ['IPP_LINK_ENABLED', 'IPP_API_URL', 'IPP_LINK_SECRET', 'IPP_HTTP_TIMEOUT_MS', 'IPP_LINK_INTERVAL_SECONDS'] as const;
const SECRET = 'unit-test-ipp-link-secret-0123456789';
const URL = 'https://ipp.example.test/api/v1';

describe('ippLinkConfigIssues', () => {
  const full = { IPP_LINK_ENABLED: true, IPP_API_URL: URL, IPP_LINK_SECRET: SECRET };

  it('accepts anything while the link is off', () => {
    expect(ippLinkConfigIssues({ IPP_LINK_ENABLED: false })).toEqual([]);
    expect(ippLinkConfigIssues({ IPP_LINK_ENABLED: false, IPP_LINK_SECRET: 'short' })).toEqual([]);
    expect(ippLinkConfigured({ ...full, IPP_LINK_ENABLED: false })).toBe(false);
  });

  it('accepts the link on with both values', () => {
    expect(ippLinkConfigIssues(full)).toEqual([]);
    expect(ippLinkConfigured(full)).toBe(true);
  });

  it.each(['IPP_API_URL', 'IPP_LINK_SECRET'] as const)('needs %s once the link is on', (key) => {
    const issues = ippLinkConfigIssues({ ...full, [key]: undefined });
    expect(issues).toEqual([expect.stringContaining(key)]);
    expect(ippLinkConfigured({ ...full, [key]: undefined })).toBe(false);
  });

  it('needs a secret of at least 32 characters and never prints it', () => {
    const issues = ippLinkConfigIssues({ ...full, IPP_LINK_SECRET: 'x'.repeat(31) });
    expect(issues).toEqual(['IPP_LINK_SECRET must be at least 32 characters']);
    expect(ippLinkConfigIssues({ ...full, IPP_LINK_SECRET: 'x'.repeat(32) })).toEqual([]);
  });

  it('names every missing value', () => {
    expect(ippLinkConfigIssues({ IPP_LINK_ENABLED: true })).toHaveLength(2);
  });
});

describe('env.config IPP link values at startup', () => {
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of KEYS) saved[k] = process.env[k];
  });
  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    jest.restoreAllMocks();
  });

  async function load(values: Partial<Record<(typeof KEYS)[number], string>>) {
    for (const k of KEYS) {
      /* Set, even if empty, so a local .env.test cannot fill them in; the timings have no "empty". */
      if (k === 'IPP_API_URL' || k === 'IPP_LINK_SECRET' || values[k] !== undefined) process.env[k] = values[k] ?? '';
      else delete process.env[k];
    }
    const exit = jest.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit ${code}`);
    }) as never);
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    let env: Env | undefined;
    await jest.isolateModulesAsync(async () => {
      try {
        env = (await import('../../../src/config/env.config')).env;
      } catch {
        env = undefined;
      }
    });
    return { env, exit, printed: error.mock.calls.map((c) => c.join(' ')).join('\n') };
  }

  it('is off by default, with the default timings; blank values count as not set', async () => {
    const { env, exit } = await load({ IPP_LINK_ENABLED: 'false', IPP_API_URL: '', IPP_LINK_SECRET: '' });
    expect(exit).not.toHaveBeenCalled();
    expect(env).toMatchObject({ IPP_LINK_ENABLED: false, IPP_HTTP_TIMEOUT_MS: 15_000, IPP_LINK_INTERVAL_SECONDS: 15 });
    expect(env?.IPP_API_URL).toBeUndefined();
    expect(env?.IPP_LINK_SECRET).toBeUndefined();
  });

  it('starts with the link on when both values are entered', async () => {
    const { env, exit } = await load({ IPP_LINK_ENABLED: 'true', IPP_API_URL: URL, IPP_LINK_SECRET: SECRET });
    expect(exit).not.toHaveBeenCalled();
    expect(env?.IPP_API_URL).toBe(URL);
  });

  it.each([
    ['without a URL', { IPP_LINK_ENABLED: 'true', IPP_LINK_SECRET: SECRET }],
    ['without a secret', { IPP_LINK_ENABLED: 'true', IPP_API_URL: URL }],
    ['with a short secret', { IPP_LINK_ENABLED: 'true', IPP_API_URL: URL, IPP_LINK_SECRET: 'short-secret' }],
    ['with an address that is none', { IPP_LINK_ENABLED: 'true', IPP_API_URL: 'ippapi', IPP_LINK_SECRET: SECRET }],
    ['with another protocol', { IPP_LINK_ENABLED: 'true', IPP_API_URL: 'ftp://ipp.example.test', IPP_LINK_SECRET: SECRET }],
    ['with a query', { IPP_LINK_ENABLED: 'true', IPP_API_URL: `${URL}?a=1`, IPP_LINK_SECRET: SECRET }],
  ])('stops startup %s, without printing the secret', async (_name, values) => {
    const { exit, printed } = await load(values);
    expect(exit).toHaveBeenCalledWith(1);
    expect(printed).toMatch(/IPP_/);
    expect(printed).not.toContain(SECRET);
    expect(printed).not.toContain('short-secret');
  });
});
