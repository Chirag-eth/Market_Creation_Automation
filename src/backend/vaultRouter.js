// Assigns each fixture to vault 1 or vault 2 based on what other fixtures
// share its game_start_time, balancing the load. Reads/writes the
// fixture_vault_assignments table created by sql/001_fixture_vault_assignments.sql.
//
// Concurrency: a transaction-scoped advisory lock keyed on game_start_time
// serializes all assignments within the same start-time bucket so two
// fixtures kicking off at the same instant always end up split 1-and-2.

export async function assignVaultForFixture(pool, { fixtureId, gameStartTime } = {}) {
  if (!pool || typeof pool.connect !== "function") {
    throw new Error("assignVaultForFixture: pg pool is required");
  }
  if (!fixtureId) {
    throw new Error("assignVaultForFixture: fixtureId is required");
  }
  if (!gameStartTime) {
    throw new Error("assignVaultForFixture: gameStartTime is required");
  }

  const startTimeIso = toIsoString(gameStartTime);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [startTimeIso]);

    const existing = await client.query(
      "SELECT vault_num FROM fixture_vault_assignments WHERE fixture_id = $1",
      [fixtureId]
    );
    if (existing.rows.length > 0) {
      await client.query("COMMIT");
      return { vault: Number(existing.rows[0].vault_num), isNew: false };
    }

    const counts = await client.query(
      `SELECT vault_num, COUNT(*)::int AS c
         FROM fixture_vault_assignments
        WHERE game_start_time = $1::timestamptz
        GROUP BY vault_num`,
      [startTimeIso]
    );
    let v1 = 0;
    let v2 = 0;
    for (const row of counts.rows) {
      if (Number(row.vault_num) === 1) v1 = Number(row.c);
      else if (Number(row.vault_num) === 2) v2 = Number(row.c);
    }
    const candidate = v1 <= v2 ? 1 : 2;

    const inserted = await client.query(
      `INSERT INTO fixture_vault_assignments (fixture_id, game_start_time, vault_num)
       VALUES ($1, $2::timestamptz, $3)
       ON CONFLICT (fixture_id) DO NOTHING
       RETURNING vault_num`,
      [fixtureId, startTimeIso, candidate]
    );
    if (inserted.rows.length > 0) {
      await client.query("COMMIT");
      return { vault: Number(inserted.rows[0].vault_num), isNew: true };
    }

    // Conflict path: another transaction wrote this fixture_id between our
    // existence check and our insert. The advisory lock prevents this within
    // the same start-time bucket, but we read back defensively just in case.
    const fallback = await client.query(
      "SELECT vault_num FROM fixture_vault_assignments WHERE fixture_id = $1",
      [fixtureId]
    );
    await client.query("COMMIT");
    return { vault: Number(fallback.rows[0].vault_num), isNew: false };
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // ignore — original error is more interesting
    }
    throw err;
  } finally {
    client.release();
  }
}

function toIsoString(value) {
  if (value instanceof Date) return value.toISOString();
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return trimmed;
  return parsed.toISOString();
}
