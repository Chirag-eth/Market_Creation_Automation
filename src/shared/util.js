export function debounce(fn, delayMs) {
  let timer = null;
  return (...args) => {
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => fn(...args), delayMs);
  };
}

export function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function escapeHtmlAttribute(value) {
  return escapeHtml(value).replace(/\n/g, " ").replace(/\r/g, " ");
}

export function normalizeForSearch(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function slugify(value) {
  return normalizeForSearch(value).replace(/\s+/g, "-");
}

export function tokenOverlapScore(a, b) {
  const setA = new Set(String(a || "").split(" ").filter(Boolean));
  const setB = new Set(String(b || "").split(" ").filter(Boolean));
  let overlap = 0;
  for (const token of setA) {
    if (setB.has(token)) {
      overlap += 1;
    }
  }
  return overlap;
}

export function toTitleLike(text) {
  return String(text || "")
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

export function toNullableInteger(value) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) {
    return null;
  }
  const n = Number.parseInt(trimmed, 10);
  return Number.isFinite(n) ? n : null;
}

export function normalizeHexColor(value) {
  const hex = String(value || "").trim();
  if (/^#[0-9a-f]{6}$/i.test(hex)) {
    return hex.toUpperCase();
  }
  return "#FFFFFF";
}

export function generateCodeFromName(name) {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (parts.length === 0) {
    return "TEAM";
  }

  if (parts.length >= 2) {
    return parts
      .slice(0, 3)
      .map((part) => part[0])
      .join("")
      .toUpperCase();
  }

  return parts[0].slice(0, 3).toUpperCase();
}

export function normalizeYear(raw) {
  const y = Number(raw);
  if (String(raw).length === 4) {
    return y;
  }
  return y >= 70 ? 1900 + y : 2000 + y;
}

export function formatYyyyMmDd(year, month, day) {
  if (!year || !month || !day) {
    return null;
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function formatDateMmDdYy(date) {
  return `${String(date.getUTCMonth() + 1).padStart(2, "0")}/${String(date.getUTCDate()).padStart(2, "0")}/${String(date.getUTCFullYear()).slice(-2)}`;
}

export function formatDateTimeMmDdYyHm(date) {
  const datePart = formatDateMmDdYy(date);
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const mm = String(date.getUTCMinutes()).padStart(2, "0");
  return `${datePart} , ${hh}:${mm}`;
}

export function isValidUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}

