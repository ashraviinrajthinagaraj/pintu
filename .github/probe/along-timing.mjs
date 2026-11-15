// Temporary: times Pintu's along-the-route Overpass request on real routes.
import { prepareTrip } from '../../js/routing.js';
import { alongQuery } from '../../js/along.js';

const SERVERS = ['https://overpass.private.coffee/api/interpreter', 'https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const TRIPS = {
  'KL-KualaPilah': [[101.6869, 3.1390], [102.2489, 2.7389]],
  'Kajang-Seremban': [[101.7880, 2.9930], [101.9381, 2.7258]],
};

async function routes(from, to) {
  const json = { locations: [{ lon: from[0], lat: from[1] }, { lon: to[0], lat: to[1] }], costing: 'auto', alternates: 2, directions_options: { units: 'kilometers' } };
  const res = await fetch(`https://valhalla1.openstreetmap.de/route?json=${encodeURIComponent(JSON.stringify(json))}`);
  const body = await res.json();
  return [body.trip, ...(body.alternates || []).map((a) => a.trip)].filter(Boolean).map(prepareTrip);
}

async function time(server, query) {
  const t = Date.now();
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 60000);
    const res = await fetch(server, { method: 'POST', body: new URLSearchParams({ data: query }), signal: ctrl.signal, headers: { 'user-agent': 'Pintu probe' } });
    const text = await res.text();
    clearTimeout(timer);
    let n = '?';
    try { n = JSON.parse(text).elements.length; } catch { n = text.slice(0, 120).replace(/\s+/g, ' '); }
    return `${res.status} ${Date.now() - t}ms elements=${n} bytes=${text.length}`;
  } catch (e) { return `ERR ${Date.now() - t}ms ${e.name}`; }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (const [name, [from, to]] of Object.entries(TRIPS)) {
  const rs = await routes(from, to);
  console.log(`\n== ${name}: ${rs.length} routes, ${rs.map((r) => Math.round(r.length / 1000) + 'km').join(', ')}`);
  const variants = {
    full: alongQuery(rs, { tolls: true, cameras: true, rests: true, features: true }),
    fast: alongQuery(rs, { tolls: true, cameras: true, rests: true, features: false }),
    features: alongQuery(rs, { tolls: false, cameras: false, rests: false, features: true }),
    tollsOnly: alongQuery(rs, { tolls: true, cameras: false, rests: false, features: false }),
  };
  for (const [v, q] of Object.entries(variants)) {
    console.log(`-- ${v}: query ${q.length} chars`);
    for (const s of SERVERS) {
      console.log(`   ${new URL(s).host}: ${await time(s, q)}`);
      await sleep(3000);
    }
  }
}
