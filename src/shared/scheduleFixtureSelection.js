export function resolveAppliedMatchDayValue({ existingMatchDayValue = "", fixtureMatchDay = null } = {}) {
  if (Number.isInteger(fixtureMatchDay) && fixtureMatchDay > 0) {
    return String(fixtureMatchDay);
  }

  const existing = String(existingMatchDayValue || "").trim();
  return existing || "";
}
