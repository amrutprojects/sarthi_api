import fs from 'fs';
import { buildOtpEmail, buildPasswordResetEmail, EMAIL_PALETTE } from '../../../src/modules/students/edp/edp.mailer';

describe('EDP OTP email', () => {
  const mail = buildOtpEmail('Keshav <script>', '725319', 30);

  it('names the programme (in title case) and the organisation, and carries the code and its validity', () => {
    expect(mail.subject).toBe('Your verification code – Entrepreneurship Development Program');
    for (const part of [mail.text, mail.html]) {
      expect(part).toContain('Entrepreneurship Development Program');
      expect(part).toContain('Sumago Infotech Pvt. Ltd.');
      expect(part).toContain('725319');
      expect(part).toContain('30 seconds');
      /* No all-capital programme name: it reads as shouting and raises spam scores. */
      expect(part).not.toContain('ENTREPRENEURSHIP DEVELOPMENT PROGRAM');
    }
    expect(mail.html).toContain('Verify your email address');
  });

  it('keeps the code out of the subject and the preview line, which notifications show to anyone near the phone', () => {
    expect(mail.subject).not.toContain('725319');
    const preheader = /<div style="display:none;[^"]*">([^<]*)/.exec(mail.html)![1];
    expect(preheader).toContain('Your verification code expires in 30 seconds.');
    expect(preheader).not.toContain('725319');
  });

  it('is a complete HTML document (charset, viewport, title), as spam filters expect', () => {
    expect(mail.html).toMatch(/^<!doctype html>\n<html lang="en"/);
    expect(mail.html).toContain('<meta charset="utf-8">');
    expect(mail.html).toContain('<meta name="viewport" content="width=device-width, initial-scale=1">');
    expect(mail.html).toContain(`<title>${mail.subject}</title>`);
  });

  it("uses the portal's palette, with no leftover blue", () => {
    for (const colour of Object.values(EMAIL_PALETTE)) expect(mail.html).toContain(colour);
    expect(mail.html.toLowerCase()).not.toContain('#0b3d91');
  });

  it('works in email clients: no gradient, a white header for the logo, a fixed width for Outlook', () => {
    expect(mail.html).not.toMatch(/gradient/i);
    expect(EMAIL_PALETTE.header).toBe('#ffffff');
    expect(mail.html).toContain(`bgcolor="${EMAIL_PALETTE.header}"`);
    expect(mail.html).toContain('<!--[if mso]><table role="presentation" width="560"');
    expect(mail.html).toContain('<!--[if mso]></td></tr></table><![endif]-->');
  });

  it('escapes the name in the HTML part', () => {
    expect(mail.html).toContain('Dear Keshav &#60;script&#62;,');
    expect(mail.html).not.toContain('<script>');
  });

  it('states a longer lifetime in minutes', () => {
    expect(buildOtpEmail('A', '000111', 300).text).toContain('expires in 5 minutes');
  });

  it('shows the support contact in the footer when one is configured, and none otherwise', () => {
    const withSupport = buildOtpEmail('A', '000111', 300, { support: { email: 'help@unit.invalid', mobile: '+91 80103 85237' } });
    expect(withSupport.html).toContain('href="mailto:help@unit.invalid"');
    expect(withSupport.html).toContain('+91 80103 85237');
    expect(withSupport.text).toContain('Need help? help@unit.invalid / +91 80103 85237');
    expect(mail.html).not.toContain('Need help?');
  });
});

describe('EDP OTP email: the Sumago logo', () => {
  it('shows the official logo (inline image, 48px) when given its id, else the EDP tile', () => {
    const withLogo = buildOtpEmail('K', '123456', 30, { logoCid: 'sumago-logo@edp' }).html;
    expect(withLogo).toContain('<img src="cid:sumago-logo@edp" width="48" height="48" alt="Sumago Infotech"');
    expect(withLogo).not.toContain('>EDP</td>');
    expect(buildOtpEmail('K', '123456', 30).html).toContain('>EDP</td>');
  });

  it('ships the logo file with the backend (a 96×96 PNG, shown at 48px for sharp high-density screens)', () => {
    const { EMAIL_LOGO } = jest.requireActual('../../../src/modules/students/edp/edp.mailer');
    const png = fs.readFileSync(EMAIL_LOGO.path);
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([96, 96]);
  });

  async function sentWith(env: Record<string, string>) {
    const sendMail = jest.fn().mockResolvedValue({});
    const saved = { ...process.env };
    try {
      jest.resetModules();
      delete process.env.SMTP_FROM;
      delete process.env.EDP_SUPPORT_EMAIL;
      Object.assign(process.env, { SMTP_HOST: 'smtp.unit.invalid', SMTP_USER: 'edp@unit.invalid', SMTP_PASS: 'unit', ...env });
      jest.doMock('nodemailer', () => ({ __esModule: true, default: { createTransport: () => ({ sendMail }) } }));
      const mailer = await import('../../../src/modules/students/edp/edp.mailer');
      await mailer.edpMailer.sendOtp('student@unit.invalid', 'Kavya', '654321', 30);
      return { mail: sendMail.mock.calls[0][0], mailer };
    } finally {
      process.env = saved;
      jest.dontMock('nodemailer');
      jest.resetModules();
    }
  }

  it('sends the logo inside the email, referenced by the HTML', async () => {
    const { mail, mailer } = await sentWith({});
    expect(mail.attachments).toEqual([
      expect.objectContaining({ cid: mailer.EMAIL_LOGO.cid, path: mailer.EMAIL_LOGO.path, contentDisposition: 'inline' }),
    ]);
    expect(mail.html).toContain(`cid:${mailer.EMAIL_LOGO.cid}`);
    expect(mail.to).toBe('student@unit.invalid');
  });

  it('sends from a named sender (never a bare address), with a unique reference header', async () => {
    const { mail } = await sentWith({});
    expect(mail.from).toEqual({ name: 'EDP – Sumago Infotech', address: 'edp@unit.invalid' });
    expect(mail.headers['X-Entity-Ref-ID']).toMatch(/^[0-9a-f-]{36}$/);
    expect(mail.replyTo).toBeUndefined();
    /* SMTP_FROM, when set, is used as given. */
    expect((await sentWith({ SMTP_FROM: 'EDP <no-reply@unit.invalid>' })).mail.from).toBe('EDP <no-reply@unit.invalid>');
  });

  it('sends replies to the support email when one is configured', async () => {
    const { mail } = await sentWith({ EDP_SUPPORT_EMAIL: 'help@unit.invalid' });
    expect(mail.replyTo).toBe('help@unit.invalid');
    expect(mail.html).toContain('href="mailto:help@unit.invalid"');
  });
});

describe('EDP password reset email', () => {
  const link = 'https://edp.sumago.ai/reset-password?token=AbC_d-123';
  const mail = buildPasswordResetEmail('Keshav <b>', link, 30, { logoCid: 'sumago-logo@edp' });

  it('shows one "Reset password" button and its validity, in the portal palette, with no link written out', () => {
    expect(mail.subject).toBe('Reset your password – Entrepreneurship Development Program');
    expect(mail.html).toContain('<b style="color:#a63f17">30 minutes</b>');
    expect(mail.html).toContain(`bgcolor="${EMAIL_PALETTE.header}"`);
    expect(mail.html).toContain('<img src="cid:sumago-logo@edp"');
    /* No "copy this link" fallback; the link is never shown as text in the HTML. */
    expect(mail.html).not.toMatch(/does not work|copy this link/i);
    expect(mail.html.replace(/href="[^"]*"/g, '')).not.toContain(link);
  });

  it('makes the whole button a link in every mail app (a VML button for Outlook, a padded link elsewhere)', () => {
    const outlook = /<!--\[if mso\]>([\s\S]*?)<!\[endif\]-->/.exec(mail.html.split('Dear Keshav')[1])![1];
    expect(outlook).toContain(`<v:roundrect xmlns:v="urn:schemas-microsoft-com:vml"`);
    expect(outlook).toContain(`href="${link}"`);
    expect(outlook).toContain('>Reset password</center>');
    const others = /<!--\[if !mso\]><!-->([\s\S]*?)<!--<!\[endif\]-->/.exec(mail.html)![1];
    expect(others).toMatch(
      new RegExp(`^<a href="${link.replace('?', '[?]')}" target="_blank" rel="noopener" style="display:inline-block;padding:13px 32px;`),
    );
    expect(others).toContain('>Reset password</a>');
  });

  it('carries the link itself in the plain-text part (mail apps without HTML have no button)', () => {
    expect(mail.text).toContain(`To set a new password, open this link:\n\n${link}\n`);
    expect(mail.text).toContain('valid for 30 minutes and can be used once');
  });

  it('escapes the name and the link in the HTML part', () => {
    expect(mail.html).toContain('Dear Keshav &#60;b&#62;,');
    const odd = buildPasswordResetEmail('A', 'https://x.example/r?token=a"><script>', 30).html;
    expect(odd).not.toContain('"><script>');
    expect(odd).toContain('token=a&#34;&#62;&#60;script&#62;');
  });
});

describe('EDP emails: the support contact line', () => {
  const support = {
    message: 'If you have any query related to your registration, you can contact us on email ID {email} or mobile number {mobile}.',
    email: 'prasadp@sumagoinfotech.com',
    mobile: '85300 92236',
  };

  it('shows the saved message with the email and the mobile number as links', () => {
    const mail = buildOtpEmail('A', '000111', 300, { support });
    expect(mail.html).toContain(
      'contact us on email ID <a href="mailto:prasadp@sumagoinfotech.com" style="color:#a63f17;text-decoration:underline">prasadp@sumagoinfotech.com</a> or mobile number <a href="tel:8530092236"',
    );
    expect(mail.text).toContain('contact us on email ID prasadp@sumagoinfotech.com or mobile number 85300 92236.');
  });

  it('escapes the message, and adds contacts the message does not mention', () => {
    const mail = buildOtpEmail('A', '000111', 300, { support: { message: 'Help <b>here</b>:', email: 'help@unit.invalid', mobile: null } });
    expect(mail.html).toContain('Help &#60;b&#62;here&#60;/b&#62;: <a href="mailto:help@unit.invalid"');
    expect(mail.html).not.toContain('<b>here</b>');
  });
});
