// Roads where wild elephants are known to cross (data/wildlife.json, built by
// scripts/wildlife-data.mjs from public reports, road lines © OpenStreetMap
// contributors, ODbL): which stretches of a route run along one, so the plan
// can say so and a driver hears of it before getting there.

const URL_ = './data/wildlife.json';
export const NEAR_M = 80;     // the route this close to the road's line is on that road
export const MIN_M = 1000;    // a shorter brush with one is crossing it, not driving along it
const GAP_M = 800;            // breaks shorter than this are the same stretch
const STEP_M = 40;            // the route is checked about this often
const CELL = 0.005;           // about 550 m, for finding nearby bits of road quickly

let loading = null;
export function loadWildlife({ fetchImpl = (...a) => fetch(...a) } = {}) {
  loading ||= fetchImpl(URL_)
    .then((res) => {
      if (!res.ok) throw new Error(`wildlife ${res.status}`);
      return res.json();
    })
    .then((json) => (json?.zones || []).filter((z) => z?.id && Array.isArray(z.line) && z.line.length > 1))
    .catch((err) => { loading = null; throw err; });
  return loading;
}
export const forgetWildlife = () => { loading = null; };

const M_PER_DEG = 111320;

// Each zone's road as segments filed by grid square, worked out once.
const indexes = new WeakMap();
function indexOf(zone) {
  let idx = indexes.get(zone);
  if (idx) return idx;
  const cells = new Map();
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (let i = 0; i + 1 < zone.line.length; i++) {
    const [x1, y1] = zone.line[i], [x2, y2] = zone.line[i + 1];
    w = Math.min(w, x1, x2); e = Math.max(e, x1, x2); s = Math.min(s, y1, y2); n = Math.max(n, y1, y2);
    for (let cx = Math.floor(Math.min(x1, x2) / CELL); cx <= Math.floor(Math.max(x1, x2) / CELL); cx++) {
      for (let cy = Math.floor(Math.min(y1, y2) / CELL); cy <= Math.floor(Math.max(y1, y2) / CELL); cy++) {
        const key = `${cx},${cy}`;
        if (!cells.has(key)) cells.set(key, []);
        cells.get(key).push(i);
      }
    }
  }
  idx = { cells, box: [w, s, e, n] };
  indexes.set(zone, idx);
  return idx;
}

// Metres from a point to the zone's road, or Infinity if it's nowhere near.
function distanceTo(zone, [x, y]) {
  const { cells, box } = indexOf(zone);
  const pad = CELL;
  if (x < box[0] - pad || x > box[2] + pad || y < box[1] - pad || y > box[3] + pad) return Infinity;
  const k = Math.cos((y * Math.PI) / 180);
  let best = Infinity;
  const cx = Math.floor(x / CELL), cy = Math.floor(y / CELL);
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (const i of cells.get(`${cx + dx},${cy + dy}`) || []) {
        const [x1, y1] = zone.line[i], [x2, y2] = zone.line[i + 1];
        const ax = (x2 - x1) * k, ay = y2 - y1, px = (x - x1) * k, py = y - y1;
        const len = ax * ax + ay * ay;
        const t = len ? Math.max(0, Math.min(1, (px * ax + py * ay) / len)) : 0;
        best = Math.min(best, Math.hypot(px - t * ax, py - t * ay) * M_PER_DEG);
      }
    }
  }
  return best;
}

// The stretches of a route along any of the zones: { id, animal, name, road,
// fromS, toS } in metres along the route, in order.
export function zonesOnRoute(route, zones) {
  if (!route?.coords?.length || !zones?.length) return [];
  const { coords, cum } = route;
  // Points every STEP_M along the route, however far apart its own points are.
  const samples = [];
  for (let i = 0; i + 1 < coords.length; i++) {
    const len = cum[i + 1] - cum[i];
    const n = Math.max(1, Math.ceil(len / STEP_M));
    for (let k = 0; k < n; k++) {
      const f = k / n;
      samples.push([[coords[i][0] + (coords[i + 1][0] - coords[i][0]) * f, coords[i][1] + (coords[i + 1][1] - coords[i][1]) * f], cum[i] + len * f]);
    }
  }
  samples.push([coords[coords.length - 1], cum[cum.length - 1]]);
  const out = [];
  for (const zone of zones) {
    let run = null;
    for (const [p, s] of samples) {
      if (distanceTo(zone, p) > NEAR_M) continue;
      if (run && s - run.toS <= GAP_M) run.toS = s;
      else {
        if (run && run.toS - run.fromS >= MIN_M) out.push(run);
        run = { id: zone.id, animal: zone.animal, name: zone.name, road: zone.road, fromS: s, toS: s };
      }
    }
    if (run && run.toS - run.fromS >= MIN_M) out.push(run);
  }
  // Two roads that meet (both reach Mersing, say): one stretch, named for the longer.
  const merged = [];
  for (const z of out.sort((a, b) => a.fromS - b.fromS)) {
    const last = merged[merged.length - 1];
    if (last && last.animal === z.animal && z.fromS <= last.toS + GAP_M) {
      if (z.toS - z.fromS > last.toS - last.fromS) Object.assign(last, { id: z.id, name: z.name, road: z.road });
      last.toS = Math.max(last.toS, z.toS);
    } else {
      merged.push({ ...z });
    }
  }
  return merged;
}

// How far before a stretch to say so: a minute and a half at this speed, and
// never less than 2 km.
export const warnBefore = (speed) => Math.max(2000, (speed || 0) * 90);

// The stretch you're in or coming to, worth showing now: { zone, ahead, left }
// (metres to its start, 0 once in it, and metres left of it). Or null.
export function zoneAhead(stretches, s, speed) {
  for (const z of stretches || []) {
    if (s > z.toS) continue;
    const ahead = Math.max(0, z.fromS - s);
    if (ahead > warnBefore(speed)) return null;
    return { zone: z, ahead, left: z.toS - Math.max(s, z.fromS) };
  }
  return null;
}
