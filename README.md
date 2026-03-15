# Fixture OCR Market Builder

Standalone dashboard to:

1. Upload a fixture image
2. Run OCR in-browser (single or multiple fixtures in one image)
3. Generate fixture JSON for all detected fixtures
4. Choose a fixture to load into the editor
5. Generate a single parent market payload or bulk-generate multiple parent market payloads using multiple `type_reference_id` values

## Run locally (CSV source of truth)

Start the included local server:

```bash
npm start
```

Optional: copy `.env.example` to `.env` and fill any values you want to override.

Then open:

`http://localhost:2020`

Default CSV source:

- `Info-source/leagues.csv`
- `Info-source/teams.csv`

Optional overrides:

```bash
LEAGUES_CSV_PATH=/path/to/leagues.csv TEAMS_CSV_PATH=/path/to/teams.csv node server.js
```

Optional local-only fallback to `~/Downloads` if `Info-source/` files are unavailable:

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

Health endpoint (for load balancers/uptime checks):

- `GET /api/healthz`
- `GET /api/readyz` (checks CSV source availability/readiness)

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

## CI

GitHub Actions workflow is included at:

- `.github/workflows/ci.yml`

## Project structure

- `/Users/chirag/Desktop/Market_Making/src/` active frontend modules (`main.js`, `ui.js`, parser/OCR/catalog/market helpers)
- `/Users/chirag/Desktop/Market_Making/index.html` dashboard shell
- `/Users/chirag/Desktop/Market_Making/styles.css` dashboard styles
- `/Users/chirag/Desktop/Market_Making/server.js` local static server + CSV catalog API
- `/Users/chirag/Desktop/Market_Making/legacy/app.js` archived pre-modular monolith (not used)

## Notes

- OCR is client-side (`tesseract.js`) and runs CDN/browser-first for speed, with local `node_modules` OCR assets as fallback.
- If OCR still fails, check that `npm install` was run and restart the server so fallback OCR worker/lang assets are available.
- Team IDs and league IDs are loaded from `leagues.csv` and `teams.csv` (source of truth).
- Multi-fixture images are supported for both `vs`/`v` separator text and row/lane schedule boards without separators.
- When OCR detects multiple fixtures, use the fixture multi-select dropdown to choose which fixtures to generate in batch.
- You can also select/unselect fixtures directly from row checkboxes in the review queue (selection stays in sync with the dropdown).
- The dropdown supports click-to-toggle multi-selection without requiring Cmd/Ctrl modifiers.
- Use the fixture filter input above the dropdown to narrow long fixture lists quickly.
- If OCR-derived date/time/timezone are not confidently detected, the row is flagged `Needs Review` and blocked until confirmed/approved.
- You can convert all selected fixtures to UTC in one action using **Convert Selected Fixtures To UTC**.
- Parent market JSON previews are generated automatically from fixture metadata, even before `type_reference_id` is entered.
- When a valid `type_reference_id` is entered, parent market `type_reference_id` and canonical/code suffixes update automatically.
- Parent market payload follows the strict CMS shape with top-level `parent_market` and `markets` arrays.
- Fixture and parent generation now block with field-specific validation errors if required inputs are missing (for example: missing date, kickoff time, match day, or CSV team/league mapping).
- Use **Copy Debug Log** in the OCR section to export timestamped UI/OCR action logs for failure triage.
- Optional strict publish mode can hard-block bulk output until all selected fixtures are approved and date/time/timezone-confirmed.
- Bulk mapped type-reference input supports quoted labels with commas, e.g. `"Wolves, FC vs Aston Villa",<uuid>`.
- For unconfigured teams, use the **Team Mapping Overrides** section to fill IDs / codes / logos manually.
