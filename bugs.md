# Bug Log

## BUG-B001 — HTTP 400 on fixture POST (`match_day: "0"` fails ≥ 1 validation)

**Status:** Fixed

### Symptom

Every fixture POST to `/api/v1/cms/internal/fixtures/` returns HTTP 400 `"Invalid request body"` regardless of payload content.

### Confirmed Root Cause

`match_day: "0"` — the CMS API (and `validation.js:45`) enforce `match_day must be a positive integer ≥ 1`. Sending `"0"` (or integer 0) always fails the server-side Pydantic validator. The schedule pipeline never populates `matchday` on fixture objects, so the default fell to "0".

The Unicode-in-name issue was also real (addressed separately) but the `match_day` validator runs first.

### Fix Applied

```js
match_day: String(Math.max(1, Number.parseInt(fixture.matchday || "1") || 1));
match_week: String(Math.max(1, Number.parseInt(fixture.matchWeek || "1") || 1));
```

When no real match day is available from the schedule, defaults to "1" (minimum valid value).

---

## BUG-B001b — Unicode diacritics in fixture `name` field

**Status:** Fixed

### Symptom

Fixtures with non-ASCII team names (UCL, La Liga teams) fail with HTTP 400.

### Root Cause

The `name` field is built from raw SportsData team names **before** catalog resolution:

```js
const homeName = fixture.home || fixture.homeTeamName || "";
const awayName = fixture.away || fixture.awayTeamName || "";
const eventName = [homeName, awayName].filter(Boolean).join(" vs ");
// → "Paris Saint-Germain FC vs FC Bayern München"  ← ü  (non-ASCII)
// → "Club Atlético de Madrid vs Arsenal FC"         ← é  (non-ASCII)
```

SportsData returns international spellings with diacritics. The UAT CMS API validates the `name`
field and rejects non-ASCII characters with 400. The working Postman example ("India vs Pakistan")
uses only ASCII.

The catalog CSV stores ASCII-normalized names:

- `Bayern Munich` / `FC Bayern Munchen` (not München)
- `Atletico` / `Atletico de Madrid` (not Atlético)

The catalog teams are resolved correctly — but `eventName` was computed before resolution using
the raw fixture names.

### Fix Applied

After resolving `homeTeam` and `awayTeam` from the catalog, rebuild `eventName` from the
catalog's ASCII `alternateName` fields in `executeCmsBatchRun` (server.js):

```js
// Use catalog ASCII names, not raw SportsData names
const eventName = `${homeTeam.alternateName || homeTeam.name} vs ${awayTeam.alternateName || awayTeam.name}`;
```

Result: `"Paris Saint-Germain FC vs FC Bayern Munchen"` — fully ASCII.

---

## BUG-B002 — Wrong Atletico team resolved for UCL fixture

**Status:** Fixed (see fix applied below)

### Symptom

```
home → Atletico (2d79273d-506a-4bc5-aa51-45b8ddbe9f92)  ← La Liga Atletico
```

Fixture is UCL but the La Liga Atletico ID is sent. UCL Atletico is `014f6af1`.

### Root Cause

`resolveBatchTeam` uses exact alias matching first, then falls back to substring. "Club Atlético
de Madrid" normalizes to `"club atletico de madrid"` — no alias exactly equals this, so
`candidates` is empty and the sameLeague disambiguation is **never reached**:

```js
const candidates = teamAliasIdx.filter((e) => e.alias === "club atletico de madrid");
// → []  — sameLeague check skipped entirely

// Falls to substring match with find() (first match wins):
// "club atletico de madrid".includes("atletico") = true
// → returns first Atletico in CSV order = La Liga (row 24), not UCL (row 49)
```

### Fix Applied

The partial-match fallback now collects **all** partial matches and prefers same-league:

```js
const partials = teamAliasIdx.filter((e) => e.alias.includes(needle) || needle.includes(e.alias));
if (partials.length === 1) return partials[0].team;
const sameLeaguePartial = partials.find((e) => e.team.leagueId === leagueId);
return sameLeaguePartial?.team || partials[0]?.team || null;
```

---

## BUG-F001 — React frontend changes not visible in browser

**Status:** Fixed
**Branch:** codex/dashboardfrontend

### Symptom

Running `npm run dev` and opening `http://localhost:2020` showed the old vanilla JS "Fixture & Parent Market Builder" UI. Changes to the Builder tab (MarketComposer, TabBar, SchedulePanel) and JSON tab (Event Setup) were invisible.

### Root Causes

1. **Vite never installed.** The React frontend in `frontend/src/` is built with Vite. `package.json` declares `vite` and `@vitejs/plugin-react` as devDependencies but `npm install` was never run after they were added, so `node_modules/.bin/vite` does not exist and `npm run build:frontend` cannot execute.

2. **React app never built.** Even if Vite were installed, `npm run build:frontend` had not been run. The `public/` directory only contained the old `index.html` (vanilla JS shell). The React source in `frontend/src/` had never been compiled into `public/`.

3. **Vite build output mismatch.** `vite.config.js` had `rollupOptions.input: { 'market-ops': 'frontend/index.html' }`. Vite interprets the key as the chunk name and outputs `public/market-ops.html`, not `public/index.html`. The server serves `public/index.html` at `/`, so the built React app would never have been reachable at the root even after a successful build.

4. **Proxy target wrong.** `vite.config.js` had `proxy: { '/api': { target: 'http://localhost:3001' } }` but the backend runs on port **2020** (from `const PORT = parsePositiveIntegerEnv(process.env.PORT, 2020, ...)`). API calls from the Vite dev server would have failed silently.

### Fixes Applied

- `frontend/vite.config.js` — changed `rollupOptions.input` from `{ 'market-ops': 'frontend/index.html' }` to `'frontend/index.html'` so Vite outputs `public/index.html` (which the server already serves at `/`)
- `frontend/vite.config.js` — changed proxy target from `http://localhost:3001` to `http://localhost:2020`

### Completed Fix

Added to `package.json`:

- `vite ^5.4.0` and `@vitejs/plugin-react ^4.3.1` to devDependencies
- `react ^18.3.1` and `react-dom ^18.3.1` to dependencies
- `dev:frontend` and `build:frontend` scripts

Ran `npm install && npm run build:frontend` — React app compiled to `public/index.html + public/assets/`.

For hot-reload development (no rebuild needed on every change):

```bash
# Terminal 1
npm run dev                  # backend on :2020

# Terminal 2
npm run dev:frontend         # Vite HMR on :5173, proxies /api → :2020
# open http://localhost:5173
```

---

## BUG-J001 — `home_team_id` / `away_team_id` null on CMS fixture POST from JSON tab

**Status:** Fixed

### Symptom

Publishing from the JSON tab returns HTTP 400 from the CMS fixture endpoint:

```
{"error":{"message":"team ID is required"}}
```

The fixture preview panel shows `"home_team_id": null, "away_team_id": null`.

### Root Cause

The JSON tab allows free-text team name entry. When the user types a name without selecting
from the autocomplete dropdown, `homePick` / `awayPick` remain `null` in React state.
`buildJsonOutputs` receives empty strings for `home_team_id` / `away_team_id`, which the
server coerces to `null` in the fixture payload. CMS rejects any fixture where either team
ID is absent.

A server-side fallback was patched into `handleJsonPreparePublishRequest` but it only fired
after the fixture was already being posted to CMS — too late — and relied on the server
being restarted between iterations, which hadn't happened.

### Fix

Resolve team IDs from the `teams` table during `handleJsonBuildOutputsRequest` (the
**preview phase**), not at publish time. The fixture payload returned to the frontend
already carries real UUIDs. If resolution fails (team name not in DB), the response
includes `teams_resolved: false`, the UI shows a warning banner, and the Publish button
is disabled until the user picks both teams from the autocomplete.

---

## BUG-S001 — Scheduled publishes on UAT never fire (cms_scheduled_jobs table missing)

**Status:** Diagnosed; user-side migration pending; in-code mitigation applied (startup self-check).
**Filed:** 2026-05-11
**Reporter:** operator scheduled a UAT publish for 17:00 IST today; queue stayed empty, nothing fired.
**Severity:** HIGH for the scheduler feature on UAT (feature non-functional). LOW elsewhere.

### Symptom

Operator clicks **Schedule** in the Builder tab targeting UAT. Modal closes. Header Queue badge stays at 0. At the scheduled time, nothing runs. No row is visible in the queue overlay.

### Direct evidence

```
$ curl -sS "http://127.0.0.1:2120/api/healthz"
{"status":"ok","uptime_seconds":1080,...}

$ curl -sS "http://127.0.0.1:2120/api/integrations/cms/scheduled-jobs?environment=uat"
{"ok":false,"error":"Failed to list scheduled jobs",
 "detail":"relation \"cms_scheduled_jobs\" does not exist"}

$ curl -sS "http://127.0.0.1:2120/api/runtime/environment"
{"active_env":{"code":"uat","label":"UAT"},...}

$ nc -zv reader.uat-frankfurt.database.pred.app 5432  → succeeded
$ nc -zv writer.uat-frankfurt.database.pred.app 5432  → succeeded
```

DB host reachable, auth OK, table missing. Postgres error proves the connection itself is fine — it's a schema problem, not a network problem.

### Root cause

Migration `sql/cms_002_scheduled_jobs.sql` (created 2026-05-10) was applied to the dev DB but **never applied to the UAT DB**.

Behaviour chain when an operator schedules on UAT:

1. Frontend POSTs `/api/integrations/cms/schedule-publish` with `environment=uat`.
2. Server validates envelope, resolves UAT pool, calls `insertScheduledJob(pool, ...)`.
3. The INSERT hits Postgres → `42P01 relation "cms_scheduled_jobs" does not exist`.
4. Server logs `schedulerLog.error "schedule-publish insert failed"` and returns `500 {ok:false, error:"Failed to persist scheduled job", detail:"relation \"cms_scheduled_jobs\" does not exist"}`.
5. Frontend (`App.jsx:310 handleSchedule`) catches and sets `publishError`. The success screen does not render. Nothing is queued.
6. The worker's tick keeps running and silently logs `scheduler claim failed` every 60 s because `claimDueJobs` selects from the same missing table.

### Why the operator missed step 5

- `publishError` is rendered in only one place in the Builder; subsequent UI interactions clear it.
- The header Queue badge reads from `listScheduledJobs`, which also 500s; the frontend defensively falls back to `[]` (`App.jsx:295-301`) and renders 0 — no "broken" indicator.
- Worker errors live in stdout/pino only — no operator-visible surface for scheduler health.

So the failure was loud in the code path (500 + error log) and silent in the UI.

### Why this is bigger than one missing migration

| Gap                                                                                                                                                                                                                                                                                                                                                                           | Impact                                                                        |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| **No migration runner.** Every `sql/*.sql` is applied by hand via `psql -f`. No table tracks "which migrations have been applied to which env."                                                                                                                                                                                                                               | Easy to forget for any env. Will happen again.                                |
| **No startup schema self-check.** Server boots cleanly when the scheduler's backing table is missing.                                                                                                                                                                                                                                                                         | Feature breakage is invisible until the first operator action.                |
| **No scheduler health surface.** Worker tick failures only appear in logs.                                                                                                                                                                                                                                                                                                    | Operator has no signal that the queue is broken; appears "stuck."             |
| **DB_HOST naming inconsistency.** `.env.dev.local` uses `writer.dev-frankfurt`; `.env.uat`/`.env.uat.local`/`.env.mainnet.local` use `reader.X-frankfurt`. Mainnet writes have worked for months, so `reader.*` is almost certainly a pooler that transparently routes writes — but the naming is misleading and a future infra change could silently break every write path. | Latent foot-gun. Not the cause here; not in scope to fix without infra owner. |
| **Test coverage gap (correct-but-incomplete).** Repo/scheduler tests mock the pool. Route tests boot with `DISABLE_DB=1`. No suite exercises against a real Postgres with the expected schema.                                                                                                                                                                                | "Tests pass" does not imply "deploy is safe."                                 |
| **Frontend error rendering is too quiet.** A 500 from `schedule-publish` results in a transient `publishError` toast that's easy to miss.                                                                                                                                                                                                                                     | Operator believes the schedule was created.                                   |

### Fix plan

| #   | Fix                                                                                                                                                                                                                                                                                 | Owner                                                         | Status              |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ------------------- |
| 1   | Apply `sql/cms_002_scheduled_jobs.sql` to UAT writer. Idempotent (`IF NOT EXISTS` everywhere). Verify with `\d cms_scheduled_jobs`.                                                                                                                                                 | USER (strict UAT DB write rule — needs explicit confirmation) | Pending             |
| 2   | Add a startup self-check inside `cmsScheduler.js`: when `SCHEDULER_ENABLED !== "0"` and a pool resolves, run `SELECT 1 FROM cms_scheduled_jobs LIMIT 0` once. On error, log a prominent warning and expose the failure via `scheduler.isHealthy()` / `scheduler.lastSchemaError()`. | ME                                                            | Applied this commit |
| 3   | Add `GET /api/integrations/cms/scheduler-health` returning `{ok, lastTickAt, lastError, schemaError}`. Frontend queue overlay shows a banner if `ok=false`.                                                                                                                         | ME, follow-up                                                 | Backlog             |
| 4   | Promote `publishError` from transient toast to persistent banner on Builder until operator dismisses or starts new schedule.                                                                                                                                                        | ME, follow-up                                                 | Backlog             |
| 5   | Migration runner: track applied migrations in a `schema_migrations` table; integrate into `scripts/start.mjs`. README section: "before deploying, apply any new `sql/*.sql` to each target env."                                                                                    | Backlog                                                       | Not started         |

### Recommended action order

1. **Now, user:** apply the migration to UAT writer.
   ```bash
   psql "postgresql://chirag@writer.uat-frankfurt.database.pred.app:5432/pred-db?sslmode=require" \
     -f sql/cms_002_scheduled_jobs.sql
   psql "<same conn>" -c '\d cms_scheduled_jobs'
   ```
2. **Now, me:** Fix #2 (startup self-check) — code-only, safe, makes the next missing migration screaming-loud.
3. **Later, on request:** Fix #3 and Fix #4.
4. **Backlog:** Fix #5.

### Operator note

The earlier "fired" job did **not** persist; the INSERT failed before the row was written. After the migration is applied, re-fire the schedule from the Builder. The worker ticks every 60 s, so a 17:00 schedule will fire on the first tick after 17:00:00 IST.
