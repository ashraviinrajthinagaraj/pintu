// Temporary: can the public route server put stops in the best order?
const locs = [[3.139, 101.6869], [3.1579, 101.7116], [3.0738, 101.5183], [3.1185, 101.6773], [3.2375, 101.684]]; // start, KLCC, Shah Alam, Mid Valley, Batu Caves (end)
const body = { locations: locs.map(([lat, lon]) => ({ lat, lon })), costing: 'auto', directions_options: { units: 'kilometers' } };
for (const action of ['optimized_route', 'sources_to_targets']) {
  const b = action === 'sources_to_targets' ? { sources: body.locations, targets: body.locations, costing: 'auto' } : body;
  const t0 = Date.now();
  const res = await fetch(`https://valhalla1.openstreetmap.de/${action}?json=${encodeURIComponent(JSON.stringify(b))}`, { headers: { 'user-agent': 'Pintu probe' } });
  const text = await res.text();
  console.log('==', action, res.status, `${Date.now() - t0} ms`, text.length);
  try {
    const j = JSON.parse(text);
    if (j.trip) console.log('== order', JSON.stringify(j.trip.locations.map((l) => l.original_index)), 'km', j.trip.summary?.length, 'min', Math.round(j.trip.summary?.time / 60), 'legs', j.trip.legs?.length);
    else if (j.sources_to_targets) console.log('== matrix', JSON.stringify(j.sources_to_targets.map((row) => row.map((c) => Math.round(c.time / 60)))));
    else console.log('== body', text.slice(0, 300));
  } catch { console.log('== body', text.slice(0, 300)); }
}
