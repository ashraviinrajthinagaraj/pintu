// Temporary: what Transitous gives for a few Malaysian trips.
const UA = 'Pintu/0.10.20 (+https://github.com/ashraviinrajthinagaraj/pintu)';
const trips = [
  ['Seremban to Singapore', '2.7187,101.9402', '1.2834,103.8607'],
  ['KL Sentral to KLCC', '3.1343,101.6865', '3.1579,101.7123'],
  ['Petaling Jaya SS2 to Bangsar South', '3.1186,101.6224', '3.1105,101.6656'],
  ['Penang Komtar to Batu Ferringhi', '5.4144,100.3293', '5.4718,100.2459'],
];
for (const [name, from, to] of trips) {
  const u = new URL('https://api.transitous.org/api/v6/plan');
  u.searchParams.set('fromPlace', from);
  u.searchParams.set('toPlace', to);
  u.searchParams.set('time', '2026-11-20T00:30:00Z');   // 08:30 in Malaysia
  u.searchParams.set('detailedTransfers', 'true');
  u.searchParams.set('maxPreTransitTime', '1200');
  u.searchParams.set('maxPostTransitTime', '1200');
  u.searchParams.set('language', 'ms');
  const t0 = Date.now();
  const res = await fetch(u, { headers: { 'user-agent': UA } });
  const text = await res.text();
  console.log(`== ${name}: ${res.status} ${text.length} bytes ${Date.now() - t0} ms cors=${res.headers.get('access-control-allow-origin')}`);
  if (!res.ok) { console.log('==', text.slice(0, 300)); continue; }
  const j = JSON.parse(text);
  console.log(`==   direct ${j.direct?.length} itineraries ${j.itineraries?.length} next ${!!j.nextPageCursor} prev ${!!j.previousPageCursor}`);
  for (const it of j.itineraries.slice(0, 4)) {
    console.log(`==   ${it.startTime} -> ${it.endTime} ${Math.round(it.duration / 60)} min, ${it.transfers} transfers: ` + it.legs.map((l) => `${l.mode}${l.routeShortName ? ' ' + l.routeShortName : ''}${l.displayName ? '/' + l.displayName : ''}${l.routeColor ? ' #' + l.routeColor : ''} [${l.from.name} ${l.startTime.slice(11, 16)} -> ${l.to.name} ${l.endTime.slice(11, 16)}${l.realTime ? ' RT' : ''}${l.headsign ? ' to ' + l.headsign : ''} ${l.agencyName || ''} ${l.intermediateStops?.length ?? ''} stops, poly ${l.legGeometry?.precision}/${l.legGeometry?.length}]`).join(' | '));
  }
  const leg = j.itineraries[0]?.legs.find((l) => l.mode !== 'WALK');
  if (leg) console.log('==   keys', Object.keys(leg).join(','), 'place', Object.keys(leg.from).join(','));
  await new Promise((r) => setTimeout(r, 3000));
}
