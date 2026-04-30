import {
  getDevBatchFixtureCounts,
  getDevBatchMarketRows,
  getDevBatchFixtureDisplayName,
  getDevBatchRunTone,
} from "../selectors.js";

export function renderResultRow(fixture, expandedSet, deps = {}) {
  const escHtml = deps.escapeHtml || ((s) => s);
  const escAttr = deps.escapeHtmlAttribute || ((s) => s);

  const counts = getDevBatchFixtureCounts(fixture);
  const markets = getDevBatchMarketRows(fixture);
  const fixtureKey = String(
    fixture.fixture_key ||
      fixture.event_name ||
      getDevBatchFixtureDisplayName(fixture) ||
      ""
  ).trim();
  const isExpanded = expandedSet instanceof Set ? expandedSet.has(fixtureKey) : false;
  const leagueCode = String(
    fixture?.fixture?.league_code || fixture?.league_code || ""
  ).trim();
  const badgeTone = fixture.row_tone || getDevBatchRunTone(fixture.status);
  const rowDetail = String(
    fixture.row_detail || fixture.reason || fixture.summary || fixture.detail || ""
  ).trim();

  const aggregateBadges = [
    counts.published > 0
      ? `<span class="mini-badge" data-tone="success">Published ${counts.published}</span>`
      : "",
    counts.failed > 0
      ? `<span class="mini-badge" data-tone="error">Failed ${counts.failed}</span>`
      : "",
    counts.blocked > 0
      ? `<span class="mini-badge" data-tone="error">Blocked ${counts.blocked}</span>`
      : "",
    counts.existing > 0
      ? `<span class="mini-badge">Existing ${counts.existing}</span>`
      : "",
    counts.missing > 0
      ? `<span class="mini-badge" data-tone="warn">Missing ${counts.missing}</span>`
      : "",
  ]
    .filter(Boolean)
    .join("");

  const marketRowsHtml = markets
    .map((market) => {
      const marketTone =
        market.tone ||
        (["published", "created", "ready"].includes(market.status)
          ? "success"
          : ["failed", "failed_precheck", "blocked"].includes(market.status)
            ? "error"
            : market.status === "missing"
              ? "warn"
              : "neutral");
      return `<div class="dev-batch-market-row">
        <span class="dev-batch-market-row__key">${escHtml(String(market.publish_key || market.label || "").trim())}</span>
        <span class="mini-badge" data-tone="${escAttr(marketTone)}">${escHtml(market.label || market.status || "idle")}</span>
        ${market.detail ? `<span class="dev-batch-market-row__detail">${escHtml(String(market.detail || "").trim())}</span>` : ""}
      </div>`;
    })
    .join("");

  return `<div class="dev-batch-result-row" data-fixture-key="${escAttr(fixtureKey)}" data-tone="${escAttr(badgeTone)}">
    <div class="dev-batch-result-row__top">
      <div>
        <p class="dev-batch-result-row__title">${escHtml(getDevBatchFixtureDisplayName(fixture))}</p>
        ${leagueCode ? `<div class="dev-batch-result-row__meta">${escHtml(leagueCode)}</div>` : ""}
      </div>
      <span class="mini-badge" data-tone="${escAttr(badgeTone)}">${escHtml(fixture.row_label || fixture.status || "idle")}</span>
    </div>
    ${rowDetail ? `<div class="dev-batch-result-row__meta">${escHtml(rowDetail)}</div>` : ""}
    ${aggregateBadges ? `<div class="dev-batch-aggregate-bar">${aggregateBadges}</div>` : ""}
    ${markets.length ? `<button type="button" class="dev-batch-result-row__expand" data-dev-batch-expand="${escAttr(fixtureKey)}">${isExpanded ? "\u25be" : "\u25b8"} ${markets.length} market${markets.length === 1 ? "" : "s"}</button>` : ""}
    ${markets.length ? `<div class="dev-batch-markets-list${isExpanded ? "" : " dev-batch-markets-list--hidden"}">${marketRowsHtml}</div>` : ""}
  </div>`;
}
