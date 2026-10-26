import fs from 'fs';
import path from 'path';
import nodemailer, { type Transporter } from 'nodemailer';
import { HTTP_STATUS } from '../../../constants/api-response.constants';
import { appConfig } from '../../../config/app.config';
import { backendRoot, env } from '../../../config/env.config';
import { logger } from '../../../observability/logger';
import { AppError } from '../../../shared/errors/app-error';
import { EDP_ERROR_CODES, EDP_MESSAGES, EDP_ORGANISATION, EDP_PROGRAM_NAME } from './edp.constants';

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/*
 * The portal's colours (amrut-kalash-edp src/styles.css, the AMRUT admin palette): the brown header (the middle of the
 * portal's header gradient, as a solid colour) with its saffron rule, cream page, maroon accents. Email clients drop
 * <style>, so every colour is inline.
 */
export const EMAIL_PALETTE = {
  page: '#fff6ec',
  card: '#ffffff',
  border: '#f0dcc6',
  header: '#8a4116',
  rule: '#e88c2c',
  headerSub: '#fbe3cb',
  maroon: '#a63f17',
  otpBg: '#fdeedb',
  otpBorder: '#e0c3a3',
  text: '#3a2a1d',
  muted: '#7a6a5d',
  footBg: '#fef8f1',
} as const;

/*
 * The official Sumago Infotech logo (from sumagoinfotech.com), sent inside the email as an inline (cid) attachment: an
 * email cannot load it from the portal, and inline images show without the "load images" prompt that remote ones get.
 * Resolved from the backend folder, so it is found from src (ts-node) and from dist alike.
 */
export const EMAIL_LOGO = { path: path.join(backendRoot, 'assets', 'edp', 'sumago-logo-96.png'), cid: 'sumago-logo@edp' } as const;
let logoAvailable: boolean | null = null;
const hasLogo = () => (logoAvailable ??= fs.existsSync(EMAIL_LOGO.path));

const SERIF = "Georgia,'Times New Roman',serif";
const SANS = 'Arial,Helvetica,sans-serif';

/*
 * The frame every portal email shares: the header (logo, programme, organisation), the given body rows, the footer.
 * Built for email clients: a solid header colour (an inverting dark mode, e.g. Gmail on iOS, inverts it together with
 * its text; a gradient image would stay dark under darkened text), a fixed 560px table for Outlook on Windows (which
 * ignores max-width), and side padding small enough for a 320px phone. `logoCid`: the inline logo's id; without it, an
 * "EDP" tile.
 */
function emailFrame(bodyRows: string, logoCid?: string): string {
  const P = EMAIL_PALETTE;
  return `<!doctype html>
<html lang="en">
<body style="margin:0;padding:0;background:${P.page}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${P.page}" style="background:${P.page}">
  <tr><td align="center" style="padding:20px 8px">
    <!--[if mso]><table role="presentation" width="560" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:${P.card};border:1px solid ${P.border};border-radius:12px;font-family:${SANS};color:${P.text}">
      <tr><td bgcolor="${P.header}" style="background:${P.header};border-bottom:3px solid ${P.rule};border-radius:12px 12px 0 0;padding:18px 18px">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
          ${
            logoCid
              ? `<td width="44" height="44" align="center" valign="middle" bgcolor="#ffffff" style="width:44px;height:44px;border-radius:10px;background:#ffffff"><img src="cid:${logoCid}" width="34" height="34" alt="Sumago Infotech" style="display:block;width:34px;height:34px;border:0"></td>`
              : `<td width="44" height="44" align="center" valign="middle" style="width:44px;height:44px;border:1px solid #c98a5f;border-radius:10px;background:#9b4d1f;color:#ffffff;font-family:${SANS};font-weight:bold;font-size:14px;letter-spacing:.5px">EDP</td>`
          }
          <td style="padding-left:12px">
            <div style="font-family:${SERIF};font-size:17px;font-weight:bold;letter-spacing:.3px;color:#ffffff;line-height:1.25;word-break:break-word">${EDP_PROGRAM_NAME}</div>
            <div style="font-family:${SANS};font-size:12px;color:${P.headerSub};margin-top:2px">by ${EDP_ORGANISATION}</div>
          </td>
        </tr></table>
      </td></tr>
${bodyRows}
      <tr><td bgcolor="${P.footBg}" style="background:${P.footBg};border-top:1px solid ${P.border};border-radius:0 0 12px 12px;padding:14px 18px;font-size:12px;line-height:1.5;color:${P.muted}">
        <b style="font-family:${SERIF};color:${P.maroon}">${EDP_PROGRAM_NAME}</b><br>${EDP_ORGANISATION}
      </td></tr>
    </table>
    <!--[if mso]></td></tr></table><![endif]-->
  </td></tr>
</table>
</body>
</html>`;
}

/* Subject, plain text and HTML of the one-time code email. `logoCid`: the inline logo's id; without it, an "EDP" tile. */
export function buildOtpEmail(name: string, otp: string, ttlSeconds: number, opts: { logoCid?: string } = {}) {
  const P = EMAIL_PALETTE;
  const validity = ttlSeconds < 120 ? `${ttlSeconds} seconds` : `${Math.round(ttlSeconds / 60)} minutes`;
  const text = [
    `Dear ${name},`,
    '',
    `Your one-time password (OTP) for ${EDP_PROGRAM_NAME} by ${EDP_ORGANISATION} is:`,
    '',
    `    ${otp}`,
    '',
    `This OTP is valid for ${validity}. Do not share it with anyone.`,
    'If you did not create an account, please ignore this email.',
    '',
    EDP_PROGRAM_NAME,
    EDP_ORGANISATION,
  ].join('\n');
  const html = emailFrame(
    `      <tr><td style="padding:24px 18px 8px;font-size:15px;line-height:1.55">
        <p style="margin:0 0 14px">Dear ${escapeHtml(name)},</p>
        <p style="margin:0 0 18px">Your one-time password (OTP) for <b style="color:${P.maroon}">${EDP_PROGRAM_NAME}</b> by ${EDP_ORGANISATION} is:</p>
        <table role="presentation" align="center" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto 18px"><tr>
          <td bgcolor="${P.otpBg}" style="background:${P.otpBg};border:1px dashed ${P.otpBorder};border-radius:10px;padding:14px 28px;font-family:'Courier New',Courier,monospace;font-size:32px;font-weight:bold;letter-spacing:10px;color:${P.maroon}">${otp}</td>
        </tr></table>
        <p style="margin:0 0 10px">This OTP is valid for <b style="color:${P.maroon}">${validity}</b>. Do not share it with anyone.</p>
        <p style="margin:0 0 18px;font-size:13px;color:${P.muted}">If you did not create an account, please ignore this email.</p>
      </td></tr>`,
    opts.logoCid,
  );
  return { subject: `Your OTP – ${EDP_PROGRAM_NAME}`, text, html };
}

/*
 * Subject, plain text and HTML of the "Forgot password" email: one button to the portal's page for a new password (the
 * HTML shows no link written out). `link` carries the one-time token. The button is "bulletproof": a VML button for
 * Outlook on Windows (which ignores padding on links, so only the words would be clickable) and a padded link everywhere
 * else, so the whole button opens the page in every mail app. The plain-text part (mail apps without HTML) has no button,
 * so it carries the link itself.
 */
export function buildPasswordResetEmail(name: string, link: string, minutes: number, opts: { logoCid?: string } = {}) {
  const P = EMAIL_PALETTE;
  const href = escapeHtml(link);
  const text = [
    `Dear ${name},`,
    '',
    `We received a request to reset the password of your ${EDP_PROGRAM_NAME} account (${EDP_ORGANISATION}).`,
    'To set a new password, open this link:',
    '',
    link,
    '',
    `This link is valid for ${minutes} minutes and can be used once.`,
    '',
    EDP_PROGRAM_NAME,
    EDP_ORGANISATION,
  ].join('\n');
  const html = emailFrame(
    `      <tr><td style="padding:24px 18px 8px;font-size:15px;line-height:1.55">
        <p style="margin:0 0 14px">Dear ${escapeHtml(name)},</p>
        <p style="margin:0 0 18px">We received a request to reset the password of your <b style="color:${P.maroon}">${EDP_PROGRAM_NAME}</b> account (${EDP_ORGANISATION}). To set a new password, click the button below.</p>
        <table role="presentation" align="center" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto 18px"><tr>
          <td align="center" bgcolor="${P.maroon}" style="background:${P.maroon};border-radius:8px">
            <!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${href}" style="height:46px;v-text-anchor:middle;width:210px" arcsize="17%" stroke="f" fillcolor="${P.maroon}"><w:anchorlock/><center style="color:#ffffff;font-family:${SANS};font-size:15px;font-weight:bold">Reset password</center></v:roundrect><![endif]-->
            <!--[if !mso]><!--><a href="${href}" target="_blank" rel="noopener" style="display:inline-block;padding:13px 32px;font-family:${SANS};font-size:15px;font-weight:bold;line-height:20px;color:#ffffff;text-decoration:none;border-radius:8px;border:1px solid ${P.maroon};background:${P.maroon}">Reset password</a><!--<![endif]-->
          </td>
        </tr></table>
        <p style="margin:0 0 18px">This link is valid for <b style="color:${P.maroon}">${minutes} minutes</b> and can be used once.</p>
      </td></tr>`,
    opts.logoCid,
  );
  return { subject: `Reset your password – ${EDP_PROGRAM_NAME}`, text, html };
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
  build: (opts: { logoCid?: string }) => { subject: string; text: string; html: string },
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
    await transport.sendMail({
      from: smtp.from ?? smtp.user,
      to,
      ...build(logo ? { logoCid: EMAIL_LOGO.cid } : {}),
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
