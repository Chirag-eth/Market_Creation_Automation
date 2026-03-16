const MAX_DEBUG_LOGS = 600;

const store = {
  entries: [],
};

function pushEntry(entry) {
  store.entries.push(entry);
  if (store.entries.length > MAX_DEBUG_LOGS) {
    store.entries.splice(0, store.entries.length - MAX_DEBUG_LOGS);
  }
  if (typeof window !== "undefined") {
    window.__fixtureDebugLogs = store.entries;
  }
}

function serializeDetails(details) {
  if (details === undefined) {
    return "";
  }
  try {
    return JSON.stringify(details, (_, value) => {
      if (value instanceof Error) {
        return {
          name: value.name,
          message: value.message,
          stack: value.stack,
        };
      }
      if (typeof value === "bigint") {
        return String(value);
      }
      return value;
    });
  } catch {
    return String(details);
  }
}

function write(level, scope, event, details) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    scope,
    event: String(event || "unknown_event"),
    details: serializeDetails(details),
  };
  pushEntry(entry);

  const line = `[${entry.ts}] [${scope}] ${entry.event}${entry.details ? ` ${entry.details}` : ""}`;
  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export function createLogger(scope) {
  const tag = String(scope || "app");
  return {
    debug(event, details) {
      write("debug", tag, event, details);
    },
    info(event, details) {
      write("info", tag, event, details);
    },
    warn(event, details) {
      write("warn", tag, event, details);
    },
    error(event, details) {
      write("error", tag, event, details);
    },
  };
}

export function clearDebugLogs() {
  store.entries = [];
  if (typeof window !== "undefined") {
    window.__fixtureDebugLogs = store.entries;
  }
}

export function getDebugLogs() {
  return [...store.entries];
}

export function formatDebugLogs(entries = getDebugLogs()) {
  return (Array.isArray(entries) ? entries : [])
    .map((entry) => {
      const parts = [`[${entry.ts || "unknown-ts"}]`, `[${entry.level || "info"}]`, `[${entry.scope || "app"}]`, entry.event || "unknown_event"];
      if (entry.details) {
        parts.push(String(entry.details));
      }
      return parts.join(" ");
    })
    .join("\n");
}
