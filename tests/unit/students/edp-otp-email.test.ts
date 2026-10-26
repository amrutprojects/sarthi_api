import fs from 'fs';
import { buildOtpEmail, buildPasswordResetEmail, EMAIL_PALETTE } from '../../../src/modules/students/edp/edp.mailer';

describe('EDP OTP email', () => {
  const mail = buildOtpEmail('Keshav <script>', '725319', 30);

  it('names the programme and the organisation, and carries the code and its validity', () => {
    expect(mail.subject).toBe('Your OTP – ENTREPRENEURSHIP DEVELOPMENT PROGRAM');
    for (const part of [mail.text, mail.html]) {
      expect(part).toContain('ENTREPRENEURSHIP DEVELOPMENT PROGRAM');
      expect(part).toContain('Sumago Infotech Pvt. Ltd.');
      expect(part).toContain('725319');
      expect(part).toContain('30 seconds');
    }
    /* Never in the subject, which notifications show to anyone near the phone. */
    expect(mail.subject).not.toContain('725319');
  });

  it("uses the website's palette (amrut-kalash-edp src/styles.css tokens), with no leftover blue", () => {
    /* Literal values from the portal's stylesheet: a change on either side has to be made on purpose. */
    expect(EMAIL_PALETTE).toMatchObject({
      page: '#fff6ec', // --bg
      border: '#f0dcc6', // --border
      header: '#8a4116', // --brand-700, the middle of the header gradient
      rule: '#e88c2c', // --saffron, the header's bottom rule
      maroon: '#a63f17', // --maroon
      otpBg: '#fdeedb', // --saffron-100
      otpBorder: '#e0c3a3', // --border-strong
      text: '#3a2a1d', // --text
      muted: '#7a6a5d', // --muted
    });
    for (const colour of Object.values(EMAIL_PALETTE)) expect(mail.html).toContain(colour);
    expect(mail.html.toLowerCase()).not.toContain('#0b3d91');
  });

  it('works in email clients: solid header colour, a fixed width for Outlook', () => {
    /* No gradient: an inverting dark mode inverts a solid colour together with the white text on it. */
    expect(mail.html).not.toMatch(/gradient/i);
    expect(mail.html).toContain(`bgcolor="${EMAIL_PALETTE.header}"`);
    expect(mail.html).toContain('<!--[if mso]><table role="presentation" width="560"');
    expect(mail.html).toContain('<!--[if mso]></td></tr></table><![endif]-->');
  });

  it('escapes the name in the HTML part', () => {
    expect(mail.html).toContain('Dear Keshav &#60;script&#62;,');
    expect(mail.html).not.toContain('<script>');
  });

  it('states a longer lifetime in minutes', () => {
    expect(buildOtpEmail('A', '000111', 300).text).toContain('valid for 5 minutes');
  });
});

describe('EDP OTP email: the Sumago logo', () => {
  it('shows the official logo (inline image) when given its id, else the EDP tile', () => {
    const withLogo = buildOtpEmail('K', '123456', 30, { logoCid: 'sumago-logo@edp' }).html;
    expect(withLogo).toContain('<img src="cid:sumago-logo@edp" width="34" height="34" alt="Sumago Infotech"');
    expect(withLogo).not.toContain('>EDP</td>');
    expect(buildOtpEmail('K', '123456', 30).html).toContain('>EDP</td>');
  });

  it('ships the logo file with the backend (a 96×96 PNG)', () => {
    const { EMAIL_LOGO } = jest.requireActual('../../../src/modules/students/edp/edp.mailer');
    const png = fs.readFileSync(EMAIL_LOGO.path);
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([96, 96]);
  });

  it('sends it inside the email, referenced by the HTML', async () => {
    const sendMail = jest.fn().mockResolvedValue({});
    const saved = { ...process.env };
    try {
      jest.resetModules();
      Object.assign(process.env, { SMTP_HOST: 'smtp.unit.invalid', SMTP_USER: 'edp@unit.invalid', SMTP_PASS: 'unit' });
      jest.doMock('nodemailer', () => ({ __esModule: true, default: { createTransport: () => ({ sendMail }) } }));
      const mailer = await import('../../../src/modules/students/edp/edp.mailer');
      await mailer.edpMailer.sendOtp('student@unit.invalid', 'Kavya', '654321', 30);
      const mail = sendMail.mock.calls[0][0];
      expect(mail.attachments).toEqual([
        expect.objectContaining({ cid: mailer.EMAIL_LOGO.cid, path: mailer.EMAIL_LOGO.path, contentDisposition: 'inline' }),
      ]);
      expect(mail.html).toContain(`cid:${mailer.EMAIL_LOGO.cid}`);
      expect(mail.to).toBe('student@unit.invalid');
    } finally {
      process.env = saved;
      jest.dontMock('nodemailer');
      jest.resetModules();
    }
  });
});

describe('EDP password reset email', () => {
  const link = 'https://edp.sumago.ai/reset-password?token=AbC_d-123';
  const mail = buildPasswordResetEmail('Keshav <b>', link, 30, { logoCid: 'sumago-logo@edp' });

  it('shows one "Reset password" button and its validity, in the portal palette, with no link written out', () => {
    expect(mail.subject).toBe('Reset your password – ENTREPRENEURSHIP DEVELOPMENT PROGRAM');
    expect(mail.html).toContain('<b style="color:#a63f17">30 minutes</b>');
    expect(mail.html).toContain(`bgcolor="${EMAIL_PALETTE.header}"`);
    expect(mail.html).toContain('<img src="cid:sumago-logo@edp"');
    /* No "copy this link" fallback and no "ignore this email" line; the link is never shown as text in the HTML. */
    expect(mail.html).not.toMatch(/does not work|copy this link|ignore this email/i);
    expect(mail.html.replace(/href="[^"]*"/g, '')).not.toContain(link);
  });

  it('makes the whole button a link in every mail app (a VML button for Outlook, a padded link elsewhere)', () => {
    const outlook = /<!--\[if mso\]>([\s\S]*?)<!\[endif\]-->/.exec(mail.html.split('Dear Keshav')[1])![1];
    expect(outlook).toContain(`<v:roundrect xmlns:v="urn:schemas-microsoft-com:vml"`);
    expect(outlook).toContain(`href="${link}"`);
    expect(outlook).toContain('>Reset password</center>');
    const others = /<!--\[if !mso\]><!-->([\s\S]*?)<!--<!\[endif\]-->/.exec(mail.html)![1];
    expect(others).toMatch(new RegExp(`^<a href="${link.replace('?', '[?]')}" target="_blank" rel="noopener" style="display:inline-block;padding:13px 32px;`));
    expect(others).toContain('>Reset password</a>');
  });

  it('carries the link itself in the plain-text part (mail apps without HTML have no button)', () => {
    expect(mail.text).toContain(`To set a new password, open this link:\n\n${link}\n`);
    expect(mail.text).toContain('valid for 30 minutes and can be used once');
    expect(mail.text).not.toMatch(/ignore this email/i);
  });

  it('escapes the name and the link in the HTML part', () => {
    expect(mail.html).toContain('Dear Keshav &#60;b&#62;,');
    const odd = buildPasswordResetEmail('A', 'https://x.example/r?token=a"><script>', 30).html;
    expect(odd).not.toContain('"><script>');
    expect(odd).toContain('token=a&#34;&#62;&#60;script&#62;');
  });
});
