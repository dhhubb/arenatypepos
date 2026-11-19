/**
 * ============================================================================
 * Afritecx Badboy — SQL Database Layer (schema + access helpers)
 * ----------------------------------------------------------------------------
 * A dependency-free SQLite implementation built on Node's built-in
 * `node:sqlite` module (Node >= 22.5). It replaces the previous
 * "whole-JSON-blob-in-one-row" store with a normalised relational schema so
 * that reporting queries, indexes and referential integrity are possible.
 *
 * Design notes
 *   - Money is stored as INTEGER minor units (cents). Floats in SQL columns are
 *     a classic source of ledger drift; integers are exact.
 *   - Journal entries are stored as a header row plus journal_lines children,
 *     which lets the trial balance be computed by SQL aggregation.
 *   - Every write runs inside a transaction and the balance invariant
 *     (debits == credits) is enforced by a CHECK-like trigger before commit.
 *   - Only a fixed allow-list of collections is addressable, preventing SQL
 *     identifier injection through API input.
 * ============================================================================
 */
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

/** Collections exposed to the client, mapped to their table + columns. */
export const COLLECTIONS = {
  products: {
    table: 'products',
    columns: ['id', 'name', 'sku', 'category', 'price', 'costPrice', 'storeroomStock', 'fridgeStock', 'stock', 'minStock', 'barcode', 'image'],
    numeric: ['price', 'costPrice'],
    integer: ['storeroomStock', 'fridgeStock', 'stock', 'minStock']
  },
  customers: {
    table: 'customers',
    columns: ['id', 'name', 'phone', 'email', 'storeCredit', 'creditLimit'],
    numeric: ['storeCredit', 'creditLimit'],
    integer: []
  },
  suppliers: {
    table: 'suppliers',
    columns: ['id', 'name', 'phone', 'email', 'balanceOwed'],
    numeric: ['balanceOwed'],
    integer: []
  },
  sales: {
    table: 'sales',
    columns: ['id', 'invoiceNo', 'date', 'customerId', 'subtotal', 'discountAmount', 'taxAmount', 'total', 'paymentMethod', 'cashReceived', 'changeGiven', 'items'],
    numeric: ['subtotal', 'discountAmount', 'taxAmount', 'total', 'cashReceived', 'changeGiven'],
    integer: [],
    json: ['items']
  },
  purchase_orders: {
    table: 'purchase_orders',
    columns: ['id', 'poNo', 'date', 'supplierId', 'items', 'total', 'isReceived', 'isPaid', 'paymentMethod'],
    numeric: ['total'],
    integer: [],
    json: ['items'],
    boolean: ['isReceived', 'isPaid']
  },
  journal_entries: {
    table: 'journal_entries',
    columns: ['id', 'date', 'description', 'reference', 'createdBy'],
    numeric: [],
    integer: [],
    special: 'journal'
  },
  accounts: {
    table: 'accounts',
    columns: ['code', 'name', 'type', 'balance', 'description', 'isSystem'],
    numeric: [],
    integer: [],
    boolean: ['isSystem'],
    primaryKey: 'code'
  },
  employees: {
    table: 'employees',
    columns: ['id', 'name', 'role', 'payType', 'payRate', 'taxWithholdingRate', 'email', 'taxId', 'isActive'],
    numeric: ['payRate', 'taxWithholdingRate'],
    integer: [],
    boolean: ['isActive']
  },
  payruns: {
    table: 'payruns',
    columns: ['id', 'payrunNo', 'startDate', 'endDate', 'paymentDate', 'totalGross', 'totalTax', 'totalNet', 'paymentMethod', 'items'],
    numeric: ['totalGross', 'totalTax', 'totalNet'],
    integer: [],
    json: ['items']
  },
  timesheets: {
    table: 'timesheets',
    columns: ['id', 'employeeId', 'employeeName', 'startDate', 'endDate', 'hoursWorked', 'notes', 'status', 'submittedDate'],
    numeric: ['hoursWorked'],
    integer: []
  },
  tax_remittances: {
    table: 'tax_remittances',
    columns: ['id', 'paymentDate', 'amount', 'method', 'quarter'],
    numeric: ['amount'],
    integer: []
  },
  daily_cashups: {
    table: 'daily_cashups',
    columns: ['id', 'date', 'closedBy', 'expectedCash', 'actualCash', 'discrepancy', 'amountDeposited', 'floatRetained'],
    numeric: ['expectedCash', 'actualCash', 'discrepancy', 'amountDeposited', 'floatRetained'],
    integer: []
  }
};

/** Singleton documents (one row each). */
export const SINGLETONS = {
  profile: { table: 'business_profile' },
  software_license: { table: 'software_license' },
  admin_control: { table: 'admin_control' }
};

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA synchronous = NORMAL;
PRAGMA busy_timeout = 5000;
PRAGMA temp_store = MEMORY;
-- The client re-reads the whole dataset on every load, so a larger page cache
-- pays for itself. 16 MB is well within a small-VPS budget.
PRAGMA cache_size = -16000;
PRAGMA mmap_size = 67108864;

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  user_type     TEXT NOT NULL CHECK (user_type IN ('ADMIN','GENERAL','CASHIER','AUDIT')),
  full_name     TEXT NOT NULL,
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  issued_at  INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
-- Sessions are swept on a timer, so the sweep must not scan the whole table.
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS products (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  sku            TEXT NOT NULL UNIQUE,
  category       TEXT,
  price          INTEGER NOT NULL DEFAULT 0,
  cost_price     INTEGER NOT NULL DEFAULT 0,
  storeroom_stock INTEGER NOT NULL DEFAULT 0,
  fridge_stock   INTEGER NOT NULL DEFAULT 0,
  stock          INTEGER NOT NULL DEFAULT 0,
  min_stock      INTEGER NOT NULL DEFAULT 0,
  barcode        TEXT,
  image          TEXT
);

CREATE TABLE IF NOT EXISTS customers (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  phone        TEXT,
  email        TEXT,
  store_credit INTEGER NOT NULL DEFAULT 0,
  credit_limit INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS suppliers (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  phone        TEXT,
  email        TEXT,
  balance_owed INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sales (
  id             TEXT PRIMARY KEY,
  invoice_no     TEXT NOT NULL,
  date           TEXT NOT NULL,
  customer_id    TEXT REFERENCES customers(id) ON DELETE SET NULL,
  subtotal       INTEGER NOT NULL DEFAULT 0,
  discount_amount INTEGER NOT NULL DEFAULT 0,
  tax_amount     INTEGER NOT NULL DEFAULT 0,
  total          INTEGER NOT NULL DEFAULT 0,
  payment_method TEXT NOT NULL,
  cash_received  INTEGER,
  change_given   INTEGER,
  items          TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS idx_sales_date ON sales(date);
CREATE INDEX IF NOT EXISTS idx_sales_customer ON sales(customer_id);
CREATE INDEX IF NOT EXISTS idx_sales_invoice ON sales(invoice_no);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id             TEXT PRIMARY KEY,
  po_no          TEXT NOT NULL,
  date           TEXT NOT NULL,
  supplier_id    TEXT REFERENCES suppliers(id) ON DELETE SET NULL,
  items          TEXT NOT NULL DEFAULT '[]',
  total          INTEGER NOT NULL DEFAULT 0,
  is_received    INTEGER NOT NULL DEFAULT 0,
  is_paid        INTEGER NOT NULL DEFAULT 0,
  payment_method TEXT
);
CREATE INDEX IF NOT EXISTS idx_po_date ON purchase_orders(date);

CREATE TABLE IF NOT EXISTS accounts (
  code        TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  type        TEXT NOT NULL CHECK (type IN ('ASSET','LIABILITY','EQUITY','REVENUE','EXPENSE')),
  description TEXT,
  is_system   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS journal_entries (
  id          TEXT PRIMARY KEY,
  date        TEXT NOT NULL,
  description TEXT NOT NULL,
  reference   TEXT,
  created_by  TEXT,
  created_at  TEXT NOT NULL
);
-- The ledger is always read in date order with id as the tie-break, so the
-- composite index serves both the filter and the sort without a temp B-tree.
CREATE INDEX IF NOT EXISTS idx_je_date_id ON journal_entries(date, id);
CREATE INDEX IF NOT EXISTS idx_je_reference ON journal_entries(reference);

CREATE TABLE IF NOT EXISTS journal_lines (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id    TEXT NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  account_code TEXT NOT NULL REFERENCES accounts(code),
  type        TEXT NOT NULL CHECK (type IN ('DEBIT','CREDIT')),
  amount      INTEGER NOT NULL CHECK (amount > 0)
);
CREATE INDEX IF NOT EXISTS idx_jl_entry ON journal_lines(entry_id);
CREATE INDEX IF NOT EXISTS idx_jl_account ON journal_lines(account_code);

CREATE TABLE IF NOT EXISTS employees (
  id                   TEXT PRIMARY KEY,
  name                 TEXT NOT NULL,
  role                 TEXT,
  pay_type             TEXT,
  pay_rate             INTEGER NOT NULL DEFAULT 0,
  tax_withholding_rate REAL NOT NULL DEFAULT 0,
  email                TEXT,
  tax_id               TEXT,
  is_active            INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS payruns (
  id             TEXT PRIMARY KEY,
  payrun_no      TEXT NOT NULL,
  start_date     TEXT,
  end_date       TEXT,
  payment_date   TEXT NOT NULL,
  total_gross    INTEGER NOT NULL DEFAULT 0,
  total_tax      INTEGER NOT NULL DEFAULT 0,
  total_net      INTEGER NOT NULL DEFAULT 0,
  payment_method TEXT NOT NULL,
  items          TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS timesheets (
  id            TEXT PRIMARY KEY,
  employee_id   TEXT,
  employee_name TEXT,
  start_date    TEXT,
  end_date      TEXT,
  hours_worked  REAL NOT NULL DEFAULT 0,
  notes         TEXT,
  status        TEXT NOT NULL DEFAULT 'PENDING',
  submitted_date TEXT
);

CREATE TABLE IF NOT EXISTS tax_remittances (
  id           TEXT PRIMARY KEY,
  payment_date TEXT NOT NULL,
  amount       INTEGER NOT NULL DEFAULT 0,
  method       TEXT NOT NULL,
  quarter      TEXT
);

CREATE TABLE IF NOT EXISTS daily_cashups (
  id               TEXT PRIMARY KEY,
  date             TEXT NOT NULL,
  closed_by        TEXT,
  expected_cash    INTEGER NOT NULL DEFAULT 0,
  actual_cash      INTEGER NOT NULL DEFAULT 0,
  discrepancy      INTEGER NOT NULL DEFAULT 0,
  amount_deposited INTEGER NOT NULL DEFAULT 0,
  float_retained   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS business_profile (
  id   INTEGER PRIMARY KEY CHECK (id = 1),
  data TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS software_license (
  id   INTEGER PRIMARY KEY CHECK (id = 1),
  data TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_control (
  id   INTEGER PRIMARY KEY CHECK (id = 1),
  data TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  at         TEXT NOT NULL,
  actor      TEXT,
  action     TEXT NOT NULL,
  detail     TEXT
);

`;

/** Opens (and migrates) the database file. */
export function openDatabase(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'afritecx.db'));
  db.exec(SCHEMA);
  return db;
}

/**
 * Runs a callback inside a transaction and rolls back on any error.
 *
 * `verify` runs after the callback but before COMMIT, so an invariant failure
 * (such as an unbalanced journal entry) aborts the whole write atomically.
 */
export function transaction(db, fn, verify) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    if (verify) verify();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* already rolled back */ }
    throw error;
  }
}

/**
 * Asserts that every journal entry in the ledger nets to zero. This is the
 * database-side double-entry guarantee: a posting cannot be committed if its
 * debits and credits disagree, whatever the client sent.
 */
export function assertLedgerBalanced(db) {
  const broken = db.prepare(`
    SELECT entry_id, SUM(CASE WHEN type='DEBIT' THEN amount ELSE -amount END) AS net
    FROM journal_lines
    GROUP BY entry_id
    HAVING net <> 0
    LIMIT 1
  `).get();
  if (broken) {
    throw new Error(`Journal entry ${broken.entry_id} is out of balance by ${broken.net / 100}`);
  }
}

/** Converts a major-unit amount to integer cents. */
export function toCents(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.round((number + Math.sign(number) * 1e-9) * 100);
}

/** Converts integer cents back to a major-unit amount. */
export function fromCents(cents) {
  return Math.round(Number(cents) || 0) / 100;
}

/** Maps an API column name to its snake_case database column. */
function dbColumn(name) {
  return name.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
}
