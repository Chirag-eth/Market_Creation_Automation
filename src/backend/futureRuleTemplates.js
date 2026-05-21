// Server-side defaults for Polymarket-sourced league futures. Keyed by
// `future_key` (= Polymarket event slug). The Futures publish drawer prefills
// from this registry; operator can edit the parent_rules / market_rules_template
// per publish. {team} is substituted server-side at render time.
//
// To add a new future type, append an entry below. Missing keys fall back to
// the generic skeleton in getFutureRuleTemplate() so the drawer still renders
// (the operator just sees empty rules fields and must author them by hand).

export const FUTURE_RULE_TEMPLATES = Object.freeze({
  "english-premier-league-winner": {
    title: "EPL: League Winner",
    parent_rules:
      "This market will resolve “Long” if the listed team wins the {season} English Premier League. " +
      "If at any point it becomes impossible for the listed club to win the English Premier League, " +
      'the associated market will resolve to "Short". If the {season} English Premier League season ' +
      "is cancelled, voided, or the winner has not been officially declared, this market will resolve " +
      "based on the last official published Premier League table before cancellation/voiding. " +
      "The resolution source for this market will be official information from the Premier League.",
    market_code_template: "{team} League Winner (EPL)",
    market_rules_template:
      'Resolves to "Long" ($1) if {team} win the {season} English Premier League; otherwise resolves ' +
      'to "Short" ($0). The resolution source for this market will be official information from the ' +
      "Premier League.",
  },
  "uefa-champions-league-team-to-reach-final": {
    title: "UCL: Team to reach final",
    parent_rules:
      "This market will resolve “Long” if the listed team reaches the {season} UEFA Champions League final.\n\n" +
      "If at any point it becomes impossible for the listed club to advance to the UEFA Champions League " +
      'final (e.g. they are mathematically eliminated), the associated market will resolve to "Short".\n\n' +
      "If the {season} UEFA Champions League is cancelled, postponed past its scheduled final or the " +
      "{season} UEFA Champions League final matchup has not been declared within that timeframe, this " +
      "market will resolve to “Short”.\n\nThe resolution source for this market will be official " +
      "information from UEFA.",
    market_code_template: "{team} to reach final (UCL)",
    market_rules_template:
      'Resolves to "Long" ($1) if {team} reach the {season} UEFA Champions League final; otherwise ' +
      'resolves to "Short" ($0). The resolution source for this market will be official information from UEFA.',
  },
});

// Last-resort generic skeleton when the future_key isn't in the registry. The
// operator MUST fill in real rules before publishing — exposed empty so the
// drawer flags missing content.
const GENERIC_FALLBACK = Object.freeze({
  title: "",
  parent_rules: "",
  market_code_template: "{team} ({league})",
  market_rules_template: "",
});

export function getFutureRuleTemplate(futureKey) {
  if (!futureKey) return { ...GENERIC_FALLBACK, _fallback: true };
  const entry = FUTURE_RULE_TEMPLATES[futureKey];
  if (entry) return { ...entry, _fallback: false };
  return { ...GENERIC_FALLBACK, _fallback: true };
}

// Render a template by substituting placeholder tokens. Supports {team},
// {season}, {league}. Tokens not in the substitutions map are left intact so
// callers can layer renders.
export function renderTemplate(tpl, substitutions = {}) {
  if (typeof tpl !== "string" || !tpl) return "";
  return tpl.replace(/\{(team|season|league)\}/g, (match, token) => {
    const value = substitutions[token];
    return value === undefined || value === null ? match : String(value);
  });
}
