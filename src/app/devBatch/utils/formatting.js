/**
 * Format a fixture date/time for display.
 */
export function formatFixtureTime(fixtureDate, kickoffTimeUtc) {
  const date = String(fixtureDate || "").trim();
  const time = String(kickoffTimeUtc || "").trim();
  if (!date && !time) return "\u2014";
  if (!time) return date;
  return `${date} ${time} UTC`.trim();
}

/**
 * Format a market key for human-readable display.
 * e.g. "totals|2.5" → "Totals 2.5"
 */
export function formatMarketKey(key) {
  const [family = "", line = "", side = ""] = String(key || "")
    .trim()
    .toLowerCase()
    .split("|");
  const parts = [
    family.charAt(0).toUpperCase() + family.slice(1),
    line && line !== "0" ? line : "",
    side ? (side.charAt(0).toUpperCase() + side.slice(1)) : "",
  ].filter(Boolean);
  return parts.join(" ");
}
