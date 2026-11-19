// Temporary: reads every live bus and train feed with Pintu's own reader.
import { decodeFeed } from './transit.js';
const LIVE = 'https://api.data.gov.my/gtfs-realtime/vehicle-position';
const paths = ['prasarana?category=rapid-bus-kl', 'prasarana?category=rapid-bus-mrtfeeder', 'prasarana?category=rapid-bus-penang', 'ktmb',
  'mybas-kangar', 'mybas-alor-setar', 'mybas-kota-bharu', 'mybas-kuala-terengganu', 'mybas-ipoh', 'mybas-seremban-a', 'mybas-seremban-b', 'mybas-melaka', 'mybas-johor', 'mybas-kuching'];
for (const p of paths) {
  const t0 = Date.now();
  try {
    const res = await fetch(`${LIVE}/${p}`);
    const buf = new Uint8Array(await res.arrayBuffer());
    const ms = Date.now() - t0;
    if (!res.ok) { console.log(`== ${p}: ${res.status} ${ms} ms ${res.headers.get('access-control-allow-origin')}`); }
    else {
      const f = decodeFeed(buf);
      const now = Date.now();
      const ages = f.vehicles.map((v) => (v.at ? Math.round((now - v.at) / 1000) : null));
      console.log(`== ${p}: ${res.status} ${buf.length} bytes ${ms} ms, cors ${res.headers.get('access-control-allow-origin')}, feed age ${f.at ? Math.round((now - f.at) / 1000) : '?'} s, ${f.vehicles.length} vehicles, routes given ${f.vehicles.filter((v) => v.route).length}, ages ${JSON.stringify(ages.slice(0, 8))}`);
      for (const v of f.vehicles.slice(0, 3)) console.log(`==   ${JSON.stringify(v)}`);
    }
  } catch (e) { console.log(`== ${p}: ${e.message}`); }
  await new Promise((r) => setTimeout(r, 16000));
}
