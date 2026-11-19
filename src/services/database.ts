/**
 * ============================================================================
 * MODULE: services/database.ts — Database Connection Layer
 * ----------------------------------------------------------------------------
 * A provider abstraction that lets Afritecx Badboy run in two modes:
 *
 *   1. LOCAL (default)  — persists to the browser's localStorage so the app
 *      works fully offline with zero infrastructure.
 *
 *   2. REMOTE (real SQL) — when VITE_API_BASE_URL is set, the app talks to the
 *      SQL backend in /server. Records are written individually through
 *      /collections/:name rather than by replacing a global blob, so two tills
 *      working at once can no longer overwrite each other's sales. Every
 *      response is also cached in localStorage so the POS keeps working while
 *      the network is down.
 *
 * REST contract (see server/index.mjs):
 *   POST   {BASE}/auth/login                  -> { token, user }
 *   POST   {BASE}/auth/logout
 *   GET    {BASE}/auth/me                     -> { user }
 *   GET    {BASE}/snapshot                    -> { data: { ... } }
 *   GET    {BASE}/collections/:name           -> { data: [...] }
 *   POST   {BASE}/collections/:name           -> { ok, inserted }
 *   PATCH  {BASE}/collections/:name/:id       -> { ok, changed }
 *   DELETE {BASE}/collections/:name/:id       -> { ok, removed }
 *   PUT    {BASE}/singletons/:key             -> { ok }
 *   GET    {BASE}/reports/trial-balance
 *   GET    {BASE}/reports/ar-aging
 *
 * The bearer token is held in memory (never localStorage) so an XSS payload
 * cannot lift a long-lived credential out of persistent storage.
 * ============================================================================
 */

export type DatabaseMode = 'local' | 'remote';
export type ConnectionStatus = 'local' | 'connecting' | 'connected' | 'error';

export interface DatabaseSnapshot {
  [collection: string]: unknown;
}

/** Collections that are addressable through /collections/:name. */
export type CollectionName =
  | 'products'
  | 'customers'
  | 'suppliers'
  | 'sales'
  | 'purchase_orders'
  | 'journal_entries'
  | 'accounts'
  | 'employees'
  | 'payruns'
  | 'timesheets'
  | 'tax_remittances'
  | 'daily_cashups';

/** Singleton documents addressable through /singletons/:key. */
export type SingletonName = 'profile' | 'software_license' | 'admin_control';

const env = ((import.meta as unknown as { env?: Record<string, string> }).env) ?? {};

export const API_BASE_URL: string = (env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '');
export const DATABASE_MODE: DatabaseMode = API_BASE_URL ? 'remote' : 'local';
export const LOCAL_KEY_PREFIX = 'pos_accounting_v2_';

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_RETRIES = 2;

/**
 * Bearer token cache.
 *
 * sessionStorage is the right home for it: a reload keeps the till signed in
 * (a cashier must not lose the sale in progress), while closing the tab ends
 * the session. localStorage would keep a bearer token on disk indefinitely,
 * which is too much exposure for a shared shop terminal.
 */
const TOKEN_STORAGE_KEY = 'pos_accounting_v2_auth_token';

function readStoredToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

let authToken: string | null = readStoredToken();

export function setAuthToken(token: string | null): void {
  authToken = token;
  try {
    if (token) sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
    else sessionStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    // Private-mode browsers can reject storage; the in-memory token still works.
  }
}

export function hasAuthToken(): boolean {
  return !!authToken;
}

/** True when a server session exists and can be used for writes. */
export function isAuthenticatedWithServer(): boolean {
  return !!authToken;
}

function buildHeaders(extra?: HeadersInit): HeadersInit {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (authToken) headers.Authorization = `Bearer ${authToken}`;
  return { ...headers, ...(extra ?? {}) };
}

/** Error carrying the HTTP status so callers can distinguish 401 from 500. */
export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/**
 * Wraps fetch with a timeout, bounded retries for transient failures, and
 * consistent error surfacing. 4xx responses are never retried.
 */
async function request<T>(path: string, init?: RequestInit, attempt = 0): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers: buildHeaders(init?.headers),
      signal: controller.signal
    });

    if (!response.ok) {
      let message = `Server responded ${response.status} ${response.statusText}`;
      try {
        const payload = await response.json();
        if (payload?.error) message = payload.error;
      } catch {
        // Non-JSON error body; keep the status text.
      }
      throw new ApiError(message, response.status);
    }
    if (response.status === 204) return {} as T;
    return (await response.json()) as T;
  } catch (error) {
    const isAbort = error instanceof DOMException && error.name === 'AbortError';
    const isServerError = error instanceof ApiError && error.status >= 500;
    const isNetwork = !(error instanceof ApiError);
    if (attempt < MAX_RETRIES && (isAbort || isServerError || isNetwork)) {
      await new Promise(resolve => setTimeout(resolve, 400 * (attempt + 1)));
      return request<T>(path, init, attempt + 1);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export interface PersistResult {
  ok: boolean;
  mode: DatabaseMode;
  error?: string;
  /** True when the server rejected the request because no valid session exists. */
  unauthenticated?: boolean;
}

export const database = {
  mode: DATABASE_MODE,
  endpoint: API_BASE_URL,
  isRemote: DATABASE_MODE === 'remote',

  /** Lightweight connectivity check against the configured server. */
  async healthCheck(): Promise<boolean> {
    if (!this.isRemote) return false;
    try {
      await request<{ ok: boolean }>('/health');
      return true;
    } catch (error) {
      console.error('[database] Health check failed:', error);
      return false;
    }
  },

  // -------------------------------------------------------------------------
  // Authentication
  // -------------------------------------------------------------------------
  /** Exchanges credentials for a bearer token. Throws ApiError on rejection. */
  async login(username: string, password: string): Promise<{ token: string; user: unknown }> {
    if (!this.isRemote) throw new Error('Remote database is not configured');
    const result = await request<{ token: string; user: unknown }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password })
    });
    setAuthToken(result.token);
    return result;
  },

  async logout(): Promise<void> {
    if (!this.isRemote || !authToken) {
      setAuthToken(null);
      return;
    }
    try {
      await request('/auth/logout', { method: 'POST' });
    } catch {
      // A failed logout must still clear the local token.
    } finally {
      setAuthToken(null);
    }
  },

  async currentUser(): Promise<unknown | null> {
    if (!this.isRemote || !authToken) return null;
    try {
      const result = await request<{ user: unknown }>('/auth/me');
      return result.user;
    } catch {
      return null;
    }
  },

  // -------------------------------------------------------------------------
  // Bulk hydration
  // -------------------------------------------------------------------------
  /**
   * Loads the full business snapshot. Returns null when running locally or
   * when the server has no data yet, so the caller can fall back to local cache.
   */
  async loadSnapshot(): Promise<DatabaseSnapshot | null> {
    if (!this.isRemote) return null;
    try {
      const payload = await request<{ data?: DatabaseSnapshot }>('/snapshot');
      if (!payload?.data || Object.keys(payload.data).length === 0) return null;
      this.writeLocalCache(payload.data);
      return payload.data;
    } catch (error) {
      console.error('[database] Remote load failed; using local cache.', error);
      return null;
    }
  },

  // -------------------------------------------------------------------------
  // Per-record writes
  // -------------------------------------------------------------------------
  /** Inserts one or many records into a collection. */
  async insert(collection: CollectionName, record: unknown | unknown[]): Promise<PersistResult> {
    if (!this.isRemote) return { ok: true, mode: 'local' };
    try {
      await request(`/collections/${collection}`, {
        method: 'POST',
        body: JSON.stringify({ data: record })
      });
      return { ok: true, mode: 'remote' };
    } catch (error) {
      return this.failure(error);
    }
  },

  /** Patches a single record by its primary key. */
  async update(collection: CollectionName, id: string, patch: Record<string, unknown>): Promise<PersistResult> {
    if (!this.isRemote) return { ok: true, mode: 'local' };
    try {
      await request(`/collections/${collection}/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ data: patch })
      });
      return { ok: true, mode: 'remote' };
    } catch (error) {
      return this.failure(error);
    }
  },

  /** Deletes a single record by its primary key. */
  async remove(collection: CollectionName, id: string): Promise<PersistResult> {
    if (!this.isRemote) return { ok: true, mode: 'local' };
    try {
      await request(`/collections/${collection}/${encodeURIComponent(id)}`, { method: 'DELETE' });
      return { ok: true, mode: 'remote' };
    } catch (error) {
      return this.failure(error);
    }
  },

  /** Replaces a singleton document (profile, licence, admin control). */
  async saveSingleton(key: SingletonName, value: unknown): Promise<PersistResult> {
    if (!this.isRemote) return { ok: true, mode: 'local' };
    try {
      await request(`/singletons/${key}`, { method: 'PUT', body: JSON.stringify({ data: value }) });
      return { ok: true, mode: 'remote' };
    } catch (error) {
      return this.failure(error);
    }
  },

  /** Server-side trial balance (authoritative, computed with SQL). */
  async trialBalance(): Promise<unknown | null> {
    if (!this.isRemote) return null;
    try {
      return await request('/reports/trial-balance');
    } catch {
      return null;
    }
  },

  /** Server-side A/R ageing computed from real sale dates. */
  async arAging(): Promise<unknown | null> {
    if (!this.isRemote) return null;
    try {
      return await request('/reports/ar-aging');
    } catch {
      return null;
    }
  },

  /** Clears all business records on the server (ADMIN only). */
  async reset(): Promise<PersistResult> {
    if (!this.isRemote) return { ok: true, mode: 'local' };
    try {
      await request('/admin/reset', { method: 'POST' });
      return { ok: true, mode: 'remote' };
    } catch (error) {
      return this.failure(error);
    }
  },

  failure(error: unknown): PersistResult {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[database] Write failed:', message);
    const unauthenticated = error instanceof ApiError && error.status === 401;
    return { ok: false, mode: 'remote', error: message, unauthenticated };
  },

  // -------------------------------------------------------------------------
  // Offline cache
  // -------------------------------------------------------------------------
  /** Reads cached collections straight from localStorage. */
  readLocalCache(): DatabaseSnapshot {
    const snapshot: DatabaseSnapshot = {};
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key && key.startsWith(LOCAL_KEY_PREFIX)) {
        try {
          snapshot[key.slice(LOCAL_KEY_PREFIX.length)] = JSON.parse(localStorage.getItem(key) ?? 'null');
        } catch {
          // Ignore malformed entries rather than breaking the whole app.
        }
      }
    }
    return snapshot;
  },

  /** Writes a full snapshot into localStorage (offline cache). */
  writeLocalCache(snapshot: DatabaseSnapshot): void {
    Object.entries(snapshot).forEach(([key, value]) => {
      if (key === 'active_session') return;
      try {
        localStorage.setItem(LOCAL_KEY_PREFIX + key, JSON.stringify(value));
      } catch {
        // Storage may be full or blocked; ignore and continue.
      }
    });
  }
};
