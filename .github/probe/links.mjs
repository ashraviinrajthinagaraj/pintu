// Temporary: car and foot routes over the water, and what the ferry part says.
const trips = {
  'alor setar → kuah (car)': [[6.1248, 100.3678], [6.3170, 99.8510], 'auto'],
  'butterworth → georgetown (foot)': [[5.3990, 100.3640], [5.4140, 100.3420], 'pedestrian'],
  'kuala perlis → kuah (car)': [[6.3990, 100.1290], [6.3170, 99.8510], 'auto'],
  'mersing → tioman (foot)': [[2.4290, 103.8360], [2.8220, 104.1580], 'pedestrian'],
  'butterworth → georgetown (car)': [[5.3990, 100.3640], [5.4140, 100.3420], 'auto'],
};
for (const [name, [a, b, costing]] of Object.entries(trips)) {
  const body = { locations: [{ lat: a[0], lon: a[1] }, { lat: b[0], lon: b[1] }], costing, units: 'kilometers' };
  const res = await fetch(`https://valhalla1.openstreetmap.de/route?json=${encodeURIComponent(JSON.stringify(body))}`, { headers: { 'user-agent': 'Pintu probe' } });
  const j = await res.json();
  if (!j.trip) { console.log('==', name, res.status, JSON.stringify(j).slice(0, 160)); continue; }
  const ms = j.trip.legs[0].maneuvers;
  console.log('==', name, j.trip.summary.length, 'km', Math.round(j.trip.summary.time / 60), 'min, has_ferry', j.trip.summary.has_ferry);
  for (const m of ms.filter((x) => x.ferry || x.type === 28 || x.type === 29 || x.travel_mode === 'ferry')) {
    console.log('==   ', m.type, m.travel_mode, m.travel_type, JSON.stringify(m.street_names), m.length, 'km', Math.round(m.time / 60), 'min |', m.instruction);
  }
  await new Promise((r) => setTimeout(r, 1500));
}
