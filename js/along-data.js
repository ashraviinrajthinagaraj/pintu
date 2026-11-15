// Malaysia's toll plaza booths, speed cameras, R&Rs and lay-bys, kept with the
// app in data/along.json (from OpenStreetMap, refreshed each week by
// scripts/along-data.mjs). Finding what's on a route is then instant and needs
// no map server, which can take most of a minute when it's busy.

const URL_ = './data/along.json';
const LONG = { n: 'node', w: 'way', r: 'relation' };
const fullId = (id) => `${LONG[id[0]] || 'node'}/${id.slice(1)}`;

export function expand(json) {
  const { tolls, cameras, rests } = json || {};
  if (!Array.isArray(tolls) || !Array.isArray(cameras) || !Array.isArray(rests)) throw new Error('not along data');
  return {
    updated: json.updated || null,
    tolls: tolls.map(([id, lat, lng, name, gantry]) => ({ id: fullId(id), lat, lng, name: name || null, gantry: !!gantry })),
    cameras: cameras.map(([id, lat, lng, limit]) => ({ id: fullId(id), lat, lng, limit: limit || null })),
    rests: rests.map(([id, lat, lng, kind, name]) => ({ id: fullId(id), lat, lng, kind: kind === 'r' ? 'rnr' : 'layby', name: name || '' })),
  };
}

let loading = null;
export function loadAlongData({ fetchImpl = (...a) => fetch(...a) } = {}) {
  loading ||= fetchImpl(URL_)
    .then((res) => {
      if (!res.ok) throw new Error(`along data ${res.status}`);
      return res.json();
    })
    .then(expand)
    .catch((err) => { loading = null; throw err; });
  return loading;
}
export const forgetAlongData = () => { loading = null; };

/* ---------- Near a route ---------- */

const CELL_DEG = 0.01;           // about 1.1 km
const STEP_M = 250;
const nearCache = new WeakMap();

// A quick test of whether a place is anywhere near the route: the squares of a
// grid the route passes through, and their neighbours within `marginM`. Places
// that pass are then measured properly against the route itself.
export function nearRoute(route, marginM = 800) {
  let byMargin = nearCache.get(route);
  if (!byMargin) nearCache.set(route, (byMargin = new Map()));
  if (byMargin.has(marginM)) return byMargin.get(marginM);
  const cells = new Set();
  const m = marginM / 111320;
  const { coords, cum } = route;
  let next = 0;
  const mark = ([lng, lat]) => {
    const k = Math.max(0.2, Math.cos((lat * Math.PI) / 180));
    for (const dx of [-m / k, 0, m / k]) {
      for (const dy of [-m, 0, m]) cells.add(`${Math.floor((lng + dx) / CELL_DEG)},${Math.floor((lat + dy) / CELL_DEG)}`);
    }
  };
  for (let i = 0; i < coords.length; i++) {
    if (cum[i] >= next || i === coords.length - 1) {
      mark(coords[i]);
      next = cum[i] + STEP_M;
    }
  }
  const test = (p) => cells.has(`${Math.floor(p.lng / CELL_DEG)},${Math.floor(p.lat / CELL_DEG)}`);
  byMargin.set(marginM, test);
  return test;
}

// What's near any of these routes, of the kinds asked for.
export function dataNear(data, routes, { tolls = true, cameras = true, rests = true } = {}) {
  const tests = routes.map((r) => nearRoute(r));
  const near = (p) => tests.some((t) => t(p));
  return {
    tolls: tolls ? data.tolls.filter(near) : [],
    cameras: cameras ? data.cameras.filter(near) : [],
    rests: rests ? data.rests.filter(near) : [],
    features: [],
  };
}
