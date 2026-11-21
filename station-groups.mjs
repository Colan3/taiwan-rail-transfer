export function groupStations(stations, locations) {
  const grouped = new Map();
  for (const [id, name] of Object.entries(stations)) {
    const location = locations[id];
    const county = location?.county || '縣市未提供';
    if (!grouped.has(county)) grouped.set(county, []);
    grouped.get(county).push({id, name, latitude: location?.latitude ?? Infinity});
  }
  for (const entries of grouped.values()) {
    entries.sort((a, b) => a.latitude - b.latitude ||
      a.name.localeCompare(b.name, 'zh-TW') || a.id.localeCompare(b.id));
  }
  // Use the southernmost station in each county so eastern and western
  // counties share one geographic order.
  return [...grouped].sort(([regionA, a], [regionB, b]) =>
    a[0].latitude - b[0].latitude || regionA.localeCompare(regionB, 'zh-TW'));
}
