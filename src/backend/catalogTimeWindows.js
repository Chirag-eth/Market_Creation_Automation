export function normalizeLeagueStartWindows(rows, { now = new Date(), minFutureLeadMs = 60_000 } = {}) {
  const nowDate = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date();
  const futureThreshold = new Date(nowDate.getTime() + Math.max(1, Number(minFutureLeadMs) || 60_000));

  return (Array.isArray(rows) ? rows : []).map((row) => normalizeLeagueStartWindow(row, { futureThreshold }));
}

export function normalizeLeagueStartWindow(row, { futureThreshold }) {
  if (!row || typeof row !== "object") {
    return row;
  }

  const startRaw = String(row.start || "").trim();
  if (!startRaw) {
    return { ...row };
  }

  const parsedStart = parseCatalogTimestamp(startRaw);
  if (!parsedStart || parsedStart.getTime() > futureThreshold.getTime()) {
    return { ...row };
  }

  return {
    ...row,
    source_start: startRaw,
    start: formatCatalogTimestamp(futureThreshold),
    start_adjusted: "1",
  };
}

export function parseCatalogTimestamp(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) {
    return null;
  }

  const normalized = /\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}[+-]\d{2}$/.test(trimmed)
    ? `${trimmed}:00`
    : trimmed.replace(" ", "T");
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function formatCatalogTimestamp(date) {
  const parsed = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }

  const yyyy = String(parsed.getUTCFullYear()).padStart(4, "0");
  const mm = String(parsed.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(parsed.getUTCDate()).padStart(2, "0");
  const hh = String(parsed.getUTCHours()).padStart(2, "0");
  const mi = String(parsed.getUTCMinutes()).padStart(2, "0");
  const ss = String(parsed.getUTCSeconds()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}+00`;
}
