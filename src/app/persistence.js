const STORAGE_KEY = "fixture-ocr-market-builder-state-v1";
const THEME_STORAGE_KEY = "fixture-ocr-market-builder-theme-v1";

export function saveSnapshot(snapshot) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

export function loadSnapshot() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function clearSnapshot() {
  try {
    localStorage.removeItem(STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

export function saveThemePreference(theme) {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, String(theme || "light"));
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

export function loadThemePreference() {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    if (!raw) {
      return "";
    }
    return String(raw);
  } catch {
    return "";
  }
}
