# Afritecx Badboy — POS & Accounting System

Point-of-sale and double-entry bookkeeping for **Maboko Dinku Investments**, a bar
bottlestore at Plumtree Border Post. React + TypeScript frontend, Node.js + SQLite
backend.

This README records what was changed during the audit and remediation pass, and
why. The frontend layout, styling and navigation were deliberately left alone —
only labels, wording, validation and data paths changed.

To take this from a working local copy to a live deployment, follow
**[DEPLOYMENT.md](DEPLOYMENT.md)** — it covers Node setup, production passwords,
the build, Docker or a VPS, HTTPS, and backups.

---

## 1. What was broken

The application looked finished but several parts of it were not doing what the
screen claimed.

### 1.1 The "database" was a single JSON file

The original `server/index.mjs` was 115 lines that read and rewrote one JSON blob:

```js
GET  /snapshot   -> whole dataset
PUT  /snapshot   -> replace whole dataset
```

Consequences:

- **Two tills destroyed each other's work.** Every save replaced the entire
  dataset. A cashier on till two overwrote every sale made on till one since
  their last read.
- **No authentication at all.** The only protection was an optional static
  `x-api-key`. Anyone who reached the port could read or rewrite every sale,
  payroll record and journal entry.
- **No integrity guarantees.** Nothing stopped an unbalanced journal entry, a
  negative stock figure, or a duplicate invoice number.
- **No reporting.** Trial balance and A/R aging had to be computed in the browser
  from the entire dataset.

### 1.2 The UI reported status it had not verified

The footer said *"Status: Online • SQL Server Sync Active"* whenever a local flag
was set, and the AI panel said *"🟢 Agent Online & Ready"* while making no network
call whatsoever. A shopkeeper reading those lines would reasonably believe their
data was safely synchronised when it may have been only in the browser.

### 1.3 Money was stored as floating point

Currency values were `REAL` columns. Repeated addition of floats drifts
(R0.01 becoming R0.009999…), which is unacceptable in a ledger.

### 1.4 Till shortfalls were booked to the wrong account

`CashUpView` posted a cash shortage to **6050 Bank & Transaction Fees**. The chart
of accounts already defined **6060 Cash Over / Short** for exactly this purpose.
Booking shortages to 6050 buries till losses inside card-processing charges, so
shrinkage becomes invisible in the expense report.

### 1.5 Smaller defects

- The trial balance header used `totalDebit.toFixed(0)`, so R628.75 rendered as
  "629" — rounded, and with no currency symbol.
- Three labels hardcoded `($)` while the business trades in ZAR.
- The product editor accepted a cost price above the selling price, so a product
  could be saved that loses money on every sale with no warning.
- Sessions were dropped on every page reload, so a cashier lost their place mid-shift.

### 1.6 Inventory on the balance sheet did not match the shelves

The balance sheet reported R5,454.50 of inventory while the stock screen held
goods worth R2,994.00 — an overstatement of R2,460.50. The two purchase orders
posted their value to the Inventory account but the seeder never added the units
to any product, so the ledger believed in stock that did not exist.

This is the most damaging kind of defect in a bookkeeping app: every report built
on the inventory figure inherited the error, and nothing on screen warned that the
balance sheet and the stock list disagreed. A shopkeeper could not have caught it
without reconciling the two by hand.

---

## 2. What was changed

### 2.1 Backend: real SQL, real auth

`server/schema.mjs` (new) and `server/index.mjs` (rewritten) replace the JSON blob
with a normalised SQLite schema on Node's built-in `node:sqlite` — no new
dependencies.

**Schema.** Nineteen tables: `users`, `sessions`, `products`, `customers`,
`suppliers`, `sales`, `purchase_orders`, `accounts`, `journal_entries`,
`journal_lines`, `employees`, `payruns`, `timesheets`, `tax_remittances`,
`daily_cashups`, `business_profile`, `software_license`, `admin_control`,
`audit_log`.

**Per-record writes.** The API moved from *replace the whole dataset* to
`POST` / `PATCH` / `DELETE` on `/collections/:name`. Two tills can now work at the
same time without clobbering each other.

**Integer cents.** Every monetary column is `INTEGER` holding minor units.
Conversion happens at the API boundary via `toCents()` / `fromCents()`, so
arithmetic is exact and no ledger drift can accumulate.

**Server-enforced double entry.** Every write runs in a transaction, and
`assertLedgerBalanced()` re-checks that all journal entries net to zero *before
commit*. A client bug can no longer post an unbalanced entry.

**Authentication.** Passwords are PBKDF2-SHA256 (matching the browser
implementation). Login returns a 64-hex bearer token stored in the `sessions`
table with a 12-hour TTL. Failed logins return one uniform message so usernames
cannot be enumerated.

**Role gates.** `AUDIT` sessions are read-only; admin-only routes require `ADMIN`.

**CORS allow-list.** Replaced the wildcard with an explicit `CORS_ORIGINS` list,
so a hostile page cannot drive the API with the cashier's browser.

### 2.2 SQL connection optimisation

The connection previously opened with no tuning beyond WAL. Changes in
`server/schema.mjs`:

| Setting | Value | Why |
| --- | --- | --- |
| `journal_mode` | `WAL` | Readers do not block the writer; a report can run while a sale is being saved. |
| `synchronous` | `NORMAL` | With WAL this is the standard durability/speed trade-off — safe against process crashes, far fewer fsyncs than `FULL`. |
| `busy_timeout` | `5000` | Waits up to 5 s for a lock instead of failing instantly with `SQLITE_BUSY` when two tills write together. |
| `temp_store` | `MEMORY` | Sorting and grouping for trial-balance reports stay in RAM. |
| `foreign_keys` | `ON` | Referential integrity actually enforced. |
| `cache_size` | `-16000` (16 MB) | The client re-reads the whole dataset on every load. The default 2 MB cache meant pages were evicted and re-read between the snapshot queries. |
| `mmap_size` | `67108864` (64 MB) | Memory-maps the database file, so page reads become memory reads instead of `read()` syscalls. |

All seven settings were confirmed active at runtime by reading them back with
`PRAGMA <name>` on a freshly opened database, not just assumed from the schema
string.

**New indexes.** `sales(invoice_no)` for receipt lookup and duplicate detection,
and `journal_entries(reference)` for drill-down from a cashup or document to its
posting. Existing indexes on `sales(date)`, `sales(customer_id)`,
`purchase_orders(date)`, `journal_entries(date)`, `journal_lines(entry_id)` and
`journal_lines(account_code)` were kept.

Two more were added in this pass:

- **`journal_entries(date, id)`** — the ledger is always read in that exact order.
  The old single-column index on `date` satisfied the filter but left SQLite to
  build a temporary B-tree to break ties on `id`. The composite index removes it.
  Confirmed with `EXPLAIN QUERY PLAN`: the plan went from
  `SCAN … USING INDEX idx_je_date | USE TEMP B-TREE FOR LAST TERM OF ORDER BY`
  to `SCAN journal_entries USING INDEX idx_je_date_id`.
- **`sessions(expires_at)`** — needed by the expiry sweep described below, so the
  sweep does not scan the whole table.

Every hot query was checked with `EXPLAIN QUERY PLAN` and none does a full table
scan: A/R aging uses `idx_sales_date`, journal lines use `idx_jl_entry`, the
trial-balance aggregation uses `idx_jl_account`, and token lookup uses the
`sessions` primary key.

**Prepared-statement cache.** `node:sqlite` compiles SQL on every `db.prepare()`.
The app reloads the full snapshot on each client start, which recompiled ~30
identical statements each time. `prep(sql)` now caches compiled statements by SQL
text.

**Removed an N+1 query.** Listing journal entries ran one extra query per entry
to fetch its lines. It now issues a single `ORDER BY entry_id, id` pass and groups
in memory, so cost no longer grows with ledger size.

**Session sweep.** Expired sessions were deleted only when a request happened to
arrive with that token, so tokens nobody used again stayed in the table forever.
An hourly `DELETE FROM sessions WHERE expires_at < ?` now prunes them. The timer
is `unref()`d so it never holds the process open during shutdown.

**Measured result.** On the seeded dataset (16 journal entries, 58 lines):

| Endpoint | Average | Max |
| --- | --- | --- |
| `GET /snapshot` (full dataset, ~18 KB) | 1.3 ms | 3.1 ms |
| `GET /reports/trial-balance` | 0.5 ms | 0.9 ms |

### 2.3 Stock total is enforced server-side

`products.stock` is a cached total of `storeroom_stock + fridge_stock`. The client
recomputes all three together, but the API accepted any subset, so a partial
`PATCH` — or a bulk import — could move one column and leave the total stale.
That silently breaks low-stock warnings and the Inventory valuation.

`insertRecords()` and `updateRecord()` now call `syncProductStock()` after writing
a product, recomputing `stock` from its two components. The invariant holds at the
one choke point every write passes through, rather than depending on every caller
to get it right.

Verified: patching only `storeroomStock` to 4 on a product with 2 in the fridge
returned `stock: 6`, and a query for rows where
`stock <> storeroom_stock + fridge_stock` returned zero.

### 2.4 Seed data: the ledger and the shelves now agree

The demo data is what a shopkeeper sees on first login, so it has to be
internally consistent. Three defects broke that.

**Purchase orders inflated Inventory without adding stock.** `PO-2001` and
`PO-2002` posted Dr `1200 Inventory` R1,840.00 + R620.50 to the ledger, but the
seeder never added those units to any product. The balance sheet therefore showed
R5,454.50 of inventory while the stock screen held goods worth R2,994.00 — a
R2,460.50 overstatement, exactly the value of the two purchase orders.

The fix removes the duplication: `RESTOCKS` is now the single source of truth for
both the storeroom quantities and the journal entries. Each restock's line items
are summed once and used for the A/P posting, the purchase-order row, and the
supplier balance, so those three figures cannot drift apart. The old
`PO-2001` item list was also internally wrong — 48 units at R38.33 each is
R1,839.84, not R1,840.00, and the cost was roughly double the catalogue price.
Quantities and unit costs now come from the catalogue.

**Opening stock did not cover the trading week.** Castle Lager 750ml opened at 200
units while the seeded sales consume 168; after the correction to restocks, one
product was oversold and its stock clamped to zero, which broke the
ledger-equals-shelves identity. Opening quantities were sized against the actual
sales plus the restock, so no product goes negative and no sale exceeds available
stock.

**Low-stock warnings were noise.** Still Water had a 24-unit buffer on an 80-unit
opening, so it warned permanently. Its buffer is now 12, and the remaining warnings
(Jameson, Brands & Coke Combo) are genuine.

**Result.** Inventory on the balance sheet equals the value of stock on the
shelves to the cent (R3,738.00), verified by multiplying each product's cost price
by its on-hand quantity and comparing to the `1200` ledger balance.

**The seeder wrote to the wrong directory.** `server/seed.mjs` defaulted to
`/tmp/afritecx-test` while `server/index.mjs` defaulted to `server/data`. So
`npm run seed` followed by `npm start` — the flow the docs describe — populated one
directory and served an empty database from another, presenting a blank app to
anyone setting it up for the first time. The seeder now defaults to the same
`DB_DIR`-or-`server/data` path as the server.

### 2.5 Security hardening

**Login throttling.** Eight failed attempts per client address within 15 minutes,
then `429` with a `Retry-After` header. The seeded accounts have memorable
passwords, so an unthrottled endpoint invited brute force. Verified: attempts 1–8
return `401`, attempt 9 returns `429`, and a *correct* password is also refused
while the block is active.

**Default-password warning.** The server now prints a loud startup warning naming
any account still on a seeded password, with instructions to set the
`SEED_*_PASSWORD` environment variables and rebuild the database. This is a
warning rather than a hard failure so the demo still runs out of the box.

### 2.6 Frontend fixes (no layout changes)

| File | Change | Why |
| --- | --- | --- |
| `src/services/database.ts` | Bearer token moved to `sessionStorage` | A reload keeps the cashier signed in; closing the tab ends the session. `localStorage` would leave a token on disk indefinitely. |
| `src/App.tsx` | Boot verifies the stored token via `/auth/me` instead of discarding it | Sessions survive reload without trusting a stale token. |
| `src/App.tsx` | "SQL Server" → "SQL Database" | The backend is SQLite, not Microsoft SQL Server. |
| `src/components/DashboardView.tsx` | `toFixed(0)` → `formatCurrency()` | R628.75 now renders as "R628.75", not "629". |
| `src/components/CashUpView.tsx` | Shortfall posted to `ACCOUNT_CODES.CASH_OVER_SHORT` (6060) | Shortages belong in their own expense line, not mixed into bank charges. Hardcoded codes replaced with the existing constants. |
| `src/components/InventoryView.tsx` | Rejects cost price > selling price | Prevents saving a product that loses money on every sale. |
| `src/components/PayrollView.tsx`, `POSView.tsx` | `($)` → `{businessProfile.currency}` | Labels now match the configured currency (ZAR). |
| `src/components/AIAgentView.tsx` | "Agent Online & Ready" → "Local Assistant Ready" | The assistant is a local keyword engine with no LLM call. The old label overstated it. |

---

## 3. Verification performed

Each item was exercised against the running app and confirmed in SQLite directly.

**Point of sale.** Sold one item at R25.00 + 15% VAT. Totals: R28.75, change from
R50 = R21.25. Stock decremented 48 → 47. Journal `JE-SALE` posted 5 lines
(Dr Cash, Dr COGS, Cr Sales, Cr VAT Payable, Cr Inventory) netting to zero.

**Payroll.** Onboarded an employee at R20/hr, 15% withholding. Payrun for 40 hours
computed R800 gross, R120 tax, R680 net. Released as `CARD`, which debited
`6020 Wages & Salaries` and credited `1020 Bank` — the account matching the
selected payment method.

**Cash up.** Expected drawer R28.75 from the day's sale. Counted R28.00 via
denominations (R20 + R5 + R2 + R1) — the UI correctly computed the R0.75 shortfall.
After the fix, the reconciling entry posts Dr `6060 Cash Over/Short` / Cr
`1010 Cash Drawer`, and `6050` stays clean.

**Ledger integrity.** Trial balance after all transactions: debits R1,442.00,
credits R1,442.00. Every journal entry nets to zero.

**Auth persistence.** Reloaded the page: session retained, live SQL data reloaded.
Wrote a cost-price change post-reload and confirmed the new value in the database.

**Build.** `npx tsc --noEmit` clean; `npx vite build` succeeds (1,786 modules).

### Second pass

Re-verified end to end after the seed-data and connection changes, against a
database rebuilt from scratch.

**Accounting identity.** With 16 journal entries and 58 lines, the ledger nets to
zero. Two different figures appear and both are correct: total *debit lines* are
R46,426.30 (equal to total credit lines), while the *sum of accounts carrying a
debit balance* is R30,290.90 — the number the dashboard quotes, since the rest is
offset within contra accounts. Assets R20,035.50 = Liabilities R3,914.90 + Equity
R14,810.00 + net income R1,310.60, so the balance sheet balances and the app
reports "Balanced perfectly".

**Inventory equals the shelves.** Every product's `cost_price × stock` sums to
R3,738.00, which is exactly the `1200 Inventory` ledger balance. No product sits
at zero stock.

**Receivables and payables reconcile to their source records.** A/R ledger
R1,373.10 equals the sum of customer credit balances; A/P ledger R2,060.00 equals
the sum of supplier balances and the sum of purchase-order totals. All three
differences are R0.00.

**Query plans.** `EXPLAIN QUERY PLAN` confirmed index use on every hot path, and
the temporary B-tree on the ledger ordering is gone (see §2.2).

**Stock invariant.** Patching only `storeroomStock` produced the correct `stock`
total; a scan for rows where `stock <> storeroom_stock + fridge_stock` found none.

**Write persistence.** A sale created through the API survived a server restart,
and the WAL checkpointed on shutdown leaving no `-wal` or `-shm` sidecars behind.

**Guards still hold.** The server refuses to start against a database whose
accounts still use demo passwords when `NODE_ENV=production`, and the seeder
refuses to overwrite an existing database without `--force`.

**Screens.** Dashboard, Stocks & Supply, and the General Ledger console
(Chart of Accounts, P&L, Balance Sheet, Trial Balance, journal listing) all render
with consistent figures. No frontend files were modified in this pass.

---

## 4. Running it

```bash
# 1. Populate a database (writes to $DB_DIR, default server/data)
npm run db:test          # add --force to replace an existing one

# 2. Backend (Node >= 22.5 for node:sqlite)
npm start

# 3. Frontend, for development with hot reload
npm run dev
```

`npm start` also serves the built frontend from `dist`, so a plain
`npm run build && npm start` gives the whole app on one port. Both the seeder and
the server resolve the database the same way — `$DB_DIR`, falling back to
`server/data` — so the two steps always agree on which file they are using.

Configuration:

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8787` | Server port |
| `HOST` | `127.0.0.1` | Bind address |
| `DB_DIR` | `server/data` | SQLite file location |
| `CORS_ORIGINS` | — | Comma-separated allow-list |
| `SEED_ADMIN_PASSWORD` etc. | see below | Override seeded passwords |
| `VITE_API_BASE_URL` | — | Empty runs the app on localStorage only |

Seeded accounts (change before any real deployment):

| Username | Role | Default password |
| --- | --- | --- |
| `admin` | ADMIN | `admin123` |
| `cashier` | CASHIER | `cashier123` |
| `general` | GENERAL | `general123` |
| `audit` | AUDIT | `audit123` |

---

## 5. Known limitations

These are honest gaps, not regressions.

- **The AI assistant is not an AI.** It is a keyword matcher over a fixed script,
  and receipt "OCR" parses the *filename* (`delta`, `afdis`, `rent`) to pick a
  template. It is now labelled accurately, but wiring a real model is still
  outstanding.
- **Throttle counters are in memory.** A server restart clears them. Fine for a
  single till; a multi-instance deployment needs shared state.
- **No TLS.** Terminate HTTPS at a reverse proxy before exposing this beyond the
  shop LAN.
- **No backup automation.** Back up `afritecx.db` (plus `-wal`) on a schedule.
- **`DATABASE.md` is stale.** It still describes the JSON-blob server. This README
  supersedes it.
