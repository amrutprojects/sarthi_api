import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import nodemailer, { type Transporter } from 'nodemailer';
import { HTTP_STATUS } from '../../../constants/api-response.constants';
import { appConfig } from '../../../config/app.config';
import { backendRoot, env } from '../../../config/env.config';
import { logger } from '../../../observability/logger';
import { AppError } from '../../../shared/errors/app-error';
import { edpSettingsService } from './edp-settings.service';
import { EDP_ERROR_CODES, EDP_MESSAGES, EDP_ORGANISATION, EDP_PROGRAM_TITLE } from './edp.constants';

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/*
 * The portal's colours (EDP portal src/styles.css): cream page, white card, maroon accents, a saffron rule under the
 * header. Email clients drop <style>, so every colour is inline.
 */
export const EMAIL_PALETTE = {
  page: '#f7f1ea',
  card: '#ffffff',
  border: '#ead9c6',
  header: '#ffffff',
  rule: '#e88c2c',
  maroon: '#a63f17',
  otpBg: '#fdf3e7',
  otpBorder: '#e8c9a6',
  text: '#2f2419',
  muted: '#77685b',
  noteBg: '#fff8ec',
  noteBorder: '#f1c98a',
  footBg: '#fbf7f2',
} as const;

/*
 * The official Sumago Infotech logo, sent inside the email as an inline (cid) attachment: inline images show without
 * the "load images" prompt that remote ones get. Resolved from the backend folder (src via ts-node, and dist).
 */
export const EMAIL_LOGO = { path: path.join(backendRoot, 'assets', 'edp', 'sumago-logo-96.png'), cid: 'sumago-logo@edp' } as const;
let logoAvailable: boolean | null = null;
const hasLogo = () => (logoAvailable ??= fs.existsSync(EMAIL_LOGO.path));

/* The sender's display name when SMTP_FROM is not set: a bare address is a strong spam signal. */
export const EDP_SENDER_NAME = 'EDP – Sumago Infotech';

const SERIF = "Georgia,'Times New Roman',serif";
const SANS = "'Segoe UI',Arial,Helvetica,sans-serif";

export interface EmailOptions {
  /* The inline logo's id; without it, an "EDP" tile. */
  logoCid?: string;
  /* The support contact line (edited in the tracking panel), shown in the footer. */
  support?: { message?: string; email: string | null; mobile: string | null };
}

/* The support message with {email} and {mobile} filled in, as plain text. */
export function supportText(support: EmailOptions['support']): string {
  if (!support) return '';
  const message = support.message ?? '';
  if (!message.trim())
    return [support.email, support.mobile].filter(Boolean).length
      ? `Need help? ${[support.email, support.mobile].filter(Boolean).join(' / ')}`
      : '';
  const filled = message.replace(/\{email\}/g, support.email ?? '').replace(/\{mobile\}/g, support.mobile ?? '');
  const extra = [!message.includes('{email}') && support.email, !message.includes('{mobile}') && support.mobile].filter(Boolean);
  return extra.length ? `${filled} ${extra.join(' / ')}` : filled;
}

/* The footer's help line: the support message, with the email and the mobile number as links. */
function supportLine(support: EmailOptions['support'], P: typeof EMAIL_PALETTE): string {
  if (!support || (!support.message?.trim() && !support.email && !support.mobile)) return '';
  const email = support.email
    ? `<a href="mailto:${escapeHtml(support.email)}" style="color:${P.maroon};text-decoration:underline">${escapeHtml(support.email)}</a>`
    : '';
  const mobile = support.mobile
    ? `<a href="tel:${escapeHtml(support.mobile.replace(/[^\d+]/g, ''))}" style="color:${P.maroon};text-decoration:none"><b>${escapeHtml(support.mobile)}</b></a>`
    : '';
  const message = support.message?.trim() ?? '';
  let html: string;
  if (!message) html = `Need help? ${[email, mobile].filter(Boolean).join(' or ')}.`;
  else {
    html = escapeHtml(message)
      .replace(/\{email\}/g, email)
      .replace(/\{mobile\}/g, mobile);
    const extra = [!message.includes('{email}') && email, !message.includes('{mobile}') && mobile].filter(Boolean);
    if (extra.length) html += ` ${extra.join(' / ')}`;
  }
  return `<p style="margin:0 0 8px">${html}</p>`;
}

/*
 * The frame every portal email shares: a hidden preview line (preheader), the header (logo, programme, organisation),
 * the body rows, and the footer (help line, automated-message note). Built for email clients: tables and inline styles
 * only, a white header (so the logo shows on its own white background, also in dark mode), a fixed 560px table for
 * Outlook on Windows (which ignores max-width), and padding small enough for a 320px phone.
 */
function emailFrame(title: string, preheader: string, bodyRows: string, opts: EmailOptions = {}): string {
  const P = EMAIL_PALETTE;
  const logo = opts.logoCid
    ? `<img src="cid:${opts.logoCid}" width="48" height="48" alt="Sumago Infotech" style="display:block;width:48px;height:48px;border:0;outline:none;text-decoration:none">`
    : `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td width="48" height="48" align="center" valign="middle" bgcolor="${P.maroon}" style="width:48px;height:48px;border-radius:12px;background:${P.maroon};color:#ffffff;font-family:${SANS};font-weight:bold;font-size:15px;letter-spacing:.5px">EDP</td></tr></table>`;
  return `<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;padding:0;background:${P.page};-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;font-size:1px;line-height:1px;color:${P.page}">${escapeHtml(preheader)}&#8203;&#847;&#8203;&#847;&#8203;&#847;&#8203;&#847;&#8203;&#847;&#8203;&#847;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${P.page}" style="background:${P.page}">
  <tr><td align="center" style="padding:24px 10px">
    <!--[if mso]><table role="presentation" width="560" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:${P.card};border:1px solid ${P.border};border-radius:14px;font-family:${SANS};color:${P.text}">
      <tr><td bgcolor="${P.header}" style="background:${P.header};border-bottom:3px solid ${P.rule};border-radius:14px 14px 0 0;padding:20px 24px">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
          <td width="48" valign="middle" style="width:48px">${logo}</td>
          <td valign="middle" style="padding-left:14px">
            <div style="font-family:${SERIF};font-size:18px;font-weight:bold;color:${P.maroon};line-height:1.25">${EDP_PROGRAM_TITLE}</div>
            <div style="font-family:${SANS};font-size:13px;color:${P.muted};margin-top:3px">by ${EDP_ORGANISATION}</div>
          </td>
        </tr></table>
      </td></tr>
${bodyRows}
      <tr><td bgcolor="${P.footBg}" style="background:${P.footBg};border-top:1px solid ${P.border};border-radius:0 0 14px 14px;padding:18px 24px;font-size:12px;line-height:1.6;color:${P.muted}">
        ${supportLine(opts.support, P)}
        <p style="margin:0 0 8px">This is an automated email from the ${EDP_PROGRAM_TITLE} portal.</p>
        <p style="margin:0">&copy; ${new Date().getFullYear()} ${EDP_ORGANISATION}</p>
      </td></tr>
    </table>
    <!--[if mso]></td></tr></table><![endif]-->
  </td></tr>
</table>
</body>
</html>`;
}

/* A highlighted security note. */
const note = (html: string) => {
  const P = EMAIL_PALETTE;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px"><tr>
          <td bgcolor="${P.noteBg}" style="background:${P.noteBg};border-left:4px solid ${P.noteBorder};border-radius:6px;padding:12px 14px;font-size:13px;line-height:1.5;color:${P.text}">${html}</td>
        </tr></table>`;
};

const validityText = (ttlSeconds: number) => (ttlSeconds < 120 ? `${ttlSeconds} seconds` : `${Math.round(ttlSeconds / 60)} minutes`);

/*
 * Subject, plain text and HTML of the one-time code email (account sign-up). The code is never in the subject or the
 * preview line, so it does not show on a lock screen or in a notification.
 */
export function buildOtpEmail(name: string, otp: string, ttlSeconds: number, opts: EmailOptions = {}) {
  const P = EMAIL_PALETTE;
  const validity = validityText(ttlSeconds);
  const subject = `Your verification code – ${EDP_PROGRAM_TITLE}`;
  const text = [
    `Dear ${name},`,
    '',
    `Use this verification code to finish creating your ${EDP_PROGRAM_TITLE} account:`,
    '',
    `    ${otp}`,
    '',
    `The code expires in ${validity}.`,
    `Do not share it with anyone. ${EDP_ORGANISATION} will never ask you for this code.`,
    'If you did not try to create an account, you can ignore this email.',
    '',
    ...(supportText(opts.support) ? [supportText(opts.support), ''] : []),
    `${EDP_PROGRAM_TITLE}`,
    EDP_ORGANISATION,
  ].join('\n');
  const html = emailFrame(
    subject,
    `Your verification code expires in ${validity}.`,
    `      <tr><td style="padding:28px 24px 10px;font-size:15px;line-height:1.6">
        <h1 style="margin:0 0 16px;font-family:${SERIF};font-size:22px;line-height:1.3;color:${P.text}">Verify your email address</h1>
        <p style="margin:0 0 12px">Dear ${escapeHtml(name)},</p>
        <p style="margin:0 0 20px">Use the verification code below to finish creating your <b>${EDP_PROGRAM_TITLE}</b> account.</p>
        <table role="presentation" align="center" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto 10px"><tr>
          <td bgcolor="${P.otpBg}" align="center" style="background:${P.otpBg};border:1px solid ${P.otpBorder};border-radius:12px;padding:16px 30px;font-family:'Courier New',Courier,monospace;font-size:34px;font-weight:bold;letter-spacing:10px;color:${P.maroon};mso-line-height-rule:exactly;line-height:40px">${escapeHtml(otp)}</td>
        </tr></table>
        <p style="margin:0 0 22px;text-align:center;font-size:13px;color:${P.muted}">This code expires in <b style="color:${P.maroon}">${validity}</b>.</p>
        ${note(`<b>Keep this code private.</b> Do not share it with anyone. ${EDP_ORGANISATION} will never ask you for this code by phone, SMS or email.`)}
        <p style="margin:0 0 18px;font-size:13px;color:${P.muted}">If you did not try to create an account, you can safely ignore this email.</p>
      </td></tr>`,
    opts,
  );
  return { subject, text, html };
}

/*
 * Subject, plain text and HTML of the "Forgot password" email: one button to the portal's page for a new password (the
 * HTML shows no link written out). `link` carries the one-time token. The button is "bulletproof": a VML button for
 * Outlook on Windows (which ignores padding on links, so only the words would be clickable) and a padded link everywhere
 * else, so the whole button opens the page in every mail app. The plain-text part (mail apps without HTML) has no button,
 * so it carries the link itself.
 */
export function buildPasswordResetEmail(name: string, link: string, minutes: number, opts: EmailOptions = {}) {
  const P = EMAIL_PALETTE;
  const href = escapeHtml(link);
  const subject = `Reset your password – ${EDP_PROGRAM_TITLE}`;
  const text = [
    `Dear ${name},`,
    '',
    `We received a request to reset the password of your ${EDP_PROGRAM_TITLE} account (${EDP_ORGANISATION}).`,
    'To set a new password, open this link:',
    '',
    link,
    '',
    `This link is valid for ${minutes} minutes and can be used once.`,
    '',
    EDP_PROGRAM_TITLE,
    EDP_ORGANISATION,
  ].join('\n');
  const html = emailFrame(
    subject,
    `Set a new password for your account. The link is valid for ${minutes} minutes.`,
    `      <tr><td style="padding:28px 24px 10px;font-size:15px;line-height:1.6">
        <h1 style="margin:0 0 16px;font-family:${SERIF};font-size:22px;line-height:1.3;color:${P.text}">Reset your password</h1>
        <p style="margin:0 0 12px">Dear ${escapeHtml(name)},</p>
        <p style="margin:0 0 20px">We received a request to reset the password of your <b>${EDP_PROGRAM_TITLE}</b> account. To set a new password, click the button below.</p>
        <table role="presentation" align="center" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto 18px"><tr>
          <td align="center" bgcolor="${P.maroon}" style="background:${P.maroon};border-radius:8px">
            <!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${href}" style="height:46px;v-text-anchor:middle;width:210px" arcsize="17%" stroke="f" fillcolor="${P.maroon}"><w:anchorlock/><center style="color:#ffffff;font-family:${SANS};font-size:15px;font-weight:bold">Reset password</center></v:roundrect><![endif]-->
            <!--[if !mso]><!--><a href="${href}" target="_blank" rel="noopener" style="display:inline-block;padding:13px 32px;font-family:${SANS};font-size:15px;font-weight:bold;line-height:20px;color:#ffffff;text-decoration:none;border-radius:8px;border:1px solid ${P.maroon};background:${P.maroon}">Reset password</a><!--<![endif]-->
          </td>
        </tr></table>
        <p style="margin:0 0 22px;text-align:center;font-size:13px;color:${P.muted}">This link is valid for <b style="color:${P.maroon}">${minutes} minutes</b> and can be used once.</p>
        ${note('If you did not ask to reset your password, your password has not been changed and no action is needed.')}
      </td></tr>`,
    opts,
  );
  return { subject, text, html };
}

let transport: Transporter | null = null;
const unavailable = () => new AppError(HTTP_STATUS.SERVICE_UNAVAILABLE, EDP_MESSAGES.EMAIL_UNAVAILABLE, EDP_ERROR_CODES.EMAIL_UNAVAILABLE);

/*
 * Sends one portal email through the configured SMTP server (SMTP_*), with the logo inline. With no SMTP host,
 * development and test runs write `devLog` (the code or link) to the API log instead, so the flow can be tried locally;
 * any other environment refuses (503).
 */
async function send(
  to: string,
  what: string,
  build: (opts: EmailOptions) => { subject: string; text: string; html: string },
  devLog: Record<string, string>,
): Promise<void> {
  const smtp = appConfig.edp.smtp;
  if (!smtp.host) {
    if (env.NODE_ENV !== 'development' && env.NODE_ENV !== 'test') throw unavailable();
    logger.warn({ to, ...devLog }, `EDP ${what} email NOT sent: SMTP_HOST is not configured (development only, logged instead)`);
    return;
  }
  transport ??= nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
  });
  const logo = hasLogo();
  try {
    const support = await edpSettingsService.support();
    await transport.sendMail({
      /* A display name with the address (SMTP_FROM when set, else "EDP – Sumago Infotech <SMTP_USER>"). */
      from: env.SMTP_FROM ? smtp.from : { name: EDP_SENDER_NAME, address: smtp.user ?? '' },
      /* Replies reach the support team when one is configured. */
      ...(support.email ? { replyTo: support.email } : {}),
      to,
      ...build({ ...(logo ? { logoCid: EMAIL_LOGO.cid } : {}), support }),
      /* Each email its own thread in Gmail (codes are not collapsed into one conversation). */
      headers: { 'X-Entity-Ref-ID': randomUUID() },
      attachments: logo ? [{ filename: 'sumago-logo.png', path: EMAIL_LOGO.path, cid: EMAIL_LOGO.cid, contentDisposition: 'inline' }] : [],
    });
  } catch (err) {
    logger.error({ err, to }, `EDP ${what} email could not be sent`);
    throw unavailable();
  }
}

/* The portal's emails: the one-time code (sign-up) and the password reset link (Forgot password). */
export const edpMailer = {
  sendOtp(to: string, name: string, otp: string, ttlSeconds: number): Promise<void> {
    return send(to, 'OTP', (o) => buildOtpEmail(name, otp, ttlSeconds, o), { otp });
  },
  sendPasswordReset(to: string, name: string, link: string, minutes: number): Promise<void> {
    return send(to, 'password reset', (o) => buildPasswordResetEmail(name, link, minutes, o), { link });
  },
};
