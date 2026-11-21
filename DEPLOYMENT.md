# Taking Afritecx Badboy from VS Code to production

This is the full path from "I have the project open in VS Code" to "it is running
on a server, reachable over HTTPS, with backups". Work through the steps in
order. Each one tells you what to type, what you should see, and what to do if
you do not see it.

If you only read one section, read **Step 7**. It is the step people skip, and
it is the one that catches almost every deployment problem before a customer
sees it.

---

## Contents

1. [What you are deploying](#1-what-you-are-deploying)
2. [Before you start](#2-before-you-start)
3. [Step 1 — Open the project in VS Code](#step-1--open-the-project-in-vs-code)
4. [Step 2 — Install Node.js 22.5 or newer](#step-2--install-nodejs-225-or-newer)
5. [Step 3 — Install dependencies](#step-3--install-dependencies)
6. [Step 4 — Run it locally and confirm it works](#step-4--run-it-locally-and-confirm-it-works)
7. [Step 5 — Create the production database with real passwords](#step-5--create-the-production-database-with-real-passwords)
8. [Step 6 — Build the frontend](#step-6--build-the-frontend)
9. [Step 7 — Test the production build on your own machine](#step-7--test-the-production-build-on-your-own-machine)
10. [Step 8 — Commit and push](#step-8--commit-and-push)
11. [Step 9 — Deploy to a server](#step-9--deploy-to-a-server)
12. [Step 10 — Verify the live deployment](#step-10--verify-the-live-deployment)
13. [Step 11 — Set up backups](#step-11--set-up-backups)
14. [Step 12 — Deploying updates and rolling back](#step-12--deploying-updates-and-rolling-back)
15. [Ongoing maintenance](#ongoing-maintenance)
16. [Troubleshooting](#troubleshooting)
17. [Known limitations before you trust this with money](#known-limitations-before-you-trust-this-with-money)

---

## 1. What you are deploying

One Node.js process serves both the API and the frontend, and stores everything
in a single SQLite file. There is no separate database server to install and no
npm packages needed at runtime.

```
                    ┌─────────────────────────────────────────┐
   Browser  ──────► │  node server/index.mjs        :8787     │
   (HTTPS)          │                                         │
                    │  ├── dist/index.html   ← built frontend │
                    │  ├── /auth/login       ← bearer tokens  │
                    │  ├── /snapshot, /sales …  ← JSON API    │
                    │  └── /health           ← liveness probe │
                    │                                         │
                    │  SQLite: $DB_DIR/afritecx.db  (one file)│
                    └─────────────────────────────────────────┘
```

Two consequences shape every step below:

- **The database is a file.** Backing up means copying one file. Losing it means
  losing everything, so backups are not optional.
- **`dist/` must exist before you start the server in production.** Without it
  the server runs as an API only, and visitors get
  `401 {"error":"Authentication required"}` instead of a login screen — a
  confusing message that looks like a password problem but is a missing build.

The build produces a *single* `index.html` containing all CSS and JavaScript.
That is deliberate: it means one file to serve, no asset-path problems behind a
proxy, and it works on a shop LAN with a flaky connection.

---

## 2. Before you start

| You need | Why |
| --- | --- |
| Node.js **22.5+** (24 recommended) | The server uses the built-in `node:sqlite` module, added in 22.5 |
| Git | Version control, and the deploy path on most servers |
| A server with a public IP, or a Docker host | To host it — a R100/month VPS is ample |
| A domain name (optional but recommended) | HTTPS certificates are issued per domain, not per IP |
| 15 minutes | Steps 1–7 are local; step 9 is the actual deploy |

Check your Node version now:

```bash
node --version
```

If it prints `v22.5.0` or higher you are fine. If it prints `v18`, `v20`, or
`v22.0.0`, do Step 2 before anything else — the server will not start otherwise.

---

## Step 1 — Open the project in VS Code

```bash
git clone https://github.com/dhhubb/arenatypepos.git
cd arenatypepos
code .
```

You should see this at the root of the Explorer panel:

```
server/          ← the API and database layer
src/             ← the React frontend
dist/            ← build output (may not exist yet; created in Step 6)
package.json     ← scripts and dependencies
Dockerfile       ← for the Docker deploy in Step 9
.env.production  ← tells the build to call /api
README.md        ← what was fixed and why
DEPLOYMENT.md    ← this file
```

If you cloned before the project was pushed, or `dist/` is missing, that is
normal — `dist/` is generated in Step 6 and is intentionally not committed.

**Install the recommended extensions** (VS Code will usually prompt you):
ESLint, and optionally Tailwind CSS IntelliSense. Neither is required to deploy.

---

## Step 2 — Install Node.js 22.5 or newer

Pick one method.

**Windows / macOS:** download the LTS installer from
[nodejs.org](https://nodejs.org) and run it. Choose 22 LTS or 24 LTS.

**Ubuntu / Debian server:**

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs
```

**macOS with Homebrew:**

```bash
brew install node@24
```

Verify:

```bash
node --version    # must be v22.5.0 or higher
npm --version
```

> **Why this matters:** `node:sqlite` is a built-in module. On Node 20 you will
> get `ERR_UNKNOWN_BUILTIN_MODULE: No such built-in module: node:sqlite` the
> moment you start the server. No amount of `npm install` fixes that — it is a
> Node version problem.
>
> **Prefer Node 24 LTS.** That is what the `Dockerfile` uses, so it is the
> version this deployment is actually tested against. On early Node 22.x the
> module sat behind the `--experimental-sqlite` flag; if you must stay on 22.x
> and see `ERR_UNKNOWN_BUILTIN_MODULE`, either start with
> `node --experimental-sqlite server/index.mjs` or move to Node 24, where the
> flag is no longer needed.

---

## Step 3 — Install dependencies

```bash
npm ci
```

`npm ci` installs the exact versions pinned in `package-lock.json`, which is
what you want for a deployment: everyone gets the same tree, every time. If you
see an error about the lock file being out of sync, use `npm install` once and
commit the updated lock file.

These are **build-time** dependencies only. The running server has no npm
dependencies at all, which is why the Docker image stays small.

---

## Step 4 — Run it locally and confirm it works

You need two terminals: one for the API, one for the frontend dev server. VS
Code's integrated terminal makes this easy — open a second one with
`` Ctrl+Shift+` ``.

**Terminal 1 — the API:**

```bash
npm run db:test     # creates a database with sample data to play with
npm start           # serves the API on http://127.0.0.1:8787
```

You should see:

```
[security] Demo passwords still work for: admin, cashier, general, audit.
           Set SEED_ADMIN_PASSWORD / SEED_CASHIER_PASSWORD / … and start
           against a fresh database …
Afritecx Badboy server listening on http://127.0.0.1:8787
SQLite database: /path/to/project/server/data/afritecx.db
Serving frontend from /path/to/project/dist
```

The `[security]` warning is **expected here** — this is a local demo database
with the public demo passwords, which is exactly what the warning is for. It
becomes a hard refusal once `NODE_ENV=production` is set, which is the subject
of Step 5.

The last line depends on whether `dist/` exists yet. On a fresh clone it will
read `Frontend not served (no dist/index.html, or SERVE_STATIC=0)` instead.
Either way is fine at this stage: the Vite dev server serves the frontend.

**Terminal 2 — the frontend:**

```bash
npm run dev
```

Open the URL it prints (usually `http://localhost:5173`) and sign in with
`admin` / `admin123`.

Check that the dashboard loads, the stock list shows values, and the trial
balance says "balanced perfectly". If it does, your machine can run the app.

> `npm run db:test` is the **demo data** seeder. It writes a realistic trading
> week — products, sales, customers, payroll. **Never run it against your
> production database.** Step 5 shows the production path.

---

## Step 5 — Create the production database with real passwords

This is the step that decides whether your deployment is secure.

The server creates the database automatically on first start, and it seeds four
user accounts. If you do not supply passwords, it uses the public demo ones.
**In production the server refuses to start in that state** — it checks the
stored password hashes and exits with an error. That guard exists because a
warning on a container's log is far too easy to miss.

So supply the passwords yourself, on the **first** start, before any real data
exists:

```bash
export NODE_ENV=production
export DB_DIR=/var/lib/afritecx
export SEED_ADMIN_PASSWORD='choose-a-long-unique-passphrase'
export SEED_CASHIER_PASSWORD='choose-a-different-one'
export SEED_GENERAL_PASSWORD='and-another'
export SEED_AUDIT_PASSWORD='and-one-more'

mkdir -p "$DB_DIR"
npm start
```

On Windows PowerShell use `$env:NODE_ENV = "production"` and so on.

What you should see:

```
Afritecx Badboy server listening on http://127.0.0.1:8787
SQLite database: /var/lib/afritecx/afritecx.db
```

If instead you see `[security] Refusing to start: demo passwords still work
for …`, the `SEED_*_PASSWORD` variables did not reach the process, or the
database already existed from an earlier run.

**Important:** the `SEED_*` variables are read only when the database is created
for the first time. Changing them later does nothing to an existing database —
the accounts already have hashes stored. If you get this wrong, delete the
database file and start again (only safe before you have real data).

A brand-new production database contains only what it needs:

| Table | Rows | Meaning |
| --- | --- | --- |
| `users` | 4 | Your four accounts, with your passwords |
| `accounts` | 19 | The chart of accounts (the accounting skeleton) |
| `products`, `sales`, `customers`, `journal_entries` | 0 | Empty — you add your own |

**Changing a password later is a database operation, not a UI one.** There is no
"change password" screen and no password-reset endpoint — `users` is deliberately
not exposed through the collection API. To change a password (or remove an
account) on a running deployment, stop the server and update the hash directly:

```bash
sudo systemctl stop afritecx        # or: docker stop afritecx

cd /var/lib/afritecx/app
sudo -u afritecx DB_DIR=/var/lib/afritecx node --input-type=module -e "
import { openDatabase } from './server/schema.mjs';
import { hashPassword } from './server/password.mjs';
const db = openDatabase(process.env.DB_DIR);
db.prepare('UPDATE users SET password_hash = ? WHERE username = ?')
  .run(hashPassword('the-new-passphrase'), 'admin');
db.prepare(\"DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE username = 'admin')\").run();
db.close();
console.log('password updated');
"

sudo systemctl start afritecx       # or: docker start afritecx
```

Deleting the session rows is what forces existing logins to re-authenticate;
without it an old 12-hour token keeps working. To remove an account you do not
use, change `DELETE FROM sessions …` to
`DELETE FROM users WHERE username = 'audit'`.

Alternatively, and more simply: **decide the passwords correctly before the
first start.** The `SEED_*` variables only take effect when the database is
created, so getting Step 5 right the first time avoids all of the above.

---

## Step 6 — Build the frontend

```bash
npm run build
```

You should see something like:

```
dist/index.html  933.54 kB │ gzip: 250.15 kB
✓ built in 2.89s
```

That single file *is* the whole frontend. The build reads `.env.production`,
which sets `VITE_API_BASE_URL=/api`. That is what makes the browser call
`/api/snapshot` on whatever host served the page, so there is no CORS setup and
no hard-coded server address to get wrong.

**Do not skip this step.** If `dist/index.html` does not exist, `npm start`
serves the API alone and a browser hitting `/` gets
`401 {"error":"Authentication required"}` rather than a login form.

> If you ever change `.env.production`, rebuild. It is baked in at build time,
> not read at runtime.

---

## Step 7 — Test the production build on your own machine

Do not deploy something you have not run in production mode locally. This step
catches the password guard, missing `dist/`, and path problems while you can
still fix them in one place.

```bash
npm run build

NODE_ENV=production \
DB_DIR=/tmp/prodcheck \
SEED_ADMIN_PASSWORD='a-real-password' \
SEED_CASHIER_PASSWORD='another-real-one' \
SEED_GENERAL_PASSWORD='a-third-one' \
SEED_AUDIT_PASSWORD='a-fourth-one' \
HOST=127.0.0.1 PORT=8787 \
npm start
```

Now check each of these:

```bash
# 1. Liveness — the same probe the Docker HEALTHCHECK uses
curl http://127.0.0.1:8787/health
#    expect: {"ok":true,"storage":"sqlite","engine":"node:sqlite"}

# 2. The frontend is actually being served
curl -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8787/
#    expect: 200

# 3. The API rejects unauthenticated access
curl -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8787/snapshot
#    expect: 401

# 4. Login works with your new password
curl -s -X POST http://127.0.0.1:8787/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"a-real-password"}'
#    expect: JSON containing a "token"

# 5. The old demo password no longer works
curl -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:8787/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin123"}'
#    expect: 401
```

Then open `http://127.0.0.1:8787/` in a browser and sign in. You should get the
real login screen and, after signing in, an empty dashboard — no demo sales.

Delete `/tmp/prodcheck` when you are done. It was a rehearsal.

---

## Step 8 — Commit and push

Your production database must never enter version control. The repository's
`.gitignore` already excludes it, along with `node_modules/`, `dist/` and `.env`
files:

```bash
git status
```

Confirm that `server/data/`, `node_modules/` and `dist/` do **not** appear in the
list. If any of them do, stop and fix `.gitignore` before committing — once a
database with password hashes is pushed, it is in the history and rewriting that
history is painful.

```bash
git checkout -b deploy/production-config
git add -A
git commit -m "Add production deployment guide and docker ignore rules"
git push -u origin deploy/production-config
```

Then open a pull request on GitHub and merge it. Do not push straight to `main`.

---

## Step 9 — Deploy to a server

Pick **one** of the three options. Docker (A) is the least error-prone; a plain
VPS (B) is the easiest to inspect and debug.

### Option A — Docker (recommended)

The included `Dockerfile` builds the frontend and runs the server as an
unprivileged user, with a health check. The database lives in a volume at
`/data`; without that volume every restart starts from an empty database.

On the server:

```bash
git clone https://github.com/dhhubb/arenatypepos.git
cd arenatypepos

docker build -t afritecx-badboy .

docker run -d \
  --name afritecx \
  --restart unless-stopped \
  -p 8787:8787 \
  -v afritecx-data:/data \
  -e SEED_ADMIN_PASSWORD='your-real-password' \
  -e SEED_CASHIER_PASSWORD='your-real-password' \
  -e SEED_GENERAL_PASSWORD='your-real-password' \
  -e SEED_AUDIT_PASSWORD='your-real-password' \
  afritecx-badboy
```

Check it:

```bash
docker logs afritecx
docker ps                    # STATUS should become "healthy" within ~30s
curl http://localhost:8787/health
```

The `SEED_*` variables are only needed on the **first** run, while the volume is
empty. You can drop them afterwards, because the passwords are stored as hashes
in the database.

> **Never** pass the container a bind mount of the project directory as `/data`,
> and never bake the database into the image. The repository now has a
> `.dockerignore` that keeps `server/data/` out of the build context — without
> it, `COPY . .` would pull your live database into the image, including
> password hashes and sales history.

**Put HTTPS in front.** Do not expose port 8787 to the internet directly. The
simplest reliable setup is Caddy, which obtains and renews certificates for you:

```bash
sudo apt install -y caddy
sudo tee /etc/caddy/Caddyfile >/dev/null <<'EOF'
pos.yourdomain.com {
    reverse_proxy 127.0.0.1:8787
}
EOF
sudo systemctl reload caddy
```

Point your domain's DNS `A` record at the server first, or certificate issuance
will fail.

### Option B — Ubuntu VPS with systemd and Nginx

More moving parts, but nothing is hidden behind a container.

```bash
# On the server
sudo apt update && sudo apt install -y git nginx
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs

sudo useradd --system --home /var/lib/afritecx --shell /usr/sbin/nologin afritecx
sudo mkdir -p /var/lib/afritecx
sudo chown afritecx:afritecx /var/lib/afritecx

sudo -u afritecx git clone https://github.com/dhhubb/arenatypepos.git /var/lib/afritecx/app
cd /var/lib/afritecx/app
sudo -u afritecx npm ci
sudo -u afritecx npm run build
```

Create the service definition:

```bash
sudo tee /etc/systemd/system/afritecx.service >/dev/null <<'EOF'
[Unit]
Description=Afritecx Badboy POS
After=network.target

[Service]
Type=simple
User=afritecx
WorkingDirectory=/var/lib/afritecx/app
ExecStart=/usr/bin/node server/index.mjs
Restart=always
RestartSec=5

Environment=NODE_ENV=production
Environment=HOST=127.0.0.1
Environment=PORT=8787
Environment=DB_DIR=/var/lib/afritecx
# REPLACE these four values before starting, or your passwords will literally
# be the string "replace-me". They are only read when the database is created,
# so you can delete these lines once /var/lib/afritecx/afritecx.db exists.
Environment=SEED_ADMIN_PASSWORD=replace-me
Environment=SEED_CASHIER_PASSWORD=replace-me
Environment=SEED_GENERAL_PASSWORD=replace-me
Environment=SEED_AUDIT_PASSWORD=replace-me

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now afritecx
sudo systemctl status afritecx
```

Then Nginx in front, with a certificate from Let's Encrypt:

```bash
sudo tee /etc/nginx/sites-available/afritecx >/dev/null <<'EOF'
server {
    listen 80;
    server_name pos.yourdomain.com;

    client_max_body_size 10M;

    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
EOF

sudo ln -s /etc/nginx/sites-available/afritecx /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d pos.yourdomain.com
```

`HOST=127.0.0.1` is correct here: Nginx is the only thing that should reach the
app. Binding to `0.0.0.0` would expose port 8787 directly.

### Option C — A platform (Render, Railway, Fly.io)

These work because the app is a single Node process. Configure:

| Setting | Value |
| --- | --- |
| Build command | `npm ci && npm run build` |
| Start command | `npm start` |
| Environment | `NODE_ENV=production`, `HOST=0.0.0.0`, `PORT` as provided by the platform |
| Persistent disk | Mount at `/data`, then set `DB_DIR=/data` |
| `SEED_*_PASSWORD` | Set all four on the first deploy |

**The persistent disk is not optional.** Without it, SQLite writes to a
container filesystem that is wiped on every redeploy, and you will lose all
business data. This is the single most common way this app loses data on a PaaS.

---

## Step 10 — Verify the live deployment

Run these against your real domain, not localhost.

```bash
# 1. HTTPS is working and the app responds
curl -o /dev/null -w '%{http_code}\n' https://pos.yourdomain.com/
#    expect: 200

# 2. Health probe
curl https://pos.yourdomain.com/health
#    expect: {"ok":true,...}

# 3. Unauthenticated API access is refused
curl -o /dev/null -w '%{http_code}\n' https://pos.yourdomain.com/snapshot
#    expect: 401
```

Then in a browser:

1. The login screen loads over `https://` with no certificate warning.
2. You can sign in with your new password.
3. The old demo password is rejected.
4. The dashboard loads with empty figures — no leftover demo sales.
5. Under **General Bookkeeping**, the trial balance reports balanced.
6. Sign in as `cashier` and confirm the ledger screens are not reachable — role
   restrictions are enforced server-side, not just hidden in the UI.

---

## Step 11 — Set up backups

SQLite keeps the whole business in one file, so a backup is a copy of that file.
Do not copy it with `cp` while the server is writing — you can capture a
half-written state. Use SQLite's own snapshot command, which is safe while the
app is running:

```bash
sqlite3 /var/lib/afritecx/afritecx.db "VACUUM INTO '/var/backups/afritecx-$(date +%F-%H%M).db'"
```

If `sqlite3` is not installed, the app's own Node runtime can do it:

```bash
node -e "
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('/var/lib/afritecx/afritecx.db');
db.exec(\"VACUUM INTO '/var/backups/afritecx-$(date +%F-%H%M).db'\");
db.close();
"
```

Put it on a schedule — hourly during trading hours is sensible for a till:

```bash
sudo mkdir -p /var/backups
sudo tee /etc/cron.hourly/afritecx-backup >/dev/null <<'EOF'
#!/bin/sh
set -e
STAMP=$(date +%F-%H%M)
node -e "
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('/var/lib/afritecx/afritecx.db');
db.exec(\"VACUUM INTO '/var/backups/afritecx-$STAMP.db'\");
db.close();
"
find /var/backups -name 'afritecx-*.db' -mtime +30 -delete
EOF
sudo chmod +x /etc/cron.hourly/afritecx-backup
```

**Copy backups off the machine.** A backup on the same disk as the database
does not survive a disk failure. Sync `/var/backups` to object storage, or pull
it to another machine nightly.

**Do a restore drill once, before you need it.** A backup you have never
restored is a hope, not a backup:

```bash
sudo systemctl stop afritecx
sudo cp /var/lib/afritecx/afritecx.db /var/lib/afritecx/afritecx.db.broken
sudo cp /var/backups/afritecx-2026-11-19-0900.db /var/lib/afritecx/afritecx.db
sudo chown afritecx:afritecx /var/lib/afritecx/afritecx.db
sudo systemctl start afritecx
# Sign in and confirm the data is the data you expected.
```

For Docker, back up the volume:

```bash
docker run --rm -v afritecx-data:/data -v /var/backups:/backup alpine \
  sh -c 'cp /data/afritecx.db /backup/afritecx-$(date +%F-%H%M).db'
```

---

## Step 12 — Deploying updates and rolling back

```bash
# 1. Back up first. Always.
sqlite3 /var/lib/afritecx/afritecx.db "VACUUM INTO '/var/backups/pre-deploy-$(date +%F-%H%M).db'"

# 2. Pull and rebuild
cd /var/lib/afritecx/app
sudo -u afritecx git pull
sudo -u afritecx npm ci
sudo -u afritecx npm run build

# 3. Restart
sudo systemctl restart afritecx
sudo systemctl status afritecx

# 4. Verify
curl -s https://pos.yourdomain.com/health
```

Schema changes are applied automatically when the database opens, so there is no
separate migration command to run.

**If the update breaks something**, roll back the code, not the database:

```bash
cd /var/lib/afritecx/app
sudo -u afritecx git log --oneline -5          # find the last good commit
sudo -u afritecx git checkout <good-commit>
sudo -u afritecx npm ci && sudo -u afritecx npm run build
sudo systemctl restart afritecx
```

Only restore the database if the new version wrote bad data. Code rollback is
usually enough, and it preserves sales recorded since the deploy.

---

## Ongoing maintenance

**Weekly**

- Confirm the health check is green and backups are arriving off-machine.
- Read the server log for `[security]` and `[server] unhandled error` lines.

**Monthly**

- `sudo apt update && sudo apt upgrade` — Node and system security patches.
- Review the user list; disable accounts for staff who have left.
- Check disk space. A year of trading in SQLite is small (tens of MB), but logs
  and backups grow.

**Before any deployment**

- Demo passwords must not work. The server enforces this when
  `NODE_ENV=production`, but confirm it rather than assume.
- Back up, and know the rollback command.

**Security posture to keep**

- HTTPS only. Credentials travel in a bearer token; over plain HTTP that token
  is readable by anyone on the network.
- Never commit `server/data/`, `.env`, or backups to Git.
- Keep `CORS_ORIGINS` empty unless the frontend is genuinely on another origin.
  Leaving it empty means no cross-origin browser request can drive the API.

---

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `ERR_UNKNOWN_BUILTIN_MODULE: node:sqlite` | Node older than 22.5 | Install Node 22.5+ (Step 2) |
| `[security] Refusing to start: demo passwords still work` | Production mode with demo passwords | Set all four `SEED_*_PASSWORD` values and start against a **fresh** `DB_DIR` |
| Browser shows `{"error":"Authentication required"}` on the page itself | `dist/` missing, so no frontend is served | `npm run build` (Step 6) |
| Visitors get a 404 for every path | Reverse proxy pointing at the wrong port | Check the proxy target matches `PORT` |
| Data disappears after every redeploy | No persistent volume | Mount a volume at `/data` and set `DB_DIR=/data` |
| Browser console: failed to fetch `/api/...` | Frontend built without `.env.production` | Confirm `VITE_API_BASE_URL=/api`, then rebuild |
| Login succeeds but the page stays blank | Cached old bundle in the browser | Hard reload (`Ctrl+Shift+R`) |
| `EADDRINUSE` | Port already in use | `sudo lsof -i :8787`, or set a different `PORT` |
| Docker container restarts in a loop | Usually the password guard | `docker logs afritecx` — the reason is on the first line |
| Container unhealthy but the app works | Health check hitting the wrong port | Health check uses `$PORT`; confirm it matches your mapping |
| `SQLITE_BUSY` errors under load | Too many concurrent writers | Expected to be rare here; check for a stray second server process writing the same file |
| Cannot sign in after changing `SEED_*` | Variables only apply at database creation | Update the hash directly (Step 5), or delete the database and recreate |
| Old login still works after a password change | Session rows survive a password update | Delete the user's `sessions` rows (Step 5) |

Log locations:

```bash
sudo journalctl -u afritecx -f          # systemd
docker logs -f afritecx                 # Docker
```

---

## Known limitations before you trust this with money

These are honest gaps, not bugs. Read them before go-live.

1. **The license gate is client-side.** `src/App.tsx` decides whether the
   licence is active and hides modules accordingly. It is a commercial control,
   not a security boundary — someone with the bundle can bypass it. The real
   security boundary is the server's role checks, which *are* enforced.

2. **The AI assistant is a simulated helper.** It does not call an external model
   and needs no API key. Document ingestion is a guided form, not real OCR. Do
   not present it to staff as reading receipts automatically.

3. **One server, one database file.** SQLite handles a shop's throughput
   comfortably, but it does not replicate. If the disk dies, you restore from
   backup and lose whatever happened since the last one — hence Step 11.

4. **Sessions last 12 hours.** A till left logged in overnight will need a fresh
   login in the morning. That is intentional.

5. **No automated test suite is wired into CI.** Verification is manual
   (`npm run verify` runs typecheck and build). Treat Step 7 as your regression
   check.

6. **The seeded chart of accounts is a starting point, not advice.** Have
   whoever handles the books review the account structure before real trading.

---

## The short version

If you already know your way around, this is the whole path:

```bash
# Local
npm ci
npm run db:test && npm start          # try it
npm run build

# Production first start
NODE_ENV=production DB_DIR=/var/lib/afritecx \
SEED_ADMIN_PASSWORD='…' SEED_CASHIER_PASSWORD='…' \
SEED_GENERAL_PASSWORD='…' SEED_AUDIT_PASSWORD='…' \
npm start

# Verify
curl localhost:8787/health

# Back up, every hour
sqlite3 /var/lib/afritecx/afritecx.db "VACUUM INTO '/var/backups/$(date +%F-%H%M).db'"
```

Everything else in this document exists to explain why those lines look the way
they do.
