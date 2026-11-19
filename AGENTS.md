# AGENTS.md — Afritecx Badboy (POS & Accounting)

## Layout

- `src/` — React + TS frontend (Vite). Views live in `src/components/*View.tsx`.
- `src/services/database.ts` — storage abstraction. Two modes: local
  `localStorage`, or remote SQL when `VITE_API_BASE_URL` is set.
- `src/utils/accounting.ts` — `ACCOUNT_CODES` constants and journal builders.
  **Always use these constants; never hardcode account codes in components.**
- `server/index.mjs` — HTTP API (auth, collections, singletons, reports).
- `server/schema.mjs` — SQLite schema, `openDatabase()`, `transaction()`,
  `assertLedgerBalanced()`, `toCents()` / `fromCents()`.

## Commands

```bash
npx tsc --noEmit      # typecheck
npx vite build        # production build (single-file output)
DB_DIR=/tmp/x PORT=8899 node server/index.mjs   # run backend
```

There is no git repo in this workspace and no test suite. Verify changes by
running the server, exercising the UI, then querying SQLite directly:

```bash
node -e "const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync('<db path>');console.log(db.prepare('select * from journal_lines').all())" 2>&1 | grep -v Warning
```

## Conventions that matter

- **Money is integer cents in SQL, major units at the API boundary.** Use
  `toCents()` / `fromCents()`. Never add floats in a ledger path.
- **Every journal entry must net to zero.** `assertLedgerBalanced()` enforces
  this before commit — an unbalanced post throws rather than persisting.
- **Use `prep(sql)` in `server/index.mjs`, not `db.prepare()`.** It is a
  prepared-statement cache; `db.prepare` recompiles on every call.
- **Column naming:** API uses camelCase, SQL uses snake_case. `toSnake()` maps
  them; there is no `tax` column on `sales` — it is `tax_amount`.
- **The frontend GUI is frozen.** The user's standing instruction is to fix
  errors without changing layout. Label text, wording, and validation only.
- **Seed passwords default to `admin123` etc.** The server warns at boot. Set
  `SEED_*_PASSWORD` env vars for anything real.

## Gotchas

- Files in this repo have **trailing whitespace** inside import blocks and JSX.
  Exact-string edits fail unless you match it — check with `cat -A` first.
- `DATA_DIR` is read from `DB_DIR`, not `DATA_DIR`.
- The AI agent (`AIAgentView.tsx`) is a **keyword matcher, not an LLM**. Its
  receipt "OCR" parses filenames. Do not describe it as AI in UI text.
- `DATABASE.md` is stale (describes the old JSON-blob server). `README.md` is
  current.
