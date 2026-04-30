export async function resolveSchedulePayloadWithFallback({
  loadSportsData,
  loadLsportsDb,
  loadPolymarket,
  loadLsportsCsv,
} = {}) {
  let sportsDataError = null;

  try {
    const payload = await loadSportsData?.();
    if (hasSchedulePayload(payload)) {
      return payload;
    }
  } catch (error) {
    sportsDataError = error;
  }

  try {
    const payload = await loadLsportsDb?.();
    if (hasSchedulePayload(payload)) {
      return payload;
    }
  } catch {
    // fall through to polymarket
  }

  try {
    const payload = await loadPolymarket?.();
    if (hasSchedulePayload(payload)) {
      return payload;
    }
  } catch {
    // fall through to lsports CSV
  }

  const csvPayload = await loadLsportsCsv?.();
  if (hasSchedulePayload(csvPayload)) {
    return csvPayload;
  }

  if (sportsDataError) {
    throw sportsDataError;
  }
  throw new Error("No schedule source produced a payload.");
}

export async function resolveRawScheduleRowsWithFallback({
  loadSportsData,
  loadLsportsDb,
  loadPolymarket,
  loadLsportsCsv,
} = {}) {
  let sportsDataError = null;

  try {
    const rows = await loadSportsData?.();
    if (hasScheduleRows(rows)) {
      return rows;
    }
  } catch (error) {
    sportsDataError = error;
  }

  try {
    const rows = await loadLsportsDb?.();
    if (hasScheduleRows(rows)) {
      return rows;
    }
  } catch {
    // fall through to polymarket
  }

  try {
    const rows = await loadPolymarket?.();
    if (hasScheduleRows(rows)) {
      return rows;
    }
  } catch {
    // fall through to lsports CSV
  }

  const csvRows = await loadLsportsCsv?.();
  if (hasScheduleRows(csvRows)) {
    return csvRows;
  }

  if (sportsDataError) {
    throw sportsDataError;
  }
  throw new Error("No schedule source produced raw fixture rows.");
}

function hasSchedulePayload(payload) {
  if (!payload) {
    return false;
  }
  if (Array.isArray(payload.fixtures)) {
    return payload.fixtures.length > 0;
  }
  return true;
}

function hasScheduleRows(rows) {
  if (!rows) {
    return false;
  }
  if (Array.isArray(rows)) {
    return rows.length > 0;
  }
  return true;
}
