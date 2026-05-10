# Fixture & Parent Market Verifier

Standalone dashboard to:

1. Verify incoming fixture JSON and parent market JSON against CSV source-of-truth data
2. Generate fixture and parent market payloads from event input
3. Load upcoming fixtures from SportsData schedule endpoints by league
4. Apply fetched fixtures directly into the builder and generate verified payloads

## Run locally (CSV source of truth)

Start the included server:

```bash
npm start
```

Optional: copy `.env.example` to `.env` and fill any values you want to override.

Environment-specific files are also supported:

```bash
npm run start:mainnet
npm run start:uat
```

This keeps env selection explicit:

- `npm run start:mainnet` runs the app in `Mainnet` mode
- `npm run start:uat` runs the app in `UAT` mode and loads `/Users/chirag/Desktop/Market_Making/.env.uat` first, then fills any missing values from `/Users/chirag/Desktop/Market_Making/.env`

Committed env files should stay portable:

- keep secrets like `SPORTSDATA_API_KEY` out of the repo
- prefer repo-relative CSV paths such as `catalog/leagues-main.csv`
- use your shell environment or an untracked local `.env` for machine-specific secrets

Then open:

`http://localhost:2020`

Default CSV source:

- `catalog/leagues-main.csv`
- `catalog/teams-main.csv`

The server also falls back to `catalog/leagues.csv` / `catalog/teams.csv` if those are the files present in another checkout.

Optional overrides:

```bash
LEAGUES_CSV_PATH=/path/to/leagues.csv TEAMS_CSV_PATH=/path/to/teams.csv node server.js
```

You can also point to a specific env file directly:

```bash
ENV_FILE=/path/to/.env.uat node server.js
```

The active env choice is exposed in `/api/catalog/meta` under:

- `source.environment.app_env`
- `source.environment.env_file`

Optional supplemental CSVs are merged only when you explicitly configure them:

```bash
EXTRA_LEAGUES_CSV_PATHS=/path/to/extra-leagues.csv EXTRA_TEAMS_CSV_PATHS=/path/to/extra-teams.csv node server.js
```

Optional machine-local fallback to `~/Downloads` if `catalog/` files are unavailable:

```bash
ALLOW_DOWNLOADS_CSV_FALLBACK=1 node server.js
```

Optional API protection (for public deployment prep):

```bash
API_BEARER_TOKEN=your_secret_token node server.js
```

When set, `/api/*` requires `Authorization: Bearer your_secret_token`.

Optional API rate limit tuning:

```bash
API_RATE_MAX_REQUESTS=180 API_RATE_WINDOW_MS=60000 node server.js
```

If deployed behind a reverse proxy/load balancer, enable trusted forwarded IP parsing:

```bash
TRUST_PROXY=1 node server.js
```

Optional static dashboard protection:

```bash
APP_BASIC_AUTH_USER=admin APP_BASIC_AUTH_PASS=change_me node server.js
```

When set, all non-API pages require HTTP Basic authentication.

## CMS publish integration

The server can publish generated payloads directly to the CMS chain:

1. `POST /api/v1/cms/internal/fixtures/`
2. `POST /api/v1/cms/internal/type-reference`
3. `POST /api/v1/cms/internal/parent-and-market/`

Configure the active environment with:

```bash
COMP_SERVICE_INTERNAL_HOST=https://your-comp-service.internal
COMP_SERVICE_INTERNAL_BEARER_TOKEN=replace_with_internal_token
CMS_PUBLISH_TIMEOUT_MS=8000
```

The dashboard/backend route is:

- `POST /api/cms/publish`

You can call it either with direct payloads:

```json
{
  "fixture_payload": { "...": "..." },
  "type_reference_payload": { "...": "..." },
  "parent_market_payload": { "...": "..." }
}
```

Or with the generated-output shape already used by the app:

```json
{
  "fixture_json": { "...": "..." },
  "type_reference_payloads": {
    "fixture": { "...": "..." }
  },
  "uat_parent_payloads": {
    "moneyline": { "...": "..." }
  },
  "parent_market_family": "moneyline"
}
```

Response shape:

- `ok`
- `failed_step`
- `requested_family`
- `environment`
- `steps`

Each entry in `steps` contains:

- `key`
- `ok`
- `status`
- `url`
- `response`

Health endpoint (for load balancers/uptime checks):

- `GET /api/healthz`
- `GET /api/readyz` (checks CSV source availability/readiness)

OpenAPI docs:

- `GET /api/openapi.json`
- `GET /api/openapi.yaml`
- `GET /api/docs` (ReDoc UI)

## Vault-Automation post-publish hook

When `VAULT_AUTOMATION_HOST` is set, every successful CMS publish (selected
or batch) auto-syncs Polymarket-sourced fixtures to the matching market-making
vault via `pred-polymarket-http`'s `POST /api/v1/polymarket/sync-fixture`.
Non-Polymarket fixtures (sportsdata, lsports) are silently skipped — they
have no Polymarket URL to sync. Vault-sync failures are surfaced in
`runRecord.vault_sync` (or `record.fixtures[].vault_sync` for batch) without
demoting the publish itself.

**One-time DB migration**. Each environment needs the assignments table:

```bash
psql "$DB_URL" -f sql/001_fixture_vault_assignments.sql
```

The table tracks which vault (1 or 2) each fixture was routed to. New
assignments load-balance across vaults within the same `game_start_time`,
so two fixtures kicking off at the same instant land on different vaults.

**Configuration** (env vars, per profile):

```bash
VAULT_AUTOMATION_HOST=http://127.0.0.1:8080  # leave empty to disable
VAULT_AUTOMATION_TIMEOUT_MS=8000
VAULT_AUTOMATION_RETRY_COUNT=1               # retries on 5xx / network only
VAULT_AUTOMATION_DRY_RUN=0
```

Real per-environment hosts go in `.env.<profile>.local` (gitignored). Tracked
profile templates leave `VAULT_AUTOMATION_HOST` empty.

**Deployment prerequisite**. `pred-polymarket-http` (the Vault-Automation
HTTP service) must be running and reachable from Market_Making at
`VAULT_AUTOMATION_HOST`. See `/Users/chirag/Desktop/Vault-Automation /` —
note the trailing space in the directory name.

## Scheduled publishes (DB-backed)

Operators schedule a batch publish for a future time via the dashboard
(Fixtures tab → Review → "Schedule for later"). Jobs persist in the
`cms_scheduled_jobs` table; an in-process worker (`src/backend/cmsScheduler.js`)
polls every minute and fires due jobs through the existing
`executeCmsBatchRun` path.

**One-time DB migration** — apply per environment, dev first:

```bash
psql "$DB_URL" -f sql/cms_002_scheduled_jobs.sql
```

**HTTP endpoints**:

- `POST /api/integrations/cms/schedule-publish` — same envelope as
  `batch-publish` plus `payload.scheduled_at` (ISO 8601 UTC, must be in the
  future). Validates `payload.confirmation.confirmed === true`.
- `GET  /api/integrations/cms/scheduled-jobs?environment=<code>&status=<status>`
- `GET  /api/integrations/cms/scheduled-jobs/:id`
- `POST /api/integrations/cms/scheduled-jobs/:id/cancel` — only pending jobs
  can be cancelled.
- `POST /api/integrations/cms/scheduled-jobs/:id/reschedule` — body
  `{ scheduled_at }`; only pending jobs.

**Configuration** (env vars):

```bash
SCHEDULER_ENABLED=1            # set to 0 to disable the worker (tests do this)
SCHEDULER_TICK_INTERVAL_MS=60000
SCHEDULER_BATCH_SIZE=5         # max jobs claimed per tick
DISABLE_DB=0                   # 1 forces getDbPoolForEnv to return null (test escape hatch)
```

**Concurrency**. `claimDueJobs` uses `SELECT ... FOR UPDATE SKIP LOCKED` so
multiple replicas (or restarts mid-tick) cannot double-fire the same job.
The worker also re-entrancy-guards itself within a process: an overlapping
tick is skipped rather than running concurrently.

**Env safety**. The worker only fires jobs whose `environment` matches the
active runtime env. Jobs scheduled for a different env sit until that env
becomes active. Switching APP_ENV at runtime is therefore safe.

## Docker (optional phase 1 deployment packaging)

Build and run:

```bash
docker build -t fixture-ocr-market-builder .
docker run --rm -p 2020:2020 fixture-ocr-market-builder
```

## Run regression tests

```bash
npm test
```

`tests/browser.e2e.test.mjs` runs only when Playwright is installed; otherwise it is skipped automatically.

## Code quality tooling

```bash
npm run lint
npm run lint:fix
npm run format:check
npm run format
```

Pre-commit checks are enforced with Husky + lint-staged.

## CI

GitHub Actions workflow is included at:

- `.github/workflows/ci.yml`

Code review process:

- `docs/code-review-process.md`
- `.github/pull_request_template.md`
- `.github/CODEOWNERS`

## Project structure

- `/Users/chirag/Desktop/Market_Making/public/` served UI shell, styles, and browser assets
- `/Users/chirag/Desktop/Market_Making/src/` application modules (`app/`, `core/`, `data/`, `shared/`)
- `/Users/chirag/Desktop/Market_Making/src/server/` server MVC modules (services/controllers/routes as they are extracted)
- `/Users/chirag/Desktop/Market_Making/catalog/` CSV source-of-truth files
- `/Users/chirag/Desktop/Market_Making/tests/` unit, server, and browser regression tests
- `/Users/chirag/Desktop/Market_Making/archive/legacy/` archived pre-modular code kept for reference
- `/Users/chirag/Desktop/Market_Making/server.js` static/API server

## Notes

- Team IDs and league IDs are loaded from the workspace catalog pair the server finds first, preferring `catalog/leagues-main.csv` and `catalog/teams-main.csv`.
- Schedule browsing uses SportsData-backed endpoints via the server.
- The server serves UI files from `public/` and application modules from `src/`.
- Deterministic schedule snapshots and theme/input preferences are persisted in the browser for operator continuity.
