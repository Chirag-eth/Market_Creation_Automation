export function extractTeamNameFromSpreadTitle(marketTitle) {
  const title = String(marketTitle || "").trim();
  if (!title) return "";
  const match = title.match(/^(.+?)\s+[+-]\d+(?:\.\d+)?(?:\s|$)/);
  if (match && match[1]) {
    return match[1].trim();
  }
  return "";
}

export function buildSpreadMarketTooltip(fixture, spreadLine) {
  if (!fixture || !spreadLine) return "";

  const homeTeam = String(fixture.homeTeamName || fixture.home || "").trim();
  const awayTeam = String(fixture.awayTeamName || fixture.away || "").trim();

  if (!homeTeam || !awayTeam) return "";

  return `Home: ${homeTeam}\nAway: ${awayTeam}\nLine: ±${spreadLine}`;
}

export function getSpreadMarketLabel(fixture, spreadLine, isAway = false) {
  const homeTeam = String(fixture.homeTeamName || fixture.home || "").trim();
  const awayTeam = String(fixture.awayTeamName || fixture.away || "").trim();
  const side = isAway ? awayTeam : homeTeam;

  if (!side) {
    return `${isAway ? "Away" : "Home"} ±${spreadLine}`;
  }

  return `${side} ±${spreadLine}`;
}
