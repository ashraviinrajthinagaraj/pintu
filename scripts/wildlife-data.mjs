// Builds data/wildlife.json: the stretches of road in Malaysia where wild
// elephants or tapirs are known to cross, as lines along the road itself, so a
// route through one can be warned of. OpenStreetMap has almost none of these
// marked, so the stretches are the ones named in public reports (see `source`),
// and each line is the road between the two ends, found by the public routing
// server (FOSSGIS Valhalla, on OpenStreetMap data). Roads don't move, so this
// runs when the list changes, not on a schedule.
//
//   node scripts/wildlife-data.mjs [out-file]
//
// The road lines are © OpenStreetMap contributors, under the Open Database License.
import { writeFile } from 'node:fs/promises';

const TCER = 'https://www.tcer.my/gajah-melintas/';
const FMT = 'https://www.freemalaysiatoday.com/category/nation/2025/08/09/perhilitan-installs-led-signs-to-warn-of-elephant-crossings';
const STAR = 'https://www.thestar.com.my/metro/metro-news/2024/05/31/ensuring-safe-passage-on-our-roads-for-wildlife';

// Each stretch: the animal, a name for it, and its two ends (with any points
// it must pass, so the routing server takes that road and no other). The
// reports also name Gua Musang–Hulu Terengganu, but OpenStreetMap's routing
// sends traffic between those towns round by Kuala Krai, so no route would
// ever pass it as mapped; it's left out until that road is routable.
export const STRETCHES = [
  { id: 'gerik-jeli', animal: 'elephant', name: 'Gerik–Jeli', road: 'FT4', from: [101.1291, 5.4300], via: [[101.3500, 5.5530]], to: [101.8433, 5.7000], source: [TCER, STAR] },
  { id: 'kluang-mersing', animal: 'elephant', name: 'Kluang–Mersing', road: 'FT50', from: [103.3328, 2.0251], to: [103.8405, 2.4312], source: [TCER] },
  { id: 'kota-tinggi-mersing', animal: 'elephant', name: 'Kota Tinggi–Mersing', road: 'FT3', from: [103.8999, 1.7381], to: [103.8405, 2.4312], source: [TCER] },
  { id: 'lahad-datu-sandakan', animal: 'elephant', name: 'Lahad Datu–Sandakan', road: 'FT13', from: [118.3270, 5.0268], to: [118.1172, 5.8394], source: [TCER] },
];

const ROUTER = 'https://valhalla1.openstreetmap.de/route';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function decode(str, precision = 6) {
  const factor = 10 ** precision;
  const out = [];
  let i = 0, lat = 0, lng = 0;
  while (i < str.length) {
    for (const which of [0, 1]) {
      let shift = 0, result = 0, b;
      do { b = str.charCodeAt(i++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
      const d = result & 1 ? ~(result >> 1) : result >> 1;
      if (which === 0) lat += d; else lng += d;
    }
    out.push([lng / factor, lat / factor]);
  }
  return out;
}

const metres = (a, b) => Math.hypot((a[0] - b[0]) * Math.cos((a[1] * Math.PI) / 180), a[1] - b[1]) * 111320;

// Fewer points, none more than `tolerance` metres from the road (Douglas–Peucker).
export function simplify(points, tolerance = 25) {
  if (points.length < 3) return points;
  const off = (p, a, b) => {
    const k = Math.cos((a[1] * Math.PI) / 180);
    const ax = a[0] * k, ay = a[1], bx = b[0] * k, by = b[1], px = p[0] * k, py = p[1];
    const dx = bx - ax, dy = by - ay;
    const len = dx * dx + dy * dy;
    const t = len ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len)) : 0;
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy)) * 111320;
  };
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    let worst = -1, at = -1;
    for (let i = s + 1; i < e; i++) {
      const d = off(points[i], points[s], points[e]);
      if (d > worst) { worst = d; at = i; }
    }
    if (worst > tolerance) { keep[at] = 1; stack.push([s, at], [at, e]); }
  }
  return points.filter((_, i) => keep[i]);
}

async function roadLine(stretch) {
  const locations = [stretch.from, ...(stretch.via || []), stretch.to].map(([lon, lat], i, all) => ({ lat, lon, type: i === 0 || i === all.length - 1 ? 'break' : 'through' }));
  const body = { locations, costing: 'auto', directions_options: { units: 'kilometers' } };
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(`${ROUTER}?json=${encodeURIComponent(JSON.stringify(body))}`, { headers: { 'user-agent': 'Pintu wildlife-data (https://github.com/ashraviinrajthinagaraj/pintu)' } });
      if (!res.ok) throw new Error(`${res.status}`);
      const json = await res.json();
      const points = json.trip.legs.flatMap((leg, i) => decode(leg.shape).slice(i ? 1 : 0));
      return { points, km: json.trip.summary.length };
    } catch (err) {
      console.log(`${stretch.id}: ${err.message}, trying again`);
      await sleep(5000 * (attempt + 1));
    }
  }
  throw new Error(`${stretch.id}: no road found`);
}

async function main() {
  const out = process.argv[2] || 'data/wildlife.json';
  const zones = [];
  for (const s of STRETCHES) {
    const { points, km } = await roadLine(s);
    const line = simplify(points).map(([lng, lat]) => [Math.round(lng * 1e5) / 1e5, Math.round(lat * 1e5) / 1e5]);
    // A sanity check: the road's ends are where they should be.
    if (metres(line[0], s.from) > 3000 || metres(line[line.length - 1], s.to) > 3000) throw new Error(`${s.id}: the road doesn't reach its ends`);
    console.log(`${s.id}: ${km} km, ${points.length} points kept as ${line.length}`);
    zones.push({ id: s.id, animal: s.animal, name: s.name, road: s.road, km: Math.round(km), source: s.source, line });
    await sleep(1500);
  }
  const text = `{"source":"Road lines © OpenStreetMap contributors, ODbL. Stretches from the reports in each zone's source.",\n"zones":[\n${zones.map((z) => JSON.stringify(z)).join(',\n')}\n]}\n`;
  await writeFile(out, text);
  console.log(`Wrote ${zones.length} stretches to ${out}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((err) => { console.error(err.message); process.exit(1); });
