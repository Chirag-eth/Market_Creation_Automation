-- Tracks which vault (1 or 2) each CMS fixture's vault sync was routed to.
-- Read by src/backend/vaultRouter.js to load-balance new fixtures across
-- vaults within the same game_start_time bucket. Apply once per environment:
--   psql "$DB_URL" -f sql/001_fixture_vault_assignments.sql

CREATE TABLE IF NOT EXISTS fixture_vault_assignments (
  fixture_id UUID PRIMARY KEY,
  game_start_time TIMESTAMPTZ NOT NULL,
  vault_num SMALLINT NOT NULL CHECK (vault_num IN (1, 2)),
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fixture_vault_assignments_start_time
  ON fixture_vault_assignments (game_start_time, vault_num);
