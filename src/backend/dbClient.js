import pg from "pg";

const { Pool } = pg;

let _pool = null;
const _schemaCache = new WeakMap();
const DB_SCHEMA_CACHE_TTL_MS = 60_000;

export function createDbPool(env = {}) {
  const host = String(env.DB_HOST || "").trim();
  const port = parseInt(String(env.DB_PORT || "5432").trim(), 10) || 5432;
  const user = String(env.DB_USER || "").trim();
  const password = String(env.DB_PASSWORD || "").trim();
  const database = String(env.DB_NAME || "").trim();
  const ssl = String(env.DB_SSL || "").trim();

  if (!host || !user || !database) return null;

  const pool = new Pool({
    host,
    port,
    user,
    password,
    database,
    ssl: ssl === "true" ? { rejectUnauthorized: false } : false,
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 20_000,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
    query_timeout: 20_000,
    statement_timeout: 20_000,
  });

  // Prevent idle-client network errors from crashing the process.
  pool.on("error", (err) => {
    console.warn(`[db-pool] idle client error (host=${host}):`, err.message);
  });

  return pool;
}

export function getDbPool() {
  return _pool;
}

export function setDbPool(pool) {
  _pool = pool;
}

export async function queryDb(sql, params = []) {
  if (!_pool) throw new Error("No database connection configured for this environment.");
  const result = await _pool.query(sql, params);
  return result.rows;
}

export async function discoverSchema(pool) {
  const client = pool || _pool;
  if (!client) throw new Error("No database connection configured.");
  const cached = _schemaCache.get(client);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.schema;
  }
  const result = await client.query(`
    SELECT table_name, column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = 'public'
    ORDER BY table_name, ordinal_position
  `);

  const tables = {};
  for (const row of result.rows) {
    if (!tables[row.table_name]) tables[row.table_name] = [];
    tables[row.table_name].push({ column: row.column_name, type: row.data_type });
  }
  _schemaCache.set(client, {
    expiresAt: Date.now() + DB_SCHEMA_CACHE_TTL_MS,
    schema: tables,
  });
  return tables;
}
