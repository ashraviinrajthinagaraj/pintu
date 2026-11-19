// Temporary: Pintu's live server, asked for trips as the page would.
const SERVER = 'https://pintu.ashraviinrajthinagaraj.workers.dev';
const trips = [
  ['Seremban to Singapore', '2.718700,101.940200', '1.283400,103.860700'],
  ['KL Sentral to KLCC', '3.134300,101.686500', '3.157900,101.712300'],
  ['Nowhere (Kota Kinabalu)', '5.980000,116.070000', '5.990000,116.080000'],
];
for (const [name, from, to] of trips) {
  const u = `${SERVER}/transit?from=${from}&to=${to}&lang=ms&v=0.10.20`;
  const t0 = Date.now();
  const res = await fetch(u, { headers: { origin: 'https://ashraviinrajthinagaraj.github.io' } });
  const text = await res.text();
  console.log(`== ${name}: ${res.status} ${text.length} bytes ${Date.now() - t0} ms acao=${res.headers.get('access-control-allow-origin')}`);
  try {
    const j = JSON.parse(text);
    if (j.error) { console.log('==  ', text.slice(0, 200)); continue; }
    console.log(`==   ${j.trips.length} trips, earlier ${!!j.earlier}, later ${!!j.later}, walk ${!!j.walk}`);
    for (const t of j.trips.slice(0, 2)) console.log(`==   ${t.start} ${Math.round(t.seconds / 60)} min: ${t.legs.map((l) => `${l.mode}${l.name ? ' ' + l.name : ''}${l.colour ? ' #' + l.colour : ''}`).join(' > ')}`);
  } catch { console.log('==  ', text.slice(0, 200)); }
}
const unknown = await fetch(`${SERVER}/transit?from=1,1&to=1,1`, { headers: { origin: 'https://evil.example' } });
console.log(`== from another site: ${unknown.status}`);
