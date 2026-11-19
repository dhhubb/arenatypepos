/**
 * ============================================================================
 * Afritecx Badboy — SQL Database Server
 * ----------------------------------------------------------------------------
 * Replaces the previous "PUT /snapshot overwrites everything" endpoint with a
 * real relational API over SQLite (node:sqlite, zero npm dependencies).
 *
 *   npm run build && npm start   # production: API + built frontend on :8787
 *   npm run db                   # API only, for use with the Vite dev server
 *
 * Routes are served both bare (/health) and behind the /api prefix (/api/health)
 * so the same build works single-origin or behind a reverse proxy.
 *
 * Security model
 *   - Every request must present a bearer token issued by POST /auth/login.
 *   - Passwords are verified with PBKDF2-SHA256 and never stored or returned in
 *     clear text.
 *   - The caller's role is read from the database on every request; a client
 *     cannot promote itself by editing a payload.
 *   - AUDIT users are rejected on all mutating verbs; ADMIN is required for
 *     user management and destructive operations.
 *   - Collection and column names come from a fixed allow-list, so request
 *     bodies can never reach the SQL parser as identifiers.
 *
 * Endpoints
 *   GET    /health                      public liveness probe
 *   POST   /auth/login                  { username, password } -> { token, user }
 *   POST   /auth/logout                 invalidate current token
 *   GET    /auth/me                     current user
 *   GET    /snapshot                    full dataset for hydration
 *   GET    /collections/:name           list records
 *   POST   /collections/:name           create record(s)
 *   PATCH  /collections/:name/:id       update one record
 *   DELETE /collections/:name/:id       delete one record
 *   GET    /reports/trial-balance       SQL-aggregated trial balance
 *   GET    /reports/ar-aging            true ageing from sale dates
 *   POST   /admin/reset                 wipe business data (ADMIN only)
 * ============================================================================
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { COLLECTIONS, SINGLETONS, openDatabase, transaction, assertLedgerBalanced, toCents, fromCents } from './schema.mjs';
import { hashPassword, verifyPassword } from './password.mjs';
import { DEFAULT_ACCOUNTS, SEED_USERS, DEFAULT_PROFILE, DEFAULT_ADMIN_CONTROL, defaultLicense } from './defaults.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DB_DIR || path.join(__dirname, 'data');
const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '127.0.0.1';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const MAX_BODY_BYTES = 8 * 1024 * 1024;
/**
 * Built frontend. When present the server hosts the SPA and the API on one
 * origin, which removes CORS from the deployment entirely. Set
 * SERVE_STATIC=0 to run as a pure API behind a separate web server.
 */
const STATIC_DIR = path.join(__dirname, '..', 'dist');
const SERVE_STATIC = process.env.SERVE_STATIC !== '0' && fs.existsSync(path.join(STATIC_DIR, 'index.html'));

/**
 * First path segment of every API route. The SPA fallback skips these so an
 * unauthenticated request still gets a 401 JSON response rather than the app
 * shell, which would otherwise look like a successful API call.
 */
const API_ROOTS = new Set(['health', 'auth', 'snapshot', 'collections', 'reports', 'admin']);

const db = openDatabase(DATA_DIR);

// ---------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------
function seed() {
  if (prep('SELECT COUNT(*) AS n FROM users').get().n === 0) {
    const insert = prep(
      'INSERT INTO users (id, username, password_hash, user_type, full_name, is_active, created_at) VALUES (?,?,?,?,?,1,?)'
    );
    const now = new Date().toISOString();
    for (const [id, username, fullName, role, password] of SEED_USERS) {
      insert.run(id, username, hashPassword(password), role, fullName, now);
    }
  }

  if (prep('SELECT COUNT(*) AS n FROM accounts').get().n === 0) {
    const insert = prep('INSERT INTO accounts (code, name, type, description, is_system) VALUES (?,?,?,?,1)');
    for (const [code, name, type, description] of DEFAULT_ACCOUNTS) insert.run(code, name, type, description);
  }

  prep('INSERT OR IGNORE INTO business_profile (id, data) VALUES (1, ?)').run(JSON.stringify(DEFAULT_PROFILE));
  prep('INSERT OR IGNORE INTO software_license (id, data) VALUES (1, ?)').run(JSON.stringify(defaultLicense()));
  prep('INSERT OR IGNORE INTO admin_control (id, data) VALUES (1, ?)').run(JSON.stringify(DEFAULT_ADMIN_CONTROL));
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------
const SECURITY_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer'
};

/**
 * CORS is restricted to an explicit allow-list. The previous wildcard let any
 * website drive the API on a user's behalf.
 */
function corsHeaders(req) {
  const allowed = (process.env.CORS_ORIGINS || '')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);
  const origin = req.headers.origin;
  if (origin && allowed.includes(origin)) {
    return {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
      'Access-Control-Max-Age': '600',
      Vary: 'Origin'
    };
  }
  return {};
}

/**
 * Serves the built single-page app.
 *
 * The build is a single inlined index.html, so there is no asset directory to
 * walk; every non-API GET resolves to it and the client router takes over.
 * The resolved path is checked against STATIC_DIR so a crafted URL such as
 * `/../../etc/passwd` cannot escape the web root.
 */
const STATIC_CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8'
};

function serveStatic(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;

  const indexFile = path.join(STATIC_DIR, 'index.html');
  let target = path.join(STATIC_DIR, pathname);
  if (!target.startsWith(STATIC_DIR + path.sep) && target !== indexFile) return false;

  if (!fs.existsSync(target) || fs.statSync(target).isDirectory()) target = indexFile;

  const body = fs.readFileSync(target);
  const type = STATIC_CONTENT_TYPES[path.extname(target).toLowerCase()] || 'application/octet-stream';
  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': body.length,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    // The app is a single HTML document with inlined script and style, so a
    // strict CSP has to allow inline code. Everything else stays locked down.
    'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; " +
      "style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; " +
      "connect-src 'self'; font-src 'self' data:; frame-ancestors 'none'; base-uri 'self'",
    'Cache-Control': 'no-cache'
  });
  res.end(req.method === 'HEAD' ? undefined : body);
  return true;
}

function send(req, res, status, body) {
  res.writeHead(status, { ...SECURITY_HEADERS, ...corsHeaders(req) });
  res.end(JSON.stringify(body));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Payload too large'));
        req.destroy();
        return;
      }
      raw += chunk;
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function log(actor, action, detail) {
  try {
    prep('INSERT INTO audit_log (at, actor, action, detail) VALUES (?,?,?,?)')
      .run(new Date().toISOString(), actor ?? null, action, detail ?? null);
  } catch {
    // Auditing must never break the request path.
  }
}

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------
function createToken(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  prep('INSERT INTO sessions (token, user_id, issued_at, expires_at) VALUES (?,?,?,?)')
    .run(token, userId, now, now + SESSION_TTL_MS);
  return token;
}

/** Resolves the bearer token to a live user row, or null. */
function authenticate(req) {
  const match = /^Bearer\s+([a-f0-9]{64})$/i.exec(req.headers.authorization || '');
  if (!match) return null;
  const token = match[1];
  const session = prep('SELECT user_id, expires_at FROM sessions WHERE token = ?').get(token);
  if (!session) return null;
  if (session.expires_at < Date.now()) {
    prep('DELETE FROM sessions WHERE token = ?').run(token);
    return null;
  }
  return prep('SELECT * FROM users WHERE id = ? AND is_active = 1').get(session.user_id) ?? null;
}

/** Role gate: AUDIT may never write; adminOnly routes need ADMIN. */
function authorize(user, { write = false, adminOnly = false } = {}) {
  if (!user) return 'Authentication required';
  if (adminOnly && user.user_type !== 'ADMIN') return 'Administrator privileges required';
  if (write && user.user_type === 'AUDIT') return 'Read-only audit sessions cannot modify records';
  return null;
}

// ---------------------------------------------------------------------------
// Row mapping (API shape <-> SQL columns)
// ---------------------------------------------------------------------------
function toSnake(name) {
  return name.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
}

function safeParse(text, fallback) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function rowToRecord(name, row) {
  const spec = COLLECTIONS[name];
  const record = {};
  for (const column of spec.columns) {
    const value = row[toSnake(column)];
    if (spec.json?.includes(column)) {
      record[column] = value ? safeParse(value, []) : [];
    } else if (spec.numeric?.includes(column)) {
      record[column] = value === null || value === undefined ? 0 : fromCents(value);
    } else if (spec.boolean?.includes(column)) {
      record[column] = !!value;
    } else if (spec.integer?.includes(column)) {
      record[column] = Number(value ?? 0);
    } else {
      record[column] = value ?? undefined;
    }
  }
  return record;
}

/** Coerces an API value into the storage representation for a column. */
function toStorage(name, column, value) {
  const spec = COLLECTIONS[name];
  if (spec.json?.includes(column)) return JSON.stringify(value ?? []);
  if (spec.numeric?.includes(column)) return toCents(value);
  if (spec.boolean?.includes(column)) return value ? 1 : 0;
  if (spec.integer?.includes(column)) return Math.trunc(Number(value) || 0);
  return value === undefined || value === null ? null : String(value);
}

function primaryKeyOf(name) {
  return COLLECTIONS[name].primaryKey || 'id';
}

// ---------------------------------------------------------------------------
// Collection read/write
// ---------------------------------------------------------------------------
/**
 * Prepared-statement cache.
 *
 * `node:sqlite` compiles a statement on every `prep()` call. The app
 * re-reads the whole snapshot on each client load, which recompiled ~30
 * identical statements every time. Statements are immutable once prepared,
 * so caching them by SQL text is safe and removes that repeated compile cost.
 */
const statementCache = new Map();

function prep(sql) {
  let statement = statementCache.get(sql);
  if (!statement) {
    statement = db.prepare(sql);
    statementCache.set(sql, statement);
  }
  return statement;
}

function listCollection(name) {
  if (name === 'journal_entries') {
    // One pass over the lines instead of one query per entry: the ledger is
    // the largest table and the snapshot loads it on every client start.
    const entries = prep('SELECT * FROM journal_entries ORDER BY date, id').all();
    const linesByEntry = new Map();
    for (const line of prep('SELECT entry_id, account_code, type, amount FROM journal_lines ORDER BY entry_id, id').all()) {
      let bucket = linesByEntry.get(line.entry_id);
      if (!bucket) linesByEntry.set(line.entry_id, bucket = []);
      bucket.push({
        accountCode: line.account_code,
        type: line.type,
        amount: fromCents(line.amount)
      });
    }
    return entries.map(entry => ({
      id: entry.id,
      date: entry.date,
      description: entry.description,
      reference: entry.reference ?? '',
      createdBy: entry.created_by ?? undefined,
      lines: linesByEntry.get(entry.id) ?? []
    }));
  }

  const spec = COLLECTIONS[name];
  const records = prep(`SELECT * FROM ${spec.table}`).all().map(row => rowToRecord(name, row));

  if (name === 'accounts') {
    // Balances are derived from the ledger, never trusted from the client.
    const nets = new Map(
      prep(`SELECT account_code AS code,
                         SUM(CASE WHEN type='DEBIT' THEN amount ELSE -amount END) AS net
                  FROM journal_lines GROUP BY account_code`).all()
        .map(row => [row.code, row.net])
    );
    for (const record of records) {
      const net = nets.get(record.code) ?? 0;
      const debitNormal = record.type === 'ASSET' || record.type === 'EXPENSE';
      record.balance = fromCents(debitNormal ? net : -net);
    }
  }
  return records;
}

function insertRecords(name, payload) {
  const records = Array.isArray(payload) ? payload : [payload];
  const spec = COLLECTIONS[name];

  if (name === 'journal_entries') {
    const headerStmt = prep(
      'INSERT INTO journal_entries (id, date, description, reference, created_by, created_at) VALUES (?,?,?,?,?,?)'
    );
    const lineStmt = prep(
      'INSERT INTO journal_lines (entry_id, account_code, type, amount) VALUES (?,?,?,?)'
    );
    for (const entry of records) {
      if (!entry?.id || !Array.isArray(entry?.lines)) throw new Error('Malformed journal entry');
      const net = entry.lines.reduce(
        (sum, line) => sum + (line.type === 'DEBIT' ? toCents(line.amount) : -toCents(line.amount)),
        0
      );
      if (net !== 0) throw new Error(`Journal entry ${entry.id} is out of balance by ${fromCents(net)}`);
      headerStmt.run(entry.id, entry.date, entry.description, entry.reference ?? null,
        entry.createdBy ?? null, new Date().toISOString());
      for (const line of entry.lines) {
        lineStmt.run(entry.id, line.accountCode, line.type, toCents(line.amount));
      }
    }
    return records.length;
  }

  const columns = spec.columns.map(toSnake);
  const statement = prep(
    `INSERT INTO ${spec.table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`
  );
  for (const record of records) {
    statement.run(...spec.columns.map(column => toStorage(name, column, record[column])));
    if (name === 'products' && record.id) syncProductStock(name, record.id);
  }
  return records.length;
}

function updateRecord(name, id, patch) {
  const spec = COLLECTIONS[name];
  const columns = spec.columns.filter(column => patch[column] !== undefined);
  if (columns.length === 0) return 0;
  const assignments = columns.map(column => `${toSnake(column)} = ?`).join(', ');
  const values = columns.map(column => toStorage(name, column, patch[column]));
  const changed = prep(`UPDATE ${spec.table} SET ${assignments} WHERE ${toSnake(primaryKeyOf(name))} = ?`)
    .run(...values, id).changes;
  syncProductStock(name, id);
  return changed;
}

/**
 * `stock` is a cached total of `storeroom_stock + fridge_stock`. The client
 * keeps the three in step, but a partial PATCH (or an import) can move only one
 * of them and leave the total stale, which silently breaks stock warnings and
 * the Inventory valuation. Recomputing it here keeps the invariant in the one
 * place every write passes through.
 */
function syncProductStock(name, id) {
  if (name !== 'products') return;
  prep('UPDATE products SET stock = storeroom_stock + fridge_stock WHERE id = ?').run(id);
}

function deleteRecord(name, id) {
  const spec = COLLECTIONS[name];
  return prep(`DELETE FROM ${spec.table} WHERE ${toSnake(primaryKeyOf(name))} = ?`).run(id).changes;
}

// ---------------------------------------------------------------------------
// Reports (SQL aggregation)
// ---------------------------------------------------------------------------
function trialBalance() {
  const rows = prep(`
    SELECT a.code, a.name, a.type,
           COALESCE(SUM(CASE WHEN l.type='DEBIT' THEN l.amount ELSE -l.amount END), 0) AS net
    FROM accounts a
    LEFT JOIN journal_lines l ON l.account_code = a.code
    GROUP BY a.code, a.name, a.type
    ORDER BY a.code
  `).all();

  let totalDebit = 0;
  let totalCredit = 0;
  const out = [];
  for (const row of rows) {
    // `net` is already signed (DEBIT - CREDIT), so the side of the balance is
    // read straight off it. Flipping by account type here would double-negate
    // credit-normal accounts and report a perfectly balanced ledger as broken.
    if (row.net === 0) continue;
    const debit = row.net > 0 ? row.net : 0;
    const credit = row.net < 0 ? -row.net : 0;
    totalDebit += debit;
    totalCredit += credit;
    out.push({ code: row.code, name: row.name, type: row.type, debit: fromCents(debit), credit: fromCents(credit) });
  }
  return {
    rows: out,
    totalDebit: fromCents(totalDebit),
    totalCredit: fromCents(totalCredit),
    isBalanced: totalDebit === totalCredit
  };
}

/** Ageing derived from the real age of each credit sale. */
function arAging() {
  const now = Date.now();
  const sales = prep(`
    SELECT customer_id AS customerId, date, total
    FROM sales
    WHERE payment_method = 'CUSTOMER_CREDIT' AND customer_id IS NOT NULL
  `).all();

  const buckets = new Map();
  for (const sale of sales) {
    const ageDays = Math.max(0, Math.floor((now - new Date(sale.date).getTime()) / 86_400_000));
    const bucket = ageDays <= 30 ? 'current' : ageDays <= 60 ? 'days30' : ageDays <= 90 ? 'days60' : 'days90';
    const entry = buckets.get(sale.customerId) ?? { current: 0, days30: 0, days60: 0, days90: 0 };
    entry[bucket] += sale.total;
    buckets.set(sale.customerId, entry);
  }

  const nameById = new Map(prep('SELECT id, name FROM customers').all().map(c => [c.id, c.name]));
  const rows = [...buckets.entries()].map(([customerId, value]) => ({
    customerId,
    customerName: nameById.get(customerId) ?? customerId,
    current: fromCents(value.current),
    days30: fromCents(value.days30),
    days60: fromCents(value.days60),
    days90: fromCents(value.days90),
    total: fromCents(value.current + value.days30 + value.days60 + value.days90)
  }));

  const sum = key => fromCents(rows.reduce((total, row) => total + toCents(row[key]), 0));
  return {
    rows,
    totals: { current: sum('current'), days30: sum('days30'), days60: sum('days60'), days90: sum('days90'), total: sum('total') }
  };
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------
function publicUser(row) {
  return {
    id: row.id,
    username: row.username,
    userType: row.user_type,
    fullName: row.full_name,
    isActive: !!row.is_active
  };
}

async function handle(req, res) {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  // The frontend is configured with VITE_API_BASE_URL=/api so that the same
  // build works behind a reverse proxy and on a single-origin deployment.
  // Strip the prefix here so the routes below stay unprefixed.
  const isApiRequest = url.pathname === '/api' || url.pathname.startsWith('/api/');
  if (isApiRequest) {
    url.pathname = url.pathname.slice(4) || '/';
  }

  const parts = url.pathname.split('/').filter(Boolean);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders(req));
    return res.end();
  }

  if (url.pathname === '/health') {
    return send(req, res, 200, { ok: true, storage: 'sqlite', engine: 'node:sqlite' });
  }

  // The app shell is public: the browser has to load it before it can present a
  // login form. Only data routes below require a token, and the static handler
  // never reads anything outside dist/.
  //
  // API paths are excluded explicitly. Without this a request to /snapshot (the
  // routes are also served without the /api prefix) would match the SPA
  // fallback and receive index.html instead of JSON.
  const isApiPath = API_ROOTS.has(url.pathname.split('/')[1]);
  if (SERVE_STATIC && !isApiRequest && !isApiPath && serveStatic(req, res, url.pathname)) return;

  // ---- auth ----
  if (url.pathname === '/auth/login' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const username = String(body.username ?? '').trim().toLowerCase();
    const password = String(body.password ?? '');
    if (!username || !password) return send(req, res, 400, { error: 'Username and password are required' });

    const throttleKey = loginThrottleKey(req);
    const waitMs = loginThrottleRemaining(throttleKey);
    if (waitMs > 0) {
      const retryAfter = Math.ceil(waitMs / 1000);
      res.setHeader('Retry-After', String(retryAfter));
      log(username || null, 'login.throttled', null);
      return send(req, res, 429, { error: `Too many failed attempts. Try again in ${Math.ceil(retryAfter / 60)} minute(s).` });
    }

    const row = prep('SELECT * FROM users WHERE lower(username) = ?').get(username);
    // Uniform failure response: never reveal whether the username exists.
    if (!row || !row.is_active || !verifyPassword(password, row.password_hash)) {
      recordLoginFailure(throttleKey);
      log(username || null, 'login.failed', null);
      return send(req, res, 401, { error: 'Invalid credentials' });
    }
    loginAttempts.delete(throttleKey);
    log(row.username, 'login.success', null);
    return send(req, res, 200, { token: createToken(row.id), user: publicUser(row) });
  }

  const user = authenticate(req);

  if (url.pathname === '/auth/me' && req.method === 'GET') {
    if (!user) return send(req, res, 401, { error: 'Authentication required' });
    return send(req, res, 200, { user: publicUser(user) });
  }

  if (url.pathname === '/auth/logout' && req.method === 'POST') {
    const match = /^Bearer\s+([a-f0-9]{64})$/i.exec(req.headers.authorization || '');
    if (match) prep('DELETE FROM sessions WHERE token = ?').run(match[1]);
    return send(req, res, 200, { ok: true });
  }

  if (!user) return send(req, res, 401, { error: 'Authentication required' });

  // ---- snapshot ----
  if (url.pathname === '/snapshot' && req.method === 'GET') {
    const snapshot = { users: prep('SELECT * FROM users').all().map(publicUser) };
    for (const name of Object.keys(COLLECTIONS)) snapshot[name] = listCollection(name);
    for (const [key, spec] of Object.entries(SINGLETONS)) {
      const row = prep(`SELECT data FROM ${spec.table} WHERE id = 1`).get();
      snapshot[key] = row ? safeParse(row.data, null) : null;
    }
    return send(req, res, 200, { data: snapshot });
  }

  // ---- reports ----
  if (url.pathname === '/reports/trial-balance' && req.method === 'GET') {
    return send(req, res, 200, trialBalance());
  }
  if (url.pathname === '/reports/ar-aging' && req.method === 'GET') {
    return send(req, res, 200, arAging());
  }

  // ---- collections ----
  if (parts[0] === 'collections' && parts[1]) {
    const name = parts[1];
    if (!COLLECTIONS[name]) return send(req, res, 404, { error: `Unknown collection: ${name}` });

    const isWrite = req.method === 'POST' || req.method === 'PATCH' || req.method === 'DELETE';
    const denied = authorize(user, { write: isWrite });
    if (denied) return send(req, res, 403, { error: denied });

    try {
      if (req.method === 'GET' && parts.length === 2) {
        return send(req, res, 200, { data: listCollection(name) });
      }
      if (req.method === 'POST' && parts.length === 2) {
        const body = await readJsonBody(req);
        const inserted = transaction(
          db,
          () => insertRecords(name, body.data ?? body),
          // Journal writes are verified as a set before the commit so a
          // multi-line entry can never land half-posted or unbalanced.
          name === 'journal_entries' ? () => assertLedgerBalanced(db) : undefined
        );
        log(user.username, `create:${name}`, String(inserted));
        return send(req, res, 201, { ok: true, inserted });
      }
      if (req.method === 'PATCH' && parts.length === 3) {
        const body = await readJsonBody(req);
        const changed = transaction(db, () => updateRecord(name, parts[2], body.data ?? body));
        log(user.username, `update:${name}`, parts[2]);
        return send(req, res, 200, { ok: true, changed });
      }
      if (req.method === 'DELETE' && parts.length === 3) {
        const removed = transaction(db, () => deleteRecord(name, parts[2]));
        log(user.username, `delete:${name}`, parts[2]);
        return send(req, res, 200, { ok: true, removed });
      }
      return send(req, res, 405, { error: 'Method not allowed' });
    } catch (error) {
      return send(req, res, 400, { error: error.message });
    }
  }

  // ---- singleton documents ----
  if (parts[0] === 'singletons' && parts[1] && SINGLETONS[parts[1]]) {
    const spec = SINGLETONS[parts[1]];
    if (req.method === 'GET') {
      const row = prep(`SELECT data FROM ${spec.table} WHERE id = 1`).get();
      return send(req, res, 200, { data: row ? safeParse(row.data, null) : null });
    }
    if (req.method === 'PUT') {
      const denied = authorize(user, { write: true, adminOnly: parts[1] !== 'profile' });
      if (denied) return send(req, res, 403, { error: denied });
      const body = await readJsonBody(req);
      prep(`INSERT INTO ${spec.table} (id, data) VALUES (1, ?)
                  ON CONFLICT(id) DO UPDATE SET data = excluded.data`)
        .run(JSON.stringify(body.data ?? body));
      log(user.username, `put:${parts[1]}`, null);
      return send(req, res, 200, { ok: true });
    }
  }

  // ---- admin ----
  if (url.pathname === '/admin/reset' && req.method === 'POST') {
    const denied = authorize(user, { write: true, adminOnly: true });
    if (denied) return send(req, res, 403, { error: denied });
    transaction(db, () => {
      for (const spec of Object.values(COLLECTIONS)) db.exec(`DELETE FROM ${spec.table}`);
      db.exec('DELETE FROM journal_lines');
    });
    log(user.username, 'admin.reset', null);
    return send(req, res, 200, { ok: true });
  }

  // Anything else that is not an API route falls through to the SPA. The
  // client router owns those URLs, so returning 404 for them would break a
  // refresh on a deep link. API paths keep a JSON 404 so a mistyped endpoint
  // fails loudly instead of silently returning HTML.
  if (SERVE_STATIC && !isApiRequest && !isApiPath && serveStatic(req, res, url.pathname)) return;

  return send(req, res, 404, { error: 'Not found' });
}

/**
 * Failed-login throttle, keyed by client address.
 *
 * The seeded demo accounts have memorable passwords, so an unthrottled login
 * endpoint lets anyone on the network grind through them. Counters live in
 * memory: a restart clears them, which is acceptable for a single-till server.
 */
const LOGIN_MAX_ATTEMPTS = 8;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const loginAttempts = new Map();

function loginThrottleKey(req) {
  return req.socket.remoteAddress || 'unknown';
}

/** Returns the number of milliseconds to wait, or 0 when the caller may try. */
function loginThrottleRemaining(key) {
  const entry = loginAttempts.get(key);
  if (!entry) return 0;
  const elapsed = Date.now() - entry.firstAt;
  if (elapsed > LOGIN_WINDOW_MS) {
    loginAttempts.delete(key);
    return 0;
  }
  return entry.count >= LOGIN_MAX_ATTEMPTS ? LOGIN_WINDOW_MS - elapsed : 0;
}

function recordLoginFailure(key) {
  const entry = loginAttempts.get(key);
  if (!entry || Date.now() - entry.firstAt > LOGIN_WINDOW_MS) {
    loginAttempts.set(key, { count: 1, firstAt: Date.now() });
  } else {
    entry.count += 1;
  }
}

const DEMO_PASSWORDS = ['admin123', 'cashier123', 'general123', 'audit123'];

/**
 * Guards against shipping demo credentials.
 *
 * The demo passwords are public knowledge, so a production deployment that
 * still uses them is effectively unauthenticated. In production this is a hard
 * failure rather than a warning: a warning on a container's stdout is far too
 * easy to miss. Development keeps the warning so the app runs out of the box.
 */
function enforceNonDefaultPasswords() {
  // Check the stored hashes, not the environment. A database created on an
  // earlier run keeps its old credentials no matter what the env now says, so
  // trusting the env alone would let a demo-password database reach production.
  const rows = prep('SELECT username, password_hash FROM users').all();
  const defaults = rows
    .filter(row => DEMO_PASSWORDS.some(password => verifyPassword(password, row.password_hash)))
    .map(row => row.username);
  if (defaults.length === 0) return;

  const remedy =
    'Set SEED_ADMIN_PASSWORD / SEED_CASHIER_PASSWORD / SEED_GENERAL_PASSWORD / ' +
    'SEED_AUDIT_PASSWORD and start against a fresh database (or change the ' +
    'passwords in the app) before exposing this server.';

  if (process.env.NODE_ENV === 'production') {
    console.error(`[security] Refusing to start: demo passwords still work for ${defaults.join(', ')}. ${remedy}`);
    process.exit(1);
  }

  console.warn(`[security] Demo passwords still work for: ${defaults.join(', ')}.\n           ${remedy}`);
}

seed();
enforceNonDefaultPasswords();

const server = http.createServer((req, res) => {
  handle(req, res).catch(error => {
    console.error('[server] unhandled error:', error);
    if (!res.headersSent) send(req, res, 500, { error: 'Internal server error' });
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Afritecx Badboy server listening on http://${HOST}:${PORT}`);
  console.log(`SQLite database: ${path.join(DATA_DIR, 'afritecx.db')}`);
  console.log(SERVE_STATIC
    ? `Serving frontend from ${STATIC_DIR}`
    : 'Frontend not served (no dist/index.html, or SERVE_STATIC=0)');
});

/**
 * Expired sessions are deleted on use, but a token nobody returns with would
 * otherwise sit in the table forever. Sweeping hourly keeps the table small
 * without putting a DELETE on the login path.
 */
const sessionSweep = setInterval(() => {
  try {
    const { changes } = prep('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
    if (changes > 0) console.log(`[server] Swept ${changes} expired session(s)`);
  } catch (error) {
    console.error('[server] Session sweep failed:', error);
  }
}, 60 * 60 * 1000);
sessionSweep.unref();

/**
 * Graceful shutdown.
 *
 * A container runtime sends SIGTERM and then kills the process after a grace
 * period. Stopping the listener first lets in-flight sales finish, and closing
 * the database checkpoints the write-ahead log so the next start does not have
 * to replay it.
 */
let shuttingDown = false;

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[server] ${signal} received, shutting down`);

  const forceExit = setTimeout(() => {
    console.error('[server] Shutdown timed out, exiting');
    process.exit(1);
  }, 10_000);
  forceExit.unref();

  server.close(() => {
    try {
      db.close();
    } catch (error) {
      console.error('[server] Error closing database:', error);
    }
    clearTimeout(forceExit);
    console.log('[server] Closed cleanly');
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
