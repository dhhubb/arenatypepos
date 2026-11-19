/**
 * ============================================================================
 * MODULE: utils/auth.ts — Credential Hashing & Session Integrity
 * ----------------------------------------------------------------------------
 * Previously the app stored passwords in clear text ("admin123") and treated a
 * localStorage object as proof of identity, so anyone could open DevTools,
 * change `userType` to ADMIN and be granted every privileged screen.
 *
 * This module replaces that with:
 *   - PBKDF2-SHA256 password hashing (WebCrypto, per-user random salt).
 *   - Constant-time hash comparison.
 *   - HMAC-signed session tokens carrying the user id and issue time.
 *   - resolveSession(): re-derives the role from the authoritative user table
 *     and rejects any session whose signature or role no longer matches.
 *
 * IMPORTANT LIMITATION: this is a browser-side control. A determined attacker
 * controls the whole client and can always call UI functions directly. The real
 * security boundary is the SQL backend (see /server), which re-checks the role
 * of every write request against its own user table.
 * ============================================================================
 */
import type { User, UserType } from '../types';

const PBKDF2_ITERATIONS = 120_000;
const SALT_BYTES = 16;
const HASH_BITS = 256;

/** Prefix that marks a stored credential as a modern PBKDF2 hash. */
const HASH_PREFIX = 'pbkdf2-sha256';

const encoder = new TextEncoder();

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
}

function randomHex(bytes: number): string {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  return Array.from(buffer).map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Derives the PBKDF2 digest for a password/salt pair. */
async function derive(password: string, saltHex: string, iterations: number): Promise<string> {
  const salt = new Uint8Array(saltHex.match(/.{2}/g)!.map(pair => parseInt(pair, 16)));
  const keyMaterial = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    keyMaterial,
    HASH_BITS
  );
  return toHex(bits);
}

/** Produces a storable `pbkdf2-sha256$iterations$salt$hash` credential. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomHex(SALT_BYTES);
  const digest = await derive(password, salt, PBKDF2_ITERATIONS);
  return `${HASH_PREFIX}$${PBKDF2_ITERATIONS}$${salt}$${digest}`;
}

/** True when a stored value is a modern PBKDF2 hash rather than legacy plain text. */
export function isHashedCredential(stored: string): boolean {
  return typeof stored === 'string' && stored.startsWith(`${HASH_PREFIX}$`);
}

/** Constant-time string comparison to avoid timing side channels. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Verifies a candidate password against a stored PBKDF2 credential. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (!isHashedCredential(stored)) return false;
  const [, iterationsRaw, salt, expected] = stored.split('$');
  const iterations = Number(iterationsRaw);
  if (!iterations || !salt || !expected) return false;
  const actual = await derive(password, salt, iterations);
  return safeEqual(actual, expected);
}

/**
 * Upgrades a legacy plain-text credential in place. Returns the updated user
 * record when a migration happened, otherwise null.
 */
export async function upgradeLegacyCredential(user: User, plainPassword: string): Promise<User | null> {
  if (isHashedCredential(user.passwordHash)) return null;
  if (user.passwordHash !== plainPassword) return null;
  return { ...user, passwordHash: await hashPassword(plainPassword) };
}

// ---------------------------------------------------------------------------
// Session tokens
// ---------------------------------------------------------------------------

/**
 * Session signing key. Overridable via VITE_SESSION_SECRET so a deployment can
 * rotate it. A bundled default is unavoidable for an offline-first client and
 * is documented as such in the README.
 */
const SESSION_SECRET = ((): string => {
  const env = (import.meta as unknown as { env?: Record<string, string> }).env ?? {};
  return env.VITE_SESSION_SECRET || 'afritecx-badboy-local-session-v1';
})();

const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

export interface SessionPayload {
  userId: string;
  username: string;
  userType: UserType;
  issuedAt: number;
}

/** Signed session as persisted in localStorage. */
export interface SignedSession extends SessionPayload {
  signature: string;
}

async function signPayload(payload: SessionPayload): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(SESSION_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const data = `${payload.userId}|${payload.username}|${payload.userType}|${payload.issuedAt}`;
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(data));
  return toHex(signature);
}

/** Issues a signed session for an authenticated user. */
export async function createSession(user: User): Promise<SignedSession> {
  const payload: SessionPayload = {
    userId: user.id,
    username: user.username,
    userType: user.userType,
    issuedAt: Date.now()
  };
  return { ...payload, signature: await signPayload(payload) };
}

/**
 * Validates a persisted session against the authoritative user table.
 * Returns the trusted user record, or null when the session is forged, stale,
 * revoked (user disabled/deleted), or its role has been altered on disk.
 */
export async function resolveSession(raw: string | null, users: User[]): Promise<User | null> {
  if (!raw) return null;
  let parsed: SignedSession;
  try {
    parsed = JSON.parse(raw) as SignedSession;
  } catch {
    return null;
  }
  if (!parsed?.userId || !parsed?.signature || !Number.isFinite(parsed.issuedAt)) return null;
  if (Date.now() - parsed.issuedAt > SESSION_TTL_MS) return null;

  const expected = await signPayload({
    userId: parsed.userId,
    username: parsed.username,
    userType: parsed.userType,
    issuedAt: parsed.issuedAt
  });
  if (!safeEqual(expected, parsed.signature)) return null;

  const user = users.find(u => u.id === parsed.userId);
  if (!user || !user.isActive) return null;
  // The role is taken from the user table, never from the token.
  if (user.userType !== parsed.userType) return null;
  return user;
}

// ---------------------------------------------------------------------------
// Authorisation helpers
// ---------------------------------------------------------------------------

/** Roles allowed to mutate business records. AUDIT is strictly read-only. */
export function canMutate(user: User | null): boolean {
  return !!user && user.userType !== 'AUDIT';
}

/** Only administrators may manage users, licences, imports and resets. */
export function isAdministrator(user: User | null): boolean {
  return !!user && user.userType === 'ADMIN';
}

/** Modules each role may open. */
export const ROLE_MODULES: Record<UserType, string[]> = {
  ADMIN: ['dashboard', 'pos', 'inventory', 'crm', 'accounting', 'payroll', 'cashup', 'ai', 'settings'],
  GENERAL: ['dashboard', 'pos', 'inventory', 'crm', 'accounting', 'payroll', 'cashup', 'ai', 'settings'],
  CASHIER: ['pos', 'cashup'],
  AUDIT: ['dashboard', 'inventory', 'crm', 'accounting', 'payroll', 'cashup', 'ai']
};

/** Tabs a session may open. Mirrors the App shell navigation keys. */
export type AppTab = 'dashboard' | 'pos' | 'inventory' | 'crm' | 'accounting' | 'payroll' | 'cashup' | 'ai' | 'settings';

/** Returns the first tab a role is allowed to see. */
export function defaultTabForRole(role: UserType): AppTab {
  return role === 'CASHIER' ? 'pos' : 'dashboard';
}
