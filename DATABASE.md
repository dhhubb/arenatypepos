# Afritecx Badboy — Real Database Connection

The app ships with **two storage modes**. It works out of the box with no setup,
and can be pointed at a real database server without changing any business logic.

| Mode | When it is used | Storage |
| --- | --- | --- |
| **Local** (default) | `VITE_API_BASE_URL` is empty | Browser `localStorage` |
| **Remote** | `VITE_API_BASE_URL` is set | Your REST server / database |

In remote mode the app still writes to `localStorage` as an **offline cache**, so
the POS keeps selling if the network drops, and re-syncs when it returns.

---

## 1. Quick start with the bundled server

The repository includes a dependency-free Node.js server that persists to a real
JSON database file (`server/data/db.json`).

```bash
# 1. Start the database server (Node 18+)
node server/index.mjs

# 2. In another terminal, configure the frontend
cp .env.example .env
# set VITE_API_BASE_URL=http://localhost:8787

# 3. Run the app
npm run dev
```

On startup the header shows **Server Connected**, and every change is written to
`server/data/db.json` within ~1 second (debounced).

### Optional API key

```bash
API_KEY=my-secret node server/index.mjs
```

Then set `VITE_API_KEY=my-secret` in `.env`.

---

## 2. REST contract

Your backend only needs three endpoints:

| Method | Path | Request | Response |
| --- | --- | --- | --- |
| GET | `/health` | — | `{ "ok": true }` |
| GET | `/snapshot` | — | `{ "data": { ...collections } }` |
| PUT | `/snapshot` | `{ "data": { ...collections } }` | `{ "ok": true }` |

The snapshot is a single object keyed by collection name:

```json
{
  "data": {
    "profile": { "name": "...", "businessType": "RETAIL" },
    "products": [],
    "customers": [],
    "suppliers": [],
    "sales": [],
    "purchase_orders": [],
    "journal_entries": [],
    "users": [],
    "accounts": [],
    "employees": [],
    "payruns": [],
    "timesheets": [],
    "tax_remittances": [],
    "daily_cashups": [],
    "software_license": {},
    "admin_control": {}
  }
}
```

> The contract is intentionally snapshot-based so it can be adapted to any SQL
> database. If you prefer normalized tables, the server can store the snapshot
> as JSONB (PostgreSQL) or normalise each key into its own table.

---

## 3. Using PostgreSQL instead of the JSON file

Add `pg` to the server and replace the read/write helpers:

```sql
CREATE TABLE IF NOT EXISTS app_snapshots (
  id          integer PRIMARY KEY DEFAULT 1,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT single_row CHECK (id = 1)
);
INSERT INTO app_snapshots (id, data) VALUES (1, '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;
```

```js
// GET /snapshot
const { rows } = await pool.query('SELECT data FROM app_snapshots WHERE id = 1');
send(res, 200, { data: rows[0]?.data ?? {} });

// PUT /snapshot
await pool.query(
  'UPDATE app_snapshots SET data = $1, updated_at = now() WHERE id = 1',
  [body.data]
);
```

This keeps the same REST contract, so the frontend needs **no changes** — only
`VITE_API_BASE_URL` points at your new server.

### Recommended production hardening

- Put the API behind HTTPS and authentication (session/JWT).
- Add per-user authorization checks (the frontend role system is not a security
  boundary on its own).
- Use database transactions for snapshots or move to normalized tables.
- Add automated backups and point-in-time recovery.
- For multi-tenant hosting, add a `tenant_id` column and scope all queries.

---

## 4. Files involved

| File | Purpose |
| --- | --- |
| `src/services/database.ts` | Provider layer: loads/saves snapshots, health checks, fallbacks |
| `.env.example` | Environment template |
| `server/index.mjs` | Runnable reference server (JSON file persistence) |
| `src/App.tsx` | Startup hydration + debounced write-through sync + status indicator |
| `src/components/SettingsView.tsx` | Live connection status card and “Test Connection” |

---

## 5. Troubleshooting

- **Status shows “Local DB”** → `VITE_API_BASE_URL` is empty; restart after editing `.env`.
- **Status shows “Sync Error”** → server not running, wrong URL, CORS, or API-key mismatch.
- **Data looks empty after connecting** → the server has no snapshot yet; the app
  pushes its current data automatically on the first change.
- **Restore a previous state** → use Settings → Database Backup Manager → Import.
