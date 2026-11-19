/**
 * ============================================================================
 * server/password.mjs — Password hashing
 * ----------------------------------------------------------------------------
 * PBKDF2-SHA256, shared by the HTTP server and the test-data seeder so both
 * write credentials in exactly the same format.
 * ============================================================================
 */
import crypto from 'node:crypto';

const PBKDF2_ITERATIONS = 120_000;
const KEY_LENGTH = 32;

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const digest = crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, KEY_LENGTH, 'sha256');
  return `pbkdf2-sha256$${PBKDF2_ITERATIONS}$${salt.toString('hex')}$${digest.toString('hex')}`;
}

export function verifyPassword(password, stored) {
  if (typeof stored !== 'string' || !stored.startsWith('pbkdf2-sha256$')) return false;
  const [, iterationsRaw, salt, expected] = stored.split('$');
  const iterations = Number(iterationsRaw);
  if (!iterations || !salt || !expected) return false;
  const actual = crypto.pbkdf2Sync(password, Buffer.from(salt, 'hex'), iterations, KEY_LENGTH, 'sha256').toString('hex');
  const a = Buffer.from(actual, 'hex');
  const b = Buffer.from(expected, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
