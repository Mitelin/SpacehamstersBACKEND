# Spacehamsters backend (EVE Online)

Python REST API backend for EVE Online corporation data.

## What it does

- Syncs corporation data from EVE ESI (assets, industry jobs, wallet journal/transactions)
- Stores synced data in MariaDB/MySQL
- Exposes reporting endpoints built on top of local DB data
- Blueprint/material planning uses EVE SDE tables imported into the DB (not fetched from ESI)

This service has no GUI; it is controlled over HTTP.

## Requirements

- Python 3.11+ (recommended)
- MariaDB/MySQL
- EVE OAuth client credentials (for token refresh / protected endpoints)
- Git (only if you use the auto-updater launcher)

This repo is meant to be run from a repo-local virtual environment (`.venv`) so dependencies are isolated.

## Quickstart (recommended)

### 1) Clone + create virtualenv

Clone the repo:

```bash
git clone <YOUR_GIT_URL> spacehamsters-backend
cd spacehamsters-backend
```

Windows (PowerShell):

```powershell
# Run inside the repo root
py -3.11 -m venv .venv
.\.venv\Scripts\python -m pip install -U pip
.\.venv\Scripts\python -m pip install -r requirements.txt
```

Linux:

```bash
# Run inside the repo root
python3 -m venv .venv
./.venv/bin/python -m pip install -U pip
./.venv/bin/python -m pip install -r requirements.txt
```

### 2) Configure launcher

Edit [launcher_config.json](launcher_config.json) and fill in:

- `env.DB_USER`, `env.DB_PASSWORD`, `env.DB_NAME` (and optionally host/port)
- `env.CORPORATION_ID`, `env.CEO_CHARACTER_ID`
- `env.EVE_CLIENT_ID`, `env.EVE_CLIENT_SECRET` (needed for token refresh flow)

Alternative (recommended for local/dev): copy `.env.example` to `.env` and fill it.
Both the launcher and `python -m py_backend` will auto-load `<repo>/.env` when present.

Windows (PowerShell):

```powershell
Copy-Item .env.example .env
```

Linux:

```bash
cp .env.example .env
```

Important notes:

- Paths in the config can be relative (recommended). They resolve relative to `repo_path`.
- If your scheduler runs the launcher from a different working directory, either:
	- set `repo_path` to an absolute path to the repo, or
	- configure the scheduler “Start in / Working directory” to the repo root.
- Recommended: run everything from the repo-local venv.
	- Run the launcher with the venv Python.
	- Point `backend_command` to the venv Python (so the backend uses the same dependencies).

Example values:

- Windows: `"backend_command": [".venv/Scripts/python", "-m", "py_backend"]`
- Linux: `"backend_command": [".venv/bin/python", "-m", "py_backend"]`

### 3) Provide CCP SDE JSONL

Blueprint/material calculations require a minimal subset of EVE SDE tables.
This project supports importing them from official CCP SDE JSONL.

Place the JSONL files under the directory configured as `database.sde_import.ccp_jsonl_dir` (default: `py_backend/SDE CCP`).

Notes:

- This repo intentionally does not version-control SDE data. Download/keep the CCP JSONL locally.
- If you store SDE somewhere else, set `database.sde_import.ccp_jsonl_dir` to that folder.

Expected files (minimum):

- `_sde.jsonl` (contains `buildNumber` and `releaseDate`)
- `categories.jsonl`
- `groups.jsonl`
- `types.jsonl`
- `blueprints.jsonl`
- `typeMaterials.jsonl`

On first run (and whenever CCP `buildNumber` changes), the launcher imports/updates the minimal SDE tables in MariaDB.

### 4) Run launcher (watchdog)

Windows (PowerShell):

```powershell
.\.venv\Scripts\python launcher.py --config launcher_config.json
```

Linux:

```bash
./.venv/bin/python launcher.py --config launcher_config.json
```

First run behavior:

- Applies `dbinit.sql` (idempotent).
- Imports/updates minimal SDE from CCP JSONL when needed (based on `_sde.jsonl` `buildNumber`).

## Run (manual)

Install deps (recommended: in repo-local `.venv`):

Windows (PowerShell):

```powershell
.\.venv\Scripts\python -m pip install -r requirements.txt
```

Linux:

```bash
./.venv/bin/python -m pip install -r requirements.txt
```

Set required environment variables (minimum):

- `DB_USER`, `DB_PASSWORD`, `DB_NAME` (optional: `DB_HOST`, `DB_PORT`)
- `CORPORATION_ID`, `CEO_CHARACTER_ID`

Optional environment variables:

- `LOG_LEVEL` (default `2`)
- `ENABLE_SCHEDULER` (default `0`; set to `1` to enable internal cron jobs)
- `EVE_API_BASE` (default `https://esi.evetech.net/latest`)
- `EVE_TOKEN_API` (default `https://login.eveonline.com/v2/oauth/token`)
- `EVE_CLIENT_ID`, `EVE_CLIENT_SECRET` (needed for refresh flow)

Start:

Windows (PowerShell):

```powershell
.\.venv\Scripts\python -m py_backend
```

Linux:

```bash
./.venv/bin/python -m py_backend
```

Server listens on `0.0.0.0:8000`.

### Internal scheduler (optional)

If you set `ENABLE_SCHEDULER=1`, the backend will run two scheduled jobs (timezone UTC) inside the same process:

- 04:00 UTC: industry jobs sync
- 04:15 UTC: wallet journal sync (wallet 1)

If you run the launcher from cron/systemd timers, you typically keep this disabled (`ENABLE_SCHEDULER=0`) and schedule sync separately.

## Database

### Base schema

Base tables are defined in `dbinit.sql` (e.g. `corpAssets`, `corpJobs`, `corpWalletJournal`, `corpWalletTransactions`, `corpUserInfo`, ...).

Important: `dbinit.sql` is intentionally idempotent (uses `CREATE TABLE IF NOT EXISTS` and upserts seeds), so it can be applied multiple times safely.

### SDE tables (required for blueprint calculation)

Blueprint calculations require EVE SDE tables to exist in the same database (examples):

- `invTypes`, `invGroups`, `invCategories`
- `industryActivity`, `industryActivityProducts`, `industryActivityMaterials`
- `industryBlueprints`

These SDE tables are not created by `dbinit.sql`.
Recommended: let the launcher import/update them from CCP JSONL by setting:

- `database.require_sde_tables=true`
- `database.sde_import.ccp_jsonl_dir` to your CCP JSONL directory

The launcher stores imported SDE build info in `sdeVersion` and skips reimport when unchanged.

### MariaDB permissions

If `database.create_database=true`, the configured `DB_USER` must be allowed to create the database.
If you don’t want that, set `create_database=false` and create DB/user manually (example):

```sql
CREATE DATABASE eve CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'eve'@'%' IDENTIFIED BY 'CHANGE_ME';
GRANT ALL PRIVILEGES ON eve.* TO 'eve'@'%';
FLUSH PRIVILEGES;
```

## Run (watchdog / auto-updater)

Use the all-in-one launcher.

- Config: [launcher_config.json](launcher_config.json)
- Run from a scheduler (recommended every 5 minutes)

Windows (PowerShell):

```powershell
.\.venv\Scripts\python launcher.py --config launcher_config.json
```

Linux:

```bash
./.venv/bin/python launcher.py --config launcher_config.json
```

Key behavior (launcher):

- Watchdog: on every run it checks whether backend is running; if not, it starts it.
- DB bootstrap: checks DB connectivity + base schema; if missing, applies `dbinit.sql`.
- SDE enforcement/import: if `database.require_sde_tables=true`, it ensures required SDE tables exist.
	- Preferred: import/update from CCP JSONL when `database.sde_import.ccp_jsonl_dir` is set.
	- Fallback: import from SQL dump via MySQL client when `database.sde_import.sql_path` is set.
- Git auto-update (optional): periodically runs `git fetch` (default 1× per hour). If new remote commit is available, it stops backend, pulls, then restarts.
	- If `requirements.txt` changes, update your venv manually (`python -m pip install -r requirements.txt`).
- Planned restart window: optional daily restart at configured hour/minute (executed only once per day-window).
- Preserve local ignored content: before pulling, it snapshots paths from `preserve_paths` and restores them if they disappear after update.

Linux cron example:

```cron
*/5 * * * * /opt/spacehamsters/backend/.venv/bin/python /opt/spacehamsters/backend/launcher.py --config /opt/spacehamsters/backend/launcher_config.json
```

Linux cron example (repo-local paths, if you keep `repo_path` as `.`):

```cron
*/5 * * * * cd /opt/spacehamsters/backend && ./.venv/bin/python launcher.py --config launcher_config.json
```

Windows Task Scheduler tip:

- Program/script: `<repo>\.venv\Scripts\python.exe`
- Arguments: `launcher.py --config launcher_config.json`
- Start in: `<repo>`

## API overview (high-level)

This is a partial overview to orient you. Exact routes are defined in `py_backend/main.py`.

### Tokens / user info

- `POST /api/userInfo` — store OAuth tokens for a user (used to validate corp membership / refresh CEO token).

### Assets

- `GET /api/corporation/{corporation_id}/assets/sync` — sync corp assets from ESI into DB
- `GET /api/corporation/{corporation_id}/assets/locations/{station_id}` — list “locations” within a station (DB only)
- `POST /api/corporation/{corporation_id}/assets` — list items in a location (DB only)

### Jobs

- `GET /api/corporation/{corporation_id}/jobs/sync` — sync industry jobs from ESI
- `GET /api/corporation/{corporation_id}/jobs/report/{year}/{month}` — jobs report (DB only)

### Wallet

- `GET /api/corporation/{corporation_id}/wallets/{wallet}/journal/sync`
- `GET /api/corporation/{corporation_id}/wallets/{wallet}/transactions/sync`
- `GET /api/corporation/{corporation_id}/wallets/{wallet}/pl/{year}/{month}`
- `GET /api/corporation/{corporation_id}/wallets/{wallet}/volumes`

## Continuous data collection (new data)

Two options:

- Recommended: enable backend scheduler by setting `ENABLE_SCHEDULER=1` in `launcher_config.json`.
	- Backend runs daily sync jobs (industry jobs + wallet journal) using the stored CEO token.
	- See scheduler wiring in `py_backend/main.py`.
- Manual/on-demand: call the sync endpoints from Google Apps Script (see `ZAMEK/SCRIPTS/AubiApi.gs`).

Note: scheduler/ESI sync requires that the CEO OAuth token exists in DB (via `POST /api/userInfo`).

### Blueprints

- `POST /api/blueprints/calculate` — compute jobs + materials for requested output types
- `POST /api/blueprints/{type_id}/calculate` — compute for a single product type

## History migration (from old backend)

New backend now refreshes `corpWalletJournalReportMonthly` and `corpJobsReportMonthly` automatically for months touched by wallet journal/jobs sync, so freshly-synced months keep their monthly history snapshots inside the new backend DB.

Important: this does not reconstruct months that were already missing before sync/snapshot maintenance existed. Older pre-cutover bounty history still requires a one-time backfill into `corpWalletJournalReportMonthly`.

If you did not migrate the old MariaDB, historical monthly reports (jobs history and bounty/ratting) can be restored from the old running backend into snapshot tables.

- Script: [tools/migrate_history_from_old_backend.py](tools/migrate_history_from_old_backend.py)
- Destination tables (created via `dbinit.sql`): `corpJobsReportMonthly`, `corpWalletJournalReportMonthly`

Prerequisites:

- New backend DB must contain CEO refresh token (`corpUserInfo` for `CEO_CHARACTER_ID`) so the script can obtain a valid access token.
- Old backend must be reachable and accept the same corporation membership.

Example:

- `python tools/migrate_history_from_old_backend.py --old-api-base "https://aubi.synology.me:4444/api" --start 2023-01 --end 2026-02`
- If CEO token refresh fails (CCP OAuth 400), pass a currently-valid corp-member token:
	- `python tools/migrate_history_from_old_backend.py --old-api-base "https://aubi.synology.me:4444/api" --start 2023-01 --end 2026-02 --access-token "<ACCESS_TOKEN>"`
		- Must be an **access token** (JWT, looks like `xxx.yyy.zzz`), not a refresh token.
		- If you accidentally include the `Bearer ` prefix, the script will strip it.
- Optional: also import full raw jobs history into `corpJobs`:
	- `python tools/migrate_history_from_old_backend.py --old-api-base "https://aubi.synology.me:4444/api" --start 2023-01 --end 2026-02 --import-raw-jobs`

## Logging

- Backend uses its own logger (`LOG_LEVEL` controls verbosity).
- Launcher can redirect backend stdout/stderr to files using `backend_stdout` and `backend_stderr` in `launcher_config.json`.

## Tests

Run unit tests:

Windows (PowerShell):

```powershell
.\.venv\Scripts\python -m pytest
```

Linux:

```bash
./.venv/bin/python -m pytest
```

Note: some tests expect golden JSON outputs and may depend on deterministic ordering.

## GitHub

To connect this folder to the GitHub remote:

```powershell
Set-ExecutionPolicy -Scope Process Bypass; ./setup_git.ps1
```

Linux:

```bash
chmod +x setup_git.sh
./setup_git.sh
```
