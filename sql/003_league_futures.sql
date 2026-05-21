-- Stores league-level futures (title winner, top scorer, top-4, relegation, etc.)
-- sourced from Polymarket. Distinct from parent_markets which are fixture-bound.
--
-- Outcomes are stored as JSONB to absorb Polymarket's flexible market shape:
--   [{ name, polymarket_market_id, polymarket_condition_id, probability, image, closed }]
--
-- Idempotency is enforced via the (league_code, season, future_key) unique index;
-- re-publish of the same future is a no-op surfaced as `status: "existing"` to
-- the caller (mirrors the duplicate-canonical-name pattern used for fixture publish).
--
-- Dev DB only for v1. Apply once per environment when expanded beyond dev:
--   psql "$DB_URL" -f sql/003_league_futures.sql

CREATE TABLE IF NOT EXISTS league_futures (
  future_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_code TEXT NOT NULL,
  season TEXT NOT NULL,
  future_key TEXT NOT NULL,
  title TEXT NOT NULL,
  polymarket_event_id TEXT,
  polymarket_slug TEXT,
  end_date TIMESTAMPTZ,
  outcomes JSONB NOT NULL,
  cms_type_reference_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (league_code, season, future_key)
);

CREATE INDEX IF NOT EXISTS idx_league_futures_league_season
  ON league_futures (league_code, season);

CREATE INDEX IF NOT EXISTS idx_league_futures_polymarket_event_id
  ON league_futures (polymarket_event_id);
