// Submarket UI groups. Each sport's "default" family set (moneyline + spreads
// + totals, plus BTTS for soccer) is shipped enabled. The remaining families
// are sourced from sportsbook + Polymarket menus and rendered as **disabled**
// rows so operators can see the full menu and request templates; selecting
// them is a no-op until the backend rule template is seeded.

const SOCCER_SUBMARKET_GROUPS = [
  {
    id: "result",
    label: "Match Result",
    markets: [
      { id: "moneyline", label: "Moneyline" },
      { id: "double_chance", label: "Double Chance", disabled: true },
      { id: "draw_no_bet", label: "Draw No Bet", disabled: true },
    ],
  },
  {
    id: "handicap",
    label: "Handicap",
    markets: [
      { id: "home_1_5", label: "Home 1.5" },
      { id: "away_1_5", label: "Away 1.5" },
      { id: "home_2_5", label: "Home 2.5" },
      { id: "away_2_5", label: "Away 2.5" },
      { id: "asian_handicap", label: "Asian Handicap", disabled: true },
    ],
  },
  {
    id: "goals",
    label: "Goals O/U",
    markets: [
      { id: "ou_0_5", label: "O/U 0.5" },
      { id: "ou_1_5", label: "O/U 1.5" },
      { id: "ou_2_5", label: "O/U 2.5" },
      { id: "ou_3_5", label: "O/U 3.5" },
      { id: "ou_4_5", label: "O/U 4.5" },
      { id: "ou_5_5", label: "O/U 5.5" },
      { id: "ou_1h_0_5", label: "1st Half O/U 0.5", disabled: true },
      { id: "ou_1h_1_5", label: "1st Half O/U 1.5", disabled: true },
      { id: "ou_2h_0_5", label: "2nd Half O/U 0.5", disabled: true },
      { id: "ou_2h_1_5", label: "2nd Half O/U 1.5", disabled: true },
    ],
  },
  {
    id: "btts",
    label: "Both Teams Score",
    markets: [
      { id: "btts", label: "BTTS" },
      { id: "btts_1h", label: "BTTS — 1st Half", disabled: true },
      { id: "btts_2h", label: "BTTS — 2nd Half", disabled: true },
    ],
  },
  {
    id: "goal_timing",
    label: "Goal Timing",
    markets: [
      { id: "ht_ft", label: "Half-time / Full-time", disabled: true },
      { id: "first_goalscorer", label: "First Goalscorer", disabled: true },
      { id: "anytime_scorer", label: "Anytime Goalscorer", disabled: true },
      { id: "last_goalscorer", label: "Last Goalscorer", disabled: true },
      { id: "correct_score", label: "Correct Score", disabled: true },
    ],
  },
  {
    id: "team_specials",
    label: "Team Totals & Specials",
    markets: [
      { id: "team_total_home", label: "Home Team Total", disabled: true },
      { id: "team_total_away", label: "Away Team Total", disabled: true },
      { id: "clean_sheet_home", label: "Home Clean Sheet", disabled: true },
      { id: "clean_sheet_away", label: "Away Clean Sheet", disabled: true },
      { id: "win_to_nil_home", label: "Home Win to Nil", disabled: true },
      { id: "win_to_nil_away", label: "Away Win to Nil", disabled: true },
    ],
  },
  {
    id: "cards_corners",
    label: "Cards & Corners",
    markets: [
      { id: "cards_ou_3_5", label: "Cards O/U 3.5", disabled: true },
      { id: "cards_ou_4_5", label: "Cards O/U 4.5", disabled: true },
      { id: "corners_ou_9_5", label: "Corners O/U 9.5", disabled: true },
      { id: "corners_ou_10_5", label: "Corners O/U 10.5", disabled: true },
      { id: "corners_ou_11_5", label: "Corners O/U 11.5", disabled: true },
    ],
  },
];

const NBA_SUBMARKET_GROUPS = [
  {
    id: "result",
    label: "Match Result",
    markets: [{ id: "moneyline", label: "Moneyline" }],
  },
  {
    id: "handicap",
    label: "Handicap",
    markets: [
      { id: "spreads", label: "Spreads (custom line)" },
      { id: "alt_spreads", label: "Alt Spreads", disabled: true },
    ],
  },
  {
    id: "points",
    label: "Points O/U",
    markets: [
      { id: "totals", label: "Totals (custom line)" },
      { id: "alt_totals", label: "Alt Totals", disabled: true },
    ],
  },
  {
    id: "periods",
    label: "Quarter & Half",
    markets: [
      { id: "ml_1h", label: "1st Half Moneyline", disabled: true },
      { id: "spread_1h", label: "1st Half Spread", disabled: true },
      { id: "total_1h", label: "1st Half Total", disabled: true },
      { id: "ml_1q", label: "1st Quarter Moneyline", disabled: true },
      { id: "spread_1q", label: "1st Quarter Spread", disabled: true },
      { id: "total_1q", label: "1st Quarter Total", disabled: true },
    ],
  },
  {
    id: "team_totals",
    label: "Team Totals",
    markets: [
      { id: "team_total_home", label: "Home Team Total", disabled: true },
      { id: "team_total_away", label: "Away Team Total", disabled: true },
      { id: "race_to_20", label: "Race to 20 Points", disabled: true },
    ],
  },
  {
    id: "player_props",
    label: "Player Props",
    markets: [
      { id: "player_points", label: "Player Points O/U", disabled: true },
      { id: "player_rebounds", label: "Player Rebounds O/U", disabled: true },
      { id: "player_assists", label: "Player Assists O/U", disabled: true },
      { id: "player_threes", label: "Player 3-Pointers Made", disabled: true },
      { id: "player_pra", label: "Player Pts + Reb + Ast", disabled: true },
      { id: "player_double_double", label: "Double-Double", disabled: true },
    ],
  },
];

const NFL_SUBMARKET_GROUPS = [
  {
    id: "result",
    label: "Match Result",
    markets: [{ id: "moneyline", label: "Moneyline" }],
  },
  {
    id: "handicap",
    label: "Handicap",
    markets: [
      { id: "spreads", label: "Spreads (custom line)" },
      { id: "alt_spreads", label: "Alt Spreads", disabled: true },
    ],
  },
  {
    id: "points",
    label: "Points O/U",
    markets: [
      { id: "totals", label: "Totals (custom line)" },
      { id: "alt_totals", label: "Alt Totals", disabled: true },
    ],
  },
  {
    id: "periods",
    label: "Quarter & Half",
    markets: [
      { id: "ml_1h", label: "1st Half Moneyline", disabled: true },
      { id: "spread_1h", label: "1st Half Spread", disabled: true },
      { id: "total_1h", label: "1st Half Total", disabled: true },
      { id: "ml_1q", label: "1st Quarter Moneyline", disabled: true },
      { id: "spread_1q", label: "1st Quarter Spread", disabled: true },
      { id: "total_1q", label: "1st Quarter Total", disabled: true },
    ],
  },
  {
    id: "team_totals",
    label: "Team Totals",
    markets: [
      { id: "team_total_home", label: "Home Team Total", disabled: true },
      { id: "team_total_away", label: "Away Team Total", disabled: true },
      { id: "margin_of_victory", label: "Margin of Victory", disabled: true },
    ],
  },
  {
    id: "touchdowns",
    label: "Touchdowns",
    markets: [
      { id: "anytime_td", label: "Anytime TD Scorer", disabled: true },
      { id: "first_td", label: "First TD Scorer", disabled: true },
      { id: "last_td", label: "Last TD Scorer", disabled: true },
      { id: "td_2_or_more", label: "2+ TDs Scorer", disabled: true },
    ],
  },
  {
    id: "player_props",
    label: "Player Props",
    markets: [
      { id: "player_pass_yds", label: "Passing Yards O/U", disabled: true },
      { id: "player_pass_tds", label: "Passing TDs O/U", disabled: true },
      { id: "player_rush_yds", label: "Rushing Yards O/U", disabled: true },
      { id: "player_rec_yds", label: "Receiving Yards O/U", disabled: true },
      { id: "player_receptions", label: "Receptions O/U", disabled: true },
      { id: "player_rush_rec_yds", label: "Rush + Rec Yards", disabled: true },
    ],
  },
];

const SPORT_SUBMARKETS = {
  soccer: SOCCER_SUBMARKET_GROUPS,
  nba: NBA_SUBMARKET_GROUPS,
  nfl: NFL_SUBMARKET_GROUPS,
};

// Popular line shortcuts for sports with operator-picked lines (NBA / NFL).
// Surfaced as toggle chips next to the per-fixture line text inputs in the
// Schedule panel. Soccer doesn't need this — it already has fixed-line
// checkbox buttons (Home 1.5, O/U 2.5, etc.).
const SPORT_POPULAR_LINES = {
  nba: {
    spreads: ["3.5", "5.5", "7.5", "9.5", "11.5"],
    totals: ["210.5", "215.5", "220.5", "225.5", "230.5"],
  },
  nfl: {
    spreads: ["3.5", "6.5", "7.5", "10.5", "13.5"],
    totals: ["40.5", "44.5", "47.5", "50.5", "54.5"],
  },
};

export function getPopularLinesForSport(sportCode) {
  const key = String(sportCode || "")
    .trim()
    .toLowerCase();
  return SPORT_POPULAR_LINES[key] || { spreads: [], totals: [] };
}

export function getSubmarketGroupsForSport(sportCode) {
  const key = String(sportCode || "")
    .trim()
    .toLowerCase();
  return SPORT_SUBMARKETS[key] || SOCCER_SUBMARKET_GROUPS;
}

// Only enabled (templated) markets are real selectable IDs. Disabled rows
// are display-only — they show the sportsbook/Polymarket menu but selecting
// them is a no-op until a backend rule template ships.
export function getAllSubmarketIdsForSport(sportCode) {
  return getSubmarketGroupsForSport(sportCode)
    .flatMap((g) => g.markets)
    .filter((m) => !m.disabled)
    .map((m) => m.id);
}

// Backwards-compat exports for callers that haven't been threaded with a sport
// yet. These default to the soccer set, which matches today's behavior.
export const submarketGroups = SOCCER_SUBMARKET_GROUPS;
export const ALL_SUBMARKET_IDS = SOCCER_SUBMARKET_GROUPS.flatMap((g) => g.markets)
  .filter((m) => !m.disabled)
  .map((m) => m.id);
