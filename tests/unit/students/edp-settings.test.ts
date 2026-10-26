/* EDP portal settings from the environment: when a new OTP may be requested, and the contact shown after submitting. */
import type { appConfig } from '../../../src/config/app.config';

type AppConfig = typeof appConfig;

const KEYS = ['EDP_OTP_TTL_SECONDS', 'EDP_OTP_RESEND_SECONDS', 'EDP_SUPPORT_EMAIL', 'EDP_SUPPORT_MOBILE'] as const;

async function load(vars: Partial<Record<(typeof KEYS)[number], string>>): Promise<AppConfig> {
  const saved = { ...process.env };
  try {
    jest.resetModules();
    for (const k of KEYS) delete process.env[k];
    Object.assign(process.env, vars);
    return (await import('../../../src/config/app.config')).appConfig;
  } finally {
    process.env = saved;
    jest.resetModules();
  }
}

describe('EDP OTP resend wait', () => {
  it('is the OTP lifetime when not set: a new OTP only once the current one has expired', async () => {
    expect((await load({})).edp).toMatchObject({ otpTtlSeconds: 300, otpResendSeconds: 300 });
    expect((await load({ EDP_OTP_TTL_SECONDS: '600', EDP_OTP_RESEND_SECONDS: '' })).edp).toMatchObject({
      otpTtlSeconds: 600,
      otpResendSeconds: 600,
    });
  });

  it('can be set shorter, but never longer than the lifetime', async () => {
    expect((await load({ EDP_OTP_RESEND_SECONDS: '60' })).edp.otpResendSeconds).toBe(60);
    expect((await load({ EDP_OTP_RESEND_SECONDS: '900' })).edp.otpResendSeconds).toBe(300);
  });
});

describe('EDP support contact', () => {
  it('comes from EDP_SUPPORT_EMAIL and EDP_SUPPORT_MOBILE', async () => {
    const cfg = await load({ EDP_SUPPORT_EMAIL: ' help@edp.example ', EDP_SUPPORT_MOBILE: '+91 80103 85237' });
    expect(cfg.edp.support).toEqual({ email: 'help@edp.example', mobile: '+91 80103 85237' });
  });

  it('is null when not set or empty', async () => {
    expect((await load({})).edp.support).toEqual({ email: null, mobile: null });
    expect((await load({ EDP_SUPPORT_EMAIL: '', EDP_SUPPORT_MOBILE: '' })).edp.support).toEqual({ email: null, mobile: null });
  });

  it('refuses to start with a value that is not an email address or a phone number', async () => {
    const exit = jest.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('exit');
    });
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await expect(load({ EDP_SUPPORT_EMAIL: 'not-an-email' })).rejects.toThrow('exit');
      expect(error.mock.calls.flat().join('\n')).toContain('EDP_SUPPORT_EMAIL must be an email address');
      await expect(load({ EDP_SUPPORT_MOBILE: 'call us' })).rejects.toThrow('exit');
      expect(error.mock.calls.flat().join('\n')).toContain('EDP_SUPPORT_MOBILE must be a phone number');
    } finally {
      exit.mockRestore();
      error.mockRestore();
    }
  });
});
