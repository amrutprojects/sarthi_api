import { HTTP_STATUS } from '../../../constants/api-response.constants';
import { appConfig } from '../../../config/app.config';
import { env } from '../../../config/env.config';
import { logger } from '../../../observability/logger';
import { AppError } from '../../../shared/errors/app-error';
import { EDP_ERROR_CODES, EDP_MESSAGES } from './edp.constants';

const TIMEOUT_MS = 10_000;

const unavailable = () => new AppError(HTTP_STATUS.SERVICE_UNAVAILABLE, EDP_MESSAGES.SMS_UNAVAILABLE, EDP_ERROR_CODES.SMS_UNAVAILABLE);
const masked = (mobile: string) => `XXXXXX${mobile.slice(-4)}`;

/* The template with {otp}, {seconds} and {minutes} (whole minutes, at least 1) filled in. Exported for tests. */
export const otpSmsText = (otp: string, ttlSeconds: number) =>
  appConfig.edp.sms.otpMessage
    .replace(/\{otp\}/g, otp)
    .replace(/\{seconds\}/g, String(ttlSeconds))
    .replace(/\{minutes\}/g, String(Math.max(1, Math.round(ttlSeconds / 60))));

/*
 * Whether the gateway accepted the message. Gateways of this family answer 200 even on failure, with either JSON
 * ({"type":"success"|"error", ...}) or a plain-text reason, so the body decides. Exported for tests.
 */
export function smsAccepted(status: number, body: string): boolean {
  if (status < 200 || status >= 300) return false;
  const text = body.trim();
  if (!text) return false;
  try {
    const json = JSON.parse(text) as { type?: unknown; status?: unknown };
    const verdict = String(json.type ?? json.status ?? '').toLowerCase();
    if (verdict) return verdict === 'success' || verdict === 'ok';
  } catch {
    /* not JSON: judged on the text below */
  }
  return !/error|fail|invalid|insufficient|denied|not\s+allowed|blocked|reject/i.test(text);
}

/*
 * Sends the one-time code to a 10-digit Indian mobile number through the SMS gateway (SMS_*). Without SMS_AUTH_KEY,
 * development and test runs write the code to the API log so the flow can be tried locally; any other environment
 * refuses (503). The request URL carries the gateway key, so it is never logged.
 */
async function sendOtp(mobile: string, otp: string, ttlSeconds: number): Promise<void> {
  const sms = appConfig.edp.sms;
  if (!sms.authKey || !sms.sender || !sms.templateId) {
    if (env.NODE_ENV !== 'development' && env.NODE_ENV !== 'test') {
      logger.error('EDP OTP SMS NOT sent: SMS_AUTH_KEY, SMS_SENDER and SMS_DLT_TEMPLATE_ID must all be set');
      throw unavailable();
    }
    logger.warn({ mobile: masked(mobile), otp }, 'EDP OTP SMS NOT sent: SMS gateway is not configured (development only, logged instead)');
    return;
  }
  const url = new URL(sms.url);
  url.search = new URLSearchParams({
    authkey: sms.authKey,
    mobiles: mobile,
    message: otpSmsText(otp, ttlSeconds),
    sender: sms.sender,
    route: sms.route,
    country: sms.country,
    DLT_TE_ID: sms.templateId,
    response: 'json',
  }).toString();
  try {
    const res = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(TIMEOUT_MS) });
    const body = await res.text();
    if (!smsAccepted(res.status, body)) {
      logger.error({ mobile: masked(mobile), status: res.status, response: body.slice(0, 300) }, 'EDP OTP SMS was rejected by the gateway');
      throw unavailable();
    }
    /* Accepted is not delivered: a text that does not match the DLT template is dropped later by the operator. */
    logger.info({ mobile: masked(mobile), status: res.status, response: body.slice(0, 300) }, 'EDP OTP SMS accepted by the gateway');
  } catch (err) {
    if (err instanceof AppError) throw err;
    logger.error({ mobile: masked(mobile), err: err instanceof Error ? err.message : String(err) }, 'EDP OTP SMS could not be sent');
    throw unavailable();
  }
}

export const edpSms = { sendOtp };
