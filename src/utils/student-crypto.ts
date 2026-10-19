import crypto from 'crypto';
import { env } from '../config/env.config';

/*
 * Protection of the Aadhaar number (SEC-004): encrypted with AES-256-GCM, matched through a keyed
 * blind index (HMAC-SHA256), displayed only as the last four digits. The plaintext is never stored or logged.
 */
const dataKey = () => Buffer.from(env.STUDENT_DATA_KEY, 'base64');
const indexKey = () => Buffer.from(env.STUDENT_INDEX_KEY, 'base64');

/* iv(12) | tag(16) | ciphertext */
export function encryptAadhaar(digits: string): Buffer {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', dataKey(), iv);
  const ct = Buffer.concat([cipher.update(digits, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]);
}

export function decryptAadhaar(blob: Buffer): string {
  const decipher = crypto.createDecipheriv('aes-256-gcm', dataKey(), blob.subarray(0, 12));
  decipher.setAuthTag(blob.subarray(12, 28));
  return Buffer.concat([decipher.update(blob.subarray(28)), decipher.final()]).toString('utf8');
}

export const aadhaarBlindIndex = (digits: string): string => crypto.createHmac('sha256', indexKey()).update(digits).digest('hex');

export const maskAadhaar = (last4: string | null): string | null => (last4 ? `XXXX-XXXX-${last4}` : null);
export const maskMobile = (mobile: string | null): string | null => (mobile ? `+91XXXXXX${mobile.slice(-4)}` : null);
export function maskEmail(email: string | null): string | null {
  if (!email) return null;
  const [user, domain] = email.split('@');
  return `${user.slice(0, 2)}${'*'.repeat(Math.max(1, user.length - 2))}@${domain}`;
}

/* Verhoeff checksum, used by UIDAI for Aadhaar numbers. */
const D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 2, 3, 4, 0, 6, 7, 8, 9, 5], [2, 3, 4, 0, 1, 7, 8, 9, 5, 6], [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8], [5, 9, 8, 7, 6, 0, 4, 3, 2, 1], [6, 5, 9, 8, 7, 1, 0, 4, 3, 2], [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4], [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const PERM = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 5, 7, 6, 2, 8, 3, 0, 9, 4], [5, 8, 0, 3, 7, 9, 6, 1, 4, 2], [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0], [4, 2, 8, 6, 5, 7, 3, 9, 0, 1], [2, 7, 9, 3, 8, 0, 6, 4, 1, 5], [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];
const INV = [0, 4, 3, 2, 1, 5, 6, 7, 8, 9];

export function verhoeffValid(num: string): boolean {
  let c = 0;
  const digits = num.split('').reverse().map(Number);
  for (let i = 0; i < digits.length; i++) c = D[c][PERM[i % 8][digits[i]]];
  return c === 0;
}

/* Appends the Verhoeff check digit (used by tests and the template generator for synthetic values). */
export function withVerhoeffDigit(num: string): string {
  let c = 0;
  const digits = num.split('').reverse().map(Number);
  for (let i = 0; i < digits.length; i++) c = D[c][PERM[(i + 1) % 8][digits[i]]];
  return num + INV[c];
}
