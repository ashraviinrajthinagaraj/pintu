// Malaysia's states, drawn simply enough to keep on the phone (data/states.json:
// © OpenStreetMap contributors, ODbL, by way of geoBoundaries). Used to tell which
// states a route goes through, and to light up the ones under a weather warning.
import { pointAt } from './motion.js';

const URL_ = './data/states.json';
const STEP_M = 2000;
const MAX_SAMPLES = 500;

let loading = null;
export function loadStates({ fetchImpl = (...a) => fetch(...a) } = {}) {
  loading ||= fetchImpl(URL_)
    .then((res) => {
      if (!res.ok) throw new Error(`states ${res.status}`);
      return res.json();
    })
    .then((json) => {
      const features = (json?.features || []).filter((f) => f?.properties?.name && /Polygon$/.test(f.geometry?.type || ''));
      if (!features.length) throw new Error('no states');
      return features;
    })
    .catch((err) => { loading = null; throw err; });
  return loading;
}
export const forgetStates = () => { loading = null; };

function inRing(ring, x, y) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const polygonsOf = (g) => (g.type === 'MultiPolygon' ? g.coordinates : [g.coordinates]);

export function inFeature(feature, lng, lat) {
  return polygonsOf(feature.geometry).some(([outer, ...holes]) => inRing(outer, lng, lat) && !holes.some((h) => inRing(h, lng, lat)));
}

// The state a point is in, or null (at sea, or just outside a simplified coast).
export function stateAt(states, lng, lat) {
  return (states || []).find((f) => inFeature(f, lng, lat))?.properties.name || null;
}

// Where the route goes into each state, in order: [{ name, s, lng, lat }].
// A point that's in no state (a bridge, a coast) doesn't end the stretch it's on.
export function statesAlong(states, route, fromS = 0) {
  const span = Math.max(0, route.length - fromS);
  const n = Math.min(MAX_SAMPLES, Math.max(2, Math.ceil(span / STEP_M) + 1));
  const out = [];
  let last = null;
  for (let i = 0; i < n; i++) {
    const s = fromS + (span * i) / (n - 1);
    const [lng, lat] = pointAt(route, s);
    const name = stateAt(states, lng, lat);
    if (!name || name === last) continue;
    out.push({ name, s, lng, lat });
    last = name;
  }
  return out;
}

export const namesOf = (entries) => [...new Set((entries || []).map((e) => e.name))];

// The first place on the route inside any of these states.
export const firstInto = (entries, names) => (entries || []).find((e) => names.includes(e.name)) || null;

// The first stretch of the route inside any of these states, from where it goes
// in to where it comes out (or the end): { from, to } in metres along the route.
export function stretchIn(entries, names, length) {
  const list = entries || [];
  const i = list.findIndex((e) => names.includes(e.name));
  if (i < 0) return null;
  let j = i + 1;
  while (j < list.length && names.includes(list[j].name)) j++;
  return { from: list[i].s, to: j < list.length ? list[j].s : length };
}

// The shapes of these states, to draw.
export const shapesOf = (states, names) => (states || []).filter((f) => names.includes(f.properties.name));
