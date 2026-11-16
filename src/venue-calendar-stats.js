function formatDateKey(date) {
  return date.toISOString().slice(0, 10);
}

export function getVenueCalendarOverbookings(sessions, dateKey) {
  const locations = new Map();
  sessions.forEach((session) => {
    if (!session.hasLocation || session.startKey > dateKey || session.endKey < dateKey) return;
    if (!locations.has(session.locationKey)) {
      locations.set(session.locationKey, {
        name: session.location,
        trainingIds: new Set()
      });
    }
    locations.get(session.locationKey).trainingIds.add(session.training.id);
  });
  return [...locations.values()]
    .filter((location) => location.trainingIds.size > 2)
    .sort((left, right) => left.name.localeCompare(right.name, "fr"));
}

export function getVenueCalendarStatistics(sessions, year = null) {
  const subcategories = new Map();
  const locations = new Map();

  sessions.forEach((session) => {
    if (year !== null && (session.end.getUTCFullYear() < year || session.start.getUTCFullYear() > year)) return;
    const start = year === null || session.start.getUTCFullYear() >= year
      ? session.start
      : new Date(Date.UTC(year, 0, 1));
    const end = year === null || session.end.getUTCFullYear() <= year
      ? session.end
      : new Date(Date.UTC(year, 11, 31));
    const subcategoryName = String(session.training.subCategory || "").trim();
    const domainName = subcategoryName ||
      String(session.training.category || "").trim() ||
      "Sans catégorie";
    const key = domainName.toLocaleLowerCase("fr");
    if (!subcategories.has(key)) {
      subcategories.set(key, {
        name: domainName,
        trainingIds: new Set(),
        sessionCount: 0,
        trainingDays: new Set()
      });
    }
    const domain = subcategories.get(key);
    domain.trainingIds.add(session.training.id);
    domain.sessionCount += 1;
    for (let day = new Date(start); day <= end; day.setUTCDate(day.getUTCDate() + 1)) {
      domain.trainingDays.add(`${session.training.id}|${formatDateKey(day)}`);
    }

    if (!session.hasLocation) return;
    if (!locations.has(session.locationKey)) {
      locations.set(session.locationKey, {
        name: session.location,
        days: new Set()
      });
    }
    const location = locations.get(session.locationKey);
    for (let day = new Date(start); day <= end; day.setUTCDate(day.getUTCDate() + 1)) {
      location.days.add(formatDateKey(day));
    }
  });

  const subcategoryRows = [...subcategories.values()]
    .map((domain) => ({
      name: domain.name,
      trainingCount: domain.trainingIds.size,
      sessionCount: domain.sessionCount,
      dayCount: domain.trainingDays.size
    }))
    .sort((left, right) => left.name.localeCompare(right.name, "fr"));
  const locationRows = [...locations.values()]
    .map((location) => ({ name: location.name, dayCount: location.days.size }))
    .sort((left, right) => left.name.localeCompare(right.name, "fr"));

  return {
    subcategoryRows,
    locationRows,
    trainingCount: subcategoryRows.reduce((total, row) => total + row.trainingCount, 0),
    subcategoryDayCount: subcategoryRows.reduce((total, row) => total + row.dayCount, 0),
    locationDayCount: locationRows.reduce((total, row) => total + row.dayCount, 0)
  };
}
