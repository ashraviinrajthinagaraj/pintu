// Temporary: routes into Singapore by each crossing, through a point on each bridge.
const from = { lat: 1.4927, lon: 103.7414 };   // Johor Bahru (Skudai side)
const to = { lat: 1.3521, lon: 103.8198 };     // central Singapore
const vias = {
  causeway_2701: { lat: 1.447023728, lon: 103.7716543 },
  causeway_mid: { lat: 1.4535, lon: 103.7690 },
  secondlink_4703: { lat: 1.348697862, lon: 103.6350413 },
  secondlink_mid: { lat: 1.3540, lon: 103.6250 },
};
const names = (trip) => [...new Set(trip.legs.flatMap((l) => l.maneuvers.flatMap((m) => m.street_names || [])))].slice(0, 30).join(' / ');
for (const [name, via] of Object.entries({ none: null, ...vias })) {
  const body = { locations: [{ ...from, type: 'break' }, ...(via ? [{ ...via, type: 'through' }] : []), { ...to, type: 'break' }], costing: 'auto', units: 'kilometers' };
  const res = await fetch(`https://valhalla1.openstreetmap.de/route?json=${encodeURIComponent(JSON.stringify(body))}`, { headers: { 'user-agent': 'Pintu probe' } });
  const j = await res.json();
  if (!j.trip) { console.log('==', name, res.status, JSON.stringify(j).slice(0, 200)); continue; }
  console.log('==', name, j.trip.summary.length, 'km', Math.round(j.trip.summary.time / 60), 'min |', names(j.trip).slice(0, 300));
  await new Promise((r) => setTimeout(r, 1500));
}
// And the nearest roads to the bridge points.
for (const [name, via] of Object.entries(vias)) {
  const res = await fetch(`https://valhalla1.openstreetmap.de/locate?json=${encodeURIComponent(JSON.stringify({ locations: [via], costing: 'auto', verbose: true }))}`, { headers: { 'user-agent': 'Pintu probe' } });
  const j = await res.json();
  const e = j[0]?.edges?.[0];
  console.log('== locate', name, e ? `${e.correlated_lat},${e.correlated_lon} dist ${Math.round(e.distance || 0)} ${JSON.stringify(e.edge_info?.names || [])}` : JSON.stringify(j).slice(0, 200));
  await new Promise((r) => setTimeout(r, 1500));
}
