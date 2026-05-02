/**
 * Creates sports_data_fixture_mappings entries for CMS fixtures that have none.
 *
 * Logic:
 *   - Leagues with default_source = 'sports_data'  → POST /auto   (auto-resolves game_id)
 *   - Leagues with no league mapping               → try lsports match first,
 *                                                    fall back to /auto if no match found
 *   - Leagues with default_source = 'lsports'      → match via lsports_schedule_fixtures,
 *                                                    POST /fixtures with explicit game_id
 *
 * UAT internal API base: http://api-internal.uat-frankfurt.pred.app
 */

import pg from "pg";

const { Pool } = pg;

const DB_CONFIG = {
  host: "reader.uat-frankfurt.database.pred.app",
  port: 5432,
  user: "chirag",
  password: "***REMOVED***",
  database: "pred-db",
  ssl: { rejectUnauthorized: false },
};

const API_BASE = "http://api-internal.uat-frankfurt.pred.app";
const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
  if (DRY_RUN) console.log("--- DRY RUN MODE (no API calls will be made) ---\n");

  const pool = new Pool(DB_CONFIG);

  try {
    // 1. All CMS fixtures without a mapping entry
    const { rows: unmapped } = await pool.query(`
      SELECT f.fixture_id, f.name, f.league_id::text, f.game_start_time,
             l.name AS league_name
      FROM fixtures f
      JOIN leagues l ON l.league_id = f.league_id
      LEFT JOIN sports_data_fixture_mappings m ON m.cms_fixture_id = f.fixture_id::text
      WHERE m.cms_fixture_id IS NULL
      ORDER BY f.game_start_time DESC
    `);

    console.log(`Found ${unmapped.length} unmapped fixture(s)\n`);
    if (!unmapped.length) return;

    // 2. League source map: cms_league_id → { default_source }
    const { rows: leagueMappings } = await pool.query(`
      SELECT cms_league_id, default_source FROM sports_data_league_mappings
    `);
    const leagueSourceMap = new Map(leagueMappings.map(r => [r.cms_league_id, r.default_source]));

    // 3. Upcoming lsports fixtures keyed by normalised "home|away|date" for matching
    const { rows: lsportsFixtures } = await pool.query(`
      SELECT fixture_id, home_team_name, away_team_name, start_time, league_id, league_name
      FROM lsports_schedule_fixtures
    `);
    const lsportsIndex = buildLsportsIndex(lsportsFixtures);

    // 4. Process each unmapped fixture
    const results = { auto: [], lsports: [], failed: [] };

    for (const fix of unmapped) {
      const source = leagueSourceMap.get(fix.league_id) ?? null;
      const label = `[${fix.name} | ${fix.league_name} | ${fix.game_start_time?.toISOString?.()?.slice(0,10) ?? "?"}]`;

      if (source === "sports_data" || source === null) {
        // Try lsports match when source is unknown
        const lsportsMatch = source === null
          ? findLsportsMatch(lsportsIndex, fix)
          : null;

        if (lsportsMatch) {
          const ok = await callLsportsEndpoint(fix, lsportsMatch, label, DRY_RUN);
          (ok ? results.lsports : results.failed).push({ fix, lsportsMatch });
        } else {
          // Use auto endpoint (sportsdata or unknown leagues both fall here)
          const ok = await callAutoEndpoint(fix, label, DRY_RUN);
          (ok ? results.auto : results.failed).push({ fix });
        }
      } else if (source === "lsports") {
        const lsportsMatch = findLsportsMatch(lsportsIndex, fix);
        if (!lsportsMatch) {
          console.warn(`  SKIP ${label} — lsports source but no lsports match found`);
          results.failed.push({ fix, reason: "no lsports match" });
          continue;
        }
        const ok = await callLsportsEndpoint(fix, lsportsMatch, label, DRY_RUN);
        (ok ? results.lsports : results.failed).push({ fix, lsportsMatch });
      }
    }

    // 5. Summary
    console.log("\n========== SUMMARY ==========");
    console.log(`  /auto   success : ${results.auto.length}`);
    console.log(`  lsports success : ${results.lsports.length}`);
    console.log(`  failed/skipped  : ${results.failed.length}`);
    if (results.failed.length) {
      console.log("\n  Failed fixtures:");
      for (const { fix, reason } of results.failed) {
        console.log(`    - ${fix.name} (${fix.fixture_id}) — ${reason ?? "API error"}`);
      }
    }
  } finally {
    await pool.end();
  }
}

// ── API callers ───────────────────────────────────────────────────────────────

async function callAutoEndpoint(fix, label, dryRun) {
  const url = `${API_BASE}/api/v1/mappings/internal/fixtures/auto`;
  const body = { cms_fixture_id: fix.fixture_id };
  console.log(`  AUTO   ${label}`);
  if (dryRun) return true;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (res.ok) {
      console.log(`         → ${res.status} OK`);
      return true;
    }
    console.error(`         → ${res.status} ERROR: ${text.slice(0, 200)}`);
    return false;
  } catch (err) {
    console.error(`         → NETWORK ERROR: ${err.message}`);
    return false;
  }
}

async function callLsportsEndpoint(fix, lsportsMatch, label, dryRun) {
  const url = `${API_BASE}/api/v1/mappings/internal/fixtures`;
  const body = {
    cms_fixture_id: fix.fixture_id,
    cms_league_id: fix.league_id,
    game_id: String(lsportsMatch.fixture_id),
    default_source: "lsports",
  };
  console.log(`  LSPORTS ${label} → lsports_id=${lsportsMatch.fixture_id}`);
  if (dryRun) return true;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (res.ok) {
      console.log(`          → ${res.status} OK`);
      return true;
    }
    console.error(`          → ${res.status} ERROR: ${text.slice(0, 200)}`);
    return false;
  } catch (err) {
    console.error(`          → NETWORK ERROR: ${err.message}`);
    return false;
  }
}

// ── LSports matching ──────────────────────────────────────────────────────────

function buildLsportsIndex(rows) {
  const index = new Map();
  for (const r of rows) {
    const key = lsportsKey(r.home_team_name, r.away_team_name, r.start_time);
    if (!index.has(key)) index.set(key, r);
  }
  return index;
}

function findLsportsMatch(index, cmsFix) {
  // CMS fixture name format: "Home vs Away"
  const parts = cmsFix.name.split(/\s+vs\s+/i);
  if (parts.length < 2) return null;
  const home = parts[0].trim();
  const away = parts.slice(1).join(" vs ").trim();
  const key = lsportsKey(home, away, cmsFix.game_start_time);
  return index.get(key) ?? null;
}

function lsportsKey(home, away, dateish) {
  const h = String(home || "").toLowerCase().replace(/\s+/g, " ").trim();
  const a = String(away || "").toLowerCase().replace(/\s+/g, " ").trim();
  const d = dateish instanceof Date
    ? dateish.toISOString().slice(0, 10)
    : String(dateish || "").slice(0, 10);
  return `${h}|${a}|${d}`;
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
