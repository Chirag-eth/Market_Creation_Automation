export const submarketGroups = [
  {
    id: 'result',
    label: 'Match Result',
    markets: [
      { id: 'moneyline', label: 'Moneyline' },
    ],
  },
  {
    id: 'handicap',
    label: 'Handicap',
    markets: [
      { id: 'spreads',   label: 'Spreads' },
      { id: 'home_1_5', label: 'Home 1.5' },
      { id: 'away_1_5', label: 'Away 1.5' },
      { id: 'home_2_5', label: 'Home 2.5' },
      { id: 'away_2_5', label: 'Away 2.5' },
    ],
  },
  {
    id: 'goals',
    label: 'Goals O/U',
    markets: [
      { id: 'totals',  label: 'Totals' },
      { id: 'ou_1_5', label: 'O/U 1.5' },
      { id: 'ou_2_5', label: 'O/U 2.5' },
      { id: 'ou_3_5', label: 'O/U 3.5' },
      { id: 'ou_4_5', label: 'O/U 4.5' },
    ],
  },
  {
    id: 'btts',
    label: 'Both Teams Score',
    markets: [
      { id: 'btts', label: 'BTTS' },
    ],
  },
]

export const ALL_SUBMARKET_IDS = submarketGroups.flatMap(g => g.markets.map(m => m.id))
