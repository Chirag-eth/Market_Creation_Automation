/**
 * Creates sports_data_fixture_mappings entries for CMS fixtures that have none.
 *
 * Strategy:
 *   - lsports leagues: POST /fixtures with explicit lsports_fixture_id (hardcoded below)
 *   - sports_data leagues (EPL): POST /auto (server auto-resolves sportsdata_game_id)
 *   - Skip: 1957 dummy-date fixtures, EFA league, UECL (no lsports data), stale CMS entries
 *
 * Mainnet internal API: http://api-internal.pred.app
 */

const API_BASE = "http://api-internal.pred.app";
const DRY_RUN = process.argv.includes("--dry-run");

// Hardcoded lsports_fixture_id map for fixtures where name-based matching would fail.
// Key: cms_fixture_id (UUID string)
// Value: lsports_fixture_id (number)
//
// Notes:
//   - CMS uses "Heidenheim" for what lsports calls "TSG 1899 Hoffenheim" — same team, CMS data error
//   - Many lsports team names include full suffixes (FC, Calcio, de Vigo, etc.) not in CMS names
const LSPORTS_OVERRIDES = new Map([
  // ── Bundesliga (lsports league_id=65) ──
  ["6356871f-aaf1-446a-ad1a-c5063e284203", 16045120], // Heidenheim vs VfB Stuttgart → Hoffenheim vs VfB Stuttgart
  ["4bca8f95-7675-4f77-a27e-bafa45b4b6f1", 16045144], // Dortmund vs Frankfurt
  ["ca3b6191-853d-4934-8493-fd7687f56347", 16045145], // Heidenheim vs Werder Bremen → Hoffenheim vs SV Werder Bremen
  ["b635e256-ac5a-4d4a-8caf-5076640bf0c2", 16045148], // RB Leipzig vs St.Pauli
  ["52dee6b8-6203-41dc-9322-6a153e00a1c5", 16045150], // VfB Stuttgart vs Leverkusen
  ["3e3153f1-a8b7-4768-96aa-946aa6d1b93e", 16044159], // Augsburg vs Mönchengladbach
  ["4c8a28fe-a055-4da5-bf3e-ecab6247c8e9", 16045149], // Wolfsburg vs Bayern
  ["605ce525-b9c7-467f-b126-9e7dc6aee575", 16045147], // Hamburg vs SC Freiburg
  ["e81c57de-1723-4cb0-8088-3b4b7c99457f", 16045146], // Köln vs Heidenheim
  ["73b2dcdd-634b-40ff-9f04-5052d0f25030", 16045142], // FSV Mainz vs Union Berlin

  // ── La Liga (lsports league_id=8363) ──
  ["21b7b331-9ecb-4c2f-bab7-b5bbf213ac9c", 16086463], // Levante vs Osasuna
  ["51595f0b-9dd7-49d4-8956-0dd76af7e335", 16086467], // Elche vs Alaves
  ["8f6c1012-8df3-44a9-a335-234d650db423", 16086445], // Sevilla vs Espanyol
  ["fb07bcc7-8a89-49df-aa2d-bf85329138f3", 16086470], // Atletico vs Celta
  ["fb2b9b38-bbe6-41ad-a2b8-cd58c1e14a0f", 16086486], // Sociedad vs Betis
  ["935c43d2-7c20-4a00-bff1-7abf91bdcbe0", 16086452], // Mallorca vs Villarreal
  ["62610118-2298-4e64-99d3-464be5f927a2", 16086438], // Athletic vs Valencia
  ["63748147-4346-482b-b568-bcf7c43847b9", 16086465], // Oviedo vs Getafe
  ["7a471b53-a88f-4342-b5cc-e02880d2ff68", 16086460], // Barcelona vs Real Madrid
  ["2dbae72b-754d-41d5-9d1d-9e06b2eb72c1", 16086469], // Rayo vs Girona

  // ── Serie A (lsports league_id=4) ──
  ["9f764735-cfa8-4c1b-b52e-e0ddc05b8dab", 18724775], // Cagliari vs Udinese
  ["0066f868-48e7-4d15-a711-55e601ffd737", 18724815], // Lazio vs Inter
  ["454a4ab5-8d1b-4e0b-8a81-94810ab01734", 18724822], // Lecce vs Juventus
  ["868c6423-8f91-4e47-8afc-e1356772a0d2", 18724810], // Verona vs Como
  ["3e65767e-359d-4025-a3f1-57dc24ee5acc", 18724804], // Cremonese vs Pisa
  ["9070bba8-6ef5-496f-b2ab-17f610f8a0bd", 18724808], // Fiorentina vs Genoa
  ["3a7e43ff-5bb4-4d9d-9687-1a0e59b739ee", 18724845], // Parma vs Roma
  ["da8902a6-49cf-46fc-a6ff-440355e8bd0d", 18724818], // Milan vs Atalanta
  ["ad062fb6-8d82-4f2c-bb47-1452d108cb00", 18724833], // Napoli vs Bologna
]);

// Fixtures to explicitly skip with reason logged
const SKIP_LIST = new Map([
  // 1957-01-01 dummy dates — no real external match can be found
  ["91ba515e-05ef-4f06-8843-087dcfd92e0f", "EPL dummy-date fixture (1957)"],
  ["25468468-9676-4989-a9e2-b8e23b8c0878", "EPL dummy-date fixture (1957)"],
  ["fd49bd66-cb8b-452a-b970-1af5ef53d4dc", "EPL dummy-date fixture (1957)"],
  ["1c500f34-b2e9-4132-9e1d-26d888856020", "EPL dummy-date fixture (1957)"],
  ["19eff7ff-c6ac-4a3c-a2d5-489507472aab", "EPL dummy-date fixture (1957)"],
  ["9be8b598-70e0-4d7d-b97c-6048c3aa14ee", "EPL dummy-date fixture (1957)"],
  ["0916123b-14ac-420a-9e81-c7787879e529", "EPL dummy-date fixture (1957)"],
  ["044fac3c-152f-47cc-9614-23bb9bb41c8d", "EPL dummy-date fixture (1957)"],
  ["f4c02806-892b-4913-8484-da3e72eceb0b", "FIFA friendlies dummy-date fixture (1957)"],
  ["bcdf138c-c650-48b7-afa6-e6a8013672ed", "UCL dummy-date fixture (1957)"],
  ["c5b0bd14-9da2-4160-adf0-02307c468ede", "UCL dummy-date fixture (1957)"],
  // EFA — no league mapping configured
  ["e7802a67-0e6a-48a4-a0bb-125d535de8f9", "EFA league — no sports_data_league_mappings row"],
  // UECL — no lsports data available for Conference League in lsports_schedule_fixtures
  ["8361f24a-3737-467b-a7ac-7456e5bf485c", "UECL — no lsports Conference League data"],
  ["32caebfc-9a5a-43be-a1ef-6b35656226ef", "UECL — no lsports Conference League data"],
  ["adca5b4e-ce3e-4b6a-b235-cf1490467736", "UECL — no lsports Conference League data"],
  ["2d93be0b-606d-496a-9295-9c23636c6201", "UECL — no lsports Conference League data"],
  ["b968ddea-1b76-4d35-b254-3b07c28d89ba", "UECL — no lsports Conference League data"],
  ["16e37104-8cde-4331-8138-1eebb385e463", "UECL — no lsports Conference League data"],
  // Stale CMS data — team no longer in league
  [
    "68b9c9a5-d69e-41df-b2bf-63600d8a174f",
    "Elche vs Valencia — Elche not in La Liga; stale CMS fixture",
  ],
]);

// EPL fixtures that use sports_data source → /auto endpoint
const EPL_AUTO_FIXTURES = new Set([
  "beeeedd2-af1f-44b8-8f95-c8d661a07f24", // Liverpool vs Chelsea
  "5f634410-13f2-45ab-9076-815e6642a24b", // Fulham vs Bournemouth
  "58503607-58a3-4233-a533-0cf3f1200007", // Brighton vs Wolves
  "423194d4-d246-4027-b4c3-f7baa3918dad", // Sunderland vs Man Utd
  "d709112b-b134-4994-aa58-ab4706050e16", // Man City vs Brentford
  "a3667808-8417-40f6-8be5-6b336da248e4", // Crystal Palace vs Everton
  "f5eb9a7a-3fbb-4acf-b422-d37d715d8126", // Burnley vs Aston Villa
  "0a13b00d-4dc6-4844-a640-b12222e1d382", // Nottm Forest vs Newcastle
  "f370bdd3-fd32-4a4a-8d02-bef9a08b7d97", // West Ham vs Arsenal
  "b606ff4b-f192-46d0-8fc3-531c4621e2d3", // Spurs vs Leeds
  "1e4f43d7-309e-480d-8dc3-df1b97d261d0", // Man City vs Aston Villa
]);

// League UUIDs for lsports fixtures (cms_league_id needed for /fixtures endpoint)
const LEAGUE_UUID = {
  bundesliga: "b0828767-10ab-4288-b18d-a6f2f481b2e8",
  laliga: "30c19a6e-da71-4fef-942c-f7cf01fd42e4",
  seriea: "aa0b0d9c-804b-422c-a9c5-8ad8ae737e33",
};

// Map cms_fixture_id → cms_league_id for lsports fixtures
const LSPORTS_LEAGUE_MAP = new Map([
  // Bundesliga
  ["6356871f-aaf1-446a-ad1a-c5063e284203", LEAGUE_UUID.bundesliga],
  ["4bca8f95-7675-4f77-a27e-bafa45b4b6f1", LEAGUE_UUID.bundesliga],
  ["ca3b6191-853d-4934-8493-fd7687f56347", LEAGUE_UUID.bundesliga],
  ["b635e256-ac5a-4d4a-8caf-5076640bf0c2", LEAGUE_UUID.bundesliga],
  ["52dee6b8-6203-41dc-9322-6a153e00a1c5", LEAGUE_UUID.bundesliga],
  ["3e3153f1-a8b7-4768-96aa-946aa6d1b93e", LEAGUE_UUID.bundesliga],
  ["4c8a28fe-a055-4da5-bf3e-ecab6247c8e9", LEAGUE_UUID.bundesliga],
  ["605ce525-b9c7-467f-b126-9e7dc6aee575", LEAGUE_UUID.bundesliga],
  ["e81c57de-1723-4cb0-8088-3b4b7c99457f", LEAGUE_UUID.bundesliga],
  ["73b2dcdd-634b-40ff-9f04-5052d0f25030", LEAGUE_UUID.bundesliga],
  // La Liga
  ["21b7b331-9ecb-4c2f-bab7-b5bbf213ac9c", LEAGUE_UUID.laliga],
  ["51595f0b-9dd7-49d4-8956-0dd76af7e335", LEAGUE_UUID.laliga],
  ["8f6c1012-8df3-44a9-a335-234d650db423", LEAGUE_UUID.laliga],
  ["fb07bcc7-8a89-49df-aa2d-bf85329138f3", LEAGUE_UUID.laliga],
  ["fb2b9b38-bbe6-41ad-a2b8-cd58c1e14a0f", LEAGUE_UUID.laliga],
  ["935c43d2-7c20-4a00-bff1-7abf91bdcbe0", LEAGUE_UUID.laliga],
  ["62610118-2298-4e64-99d3-464be5f927a2", LEAGUE_UUID.laliga],
  ["63748147-4346-482b-b568-bcf7c43847b9", LEAGUE_UUID.laliga],
  ["7a471b53-a88f-4342-b5cc-e02880d2ff68", LEAGUE_UUID.laliga],
  ["2dbae72b-754d-41d5-9d1d-9e06b2eb72c1", LEAGUE_UUID.laliga],
  // Serie A
  ["9f764735-cfa8-4c1b-b52e-e0ddc05b8dab", LEAGUE_UUID.seriea],
  ["0066f868-48e7-4d15-a711-55e601ffd737", LEAGUE_UUID.seriea],
  ["454a4ab5-8d1b-4e0b-8a81-94810ab01734", LEAGUE_UUID.seriea],
  ["868c6423-8f91-4e47-8afc-e1356772a0d2", LEAGUE_UUID.seriea],
  ["3e65767e-359d-4025-a3f1-57dc24ee5acc", LEAGUE_UUID.seriea],
  ["9070bba8-6ef5-496f-b2ab-17f610f8a0bd", LEAGUE_UUID.seriea],
  ["3a7e43ff-5bb4-4d9d-9687-1a0e59b739ee", LEAGUE_UUID.seriea],
  ["da8902a6-49cf-46fc-a6ff-440355e8bd0d", LEAGUE_UUID.seriea],
  ["ad062fb6-8d82-4f2c-bb47-1452d108cb00", LEAGUE_UUID.seriea],
]);

async function main() {
  if (DRY_RUN) console.log("--- DRY RUN MODE (no API calls will be made) ---\n");

  const results = { auto: [], lsports: [], skipped: [], failed: [] };

  // Process lsports fixtures
  for (const [cmsFixtureId, lsportsFixtureId] of LSPORTS_OVERRIDES) {
    const cmsLeagueId = LSPORTS_LEAGUE_MAP.get(cmsFixtureId);
    const ok = await callLsportsEndpoint(cmsFixtureId, cmsLeagueId, lsportsFixtureId, DRY_RUN);
    (ok ? results.lsports : results.failed).push({ cmsFixtureId, lsportsFixtureId });
  }

  // Process EPL auto fixtures
  for (const cmsFixtureId of EPL_AUTO_FIXTURES) {
    const ok = await callAutoEndpoint(cmsFixtureId, DRY_RUN);
    (ok ? results.auto : results.failed).push({ cmsFixtureId });
  }

  // Log skips
  for (const [cmsFixtureId, reason] of SKIP_LIST) {
    console.log(`  SKIP  ${cmsFixtureId} — ${reason}`);
    results.skipped.push({ cmsFixtureId, reason });
  }

  // Summary
  console.log("\n========== SUMMARY ==========");
  console.log(`  lsports success : ${results.lsports.length}`);
  console.log(`  auto    success : ${results.auto.length}`);
  console.log(`  skipped         : ${results.skipped.length}`);
  console.log(`  failed          : ${results.failed.length}`);
  if (results.failed.length) {
    console.log("\n  Failed fixtures:");
    for (const { cmsFixtureId } of results.failed) {
      console.log(`    - ${cmsFixtureId}`);
    }
  }
}

async function callAutoEndpoint(cmsFixtureId, dryRun) {
  const url = `${API_BASE}/api/v1/mappings/internal/fixtures/auto`;
  console.log(`  AUTO    ${cmsFixtureId}`);
  if (dryRun) return true;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cms_fixture_id: cmsFixtureId }),
    });
    const text = await res.text();
    if (res.ok) {
      console.log(`          → ${res.status} OK`);
      return true;
    }
    console.error(`          → ${res.status} ERROR: ${text.slice(0, 300)}`);
    return false;
  } catch (err) {
    console.error(`          → NETWORK ERROR: ${err.message}`);
    return false;
  }
}

async function callLsportsEndpoint(cmsFixtureId, cmsLeagueId, lsportsFixtureId, dryRun) {
  const url = `${API_BASE}/api/v1/mappings/internal/fixtures`;
  const body = {
    cms_fixture_id: cmsFixtureId,
    cms_league_id: cmsLeagueId,
    game_id: String(lsportsFixtureId),
    default_source: "lsports",
  };
  console.log(`  LSPORTS ${cmsFixtureId} → lsports_id=${lsportsFixtureId}`);
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
    console.error(`          → ${res.status} ERROR: ${text.slice(0, 300)}`);
    return false;
  } catch (err) {
    console.error(`          → NETWORK ERROR: ${err.message}`);
    return false;
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
