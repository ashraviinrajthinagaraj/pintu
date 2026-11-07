import { CONFIG } from './config.js';
import { cumulative, decodePolyline, encodePolyline } from './geo.js';
import { roadNames } from './instructions.js';

const MIN_GAP_MS = 1200;   // the public routing servers ask for about one call a second
const TIMEOUT_MS = 15000;

export class RouteError extends Error {
  constructor(code, message) { super(message || code); this.code = code; }
}

const skipped = new Set();
const lastCall = new Map();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function resetRouting() { skipped.clear(); lastCall.clear(); }

let nextRouteId = 1;

const COSTING = { car: 'auto', motorcycle: 'motorcycle', walk: 'pedestrian' };

function buildBody({ from, to, stops = [], mode, avoidTolls, heading, alternates }) {
  const start = { lat: from.lat, lon: from.lng, type: 'break' };
  if (heading != null) { start.heading = Math.round(heading); start.heading_tolerance = 45; }
  const body = {
    locations: [
      start,
      ...stops.map((p) => ({ lat: p.lat, lon: p.lng, type: 'break' })),
      { lat: to.lat, lon: to.lng, type: 'break' },
    ],
    costing: COSTING[mode] || 'auto',
    units: 'kilometers',
    language: 'en-GB',
    turn_lanes: true,
  };
  // Valhalla can't offer alternatives once a route has stops.
  if (alternates && !stops.length) body.alternates = alternates;
  if (mode === 'car' && avoidTolls) body.costing_options = { auto: { use_tolls: 0 } };
  return body;
}

async function call(provider, body, outerSignal, fetchImpl, url = provider.url) {
  const wait = (lastCall.get(provider.name) || 0) + MIN_GAP_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastCall.set(provider.name, Date.now());

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  const onOuter = () => ctrl.abort();
  outerSignal?.addEventListener('abort', onOuter);
  try {
    if (provider.method === 'GET') {
      return await fetchImpl(`${url}?json=${encodeURIComponent(JSON.stringify(body))}`, { signal: ctrl.signal });
    }
    return await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
    outerSignal?.removeEventListener('abort', onOuter);
  }
}

export async function fetchRoutes(opts, { fetchImpl = (...a) => fetch(...a), providers = CONFIG.routing } = {}) {
  const body = buildBody(opts);
  let lastError = new RouteError('offline');

  for (const provider of providers) {
    if (skipped.has(provider.name)) continue;
    let res;
    try {
      res = await call(provider, body, opts.signal, fetchImpl);
    } catch (err) {
      if (opts.signal?.aborted) throw new RouteError('cancelled');
      lastError = new RouteError('offline', err.message);
      continue;
    }
    if (res.ok) {
      const data = await res.json();
      const routes = parseResponse(data);
      if (!routes.length) { lastError = new RouteError('no_route'); continue; }
      for (const r of routes) r.provider = provider.name;
      return routes;
    }
    // Not set up for this site. Don't ask again until the app next opens.
    if (res.status === 401 || res.status === 403) { skipped.add(provider.name); continue; }
    if (res.status === 429 || res.status >= 500) { lastError = new RouteError('busy'); continue; }

    // The server understood but there's no way through. Asking another won't help.
    let info = {};
    try { info = await res.json(); } catch { /* not JSON */ }
    throw new RouteError(info.error_code === 154 ? 'too_far' : 'no_route', info.error);
  }
  throw lastError;
}

// How many lanes each stretch of road has, for the next part of the route.
// A route only carries lane arrows at junctions that have them mapped. The road's
// lane count is mapped far more often, as is its speed limit, and asking for them
// separately keeps routes quick.
export async function fetchLaneCounts(route, fromS, toS, opts = {}) {
  return (await fetchRoadDetails(route, fromS, toS, opts)).counts;
}

export async function fetchRoadDetails(route, fromS, toS, { fetchImpl = (...a) => fetch(...a), providers = CONFIG.routing, signal, mode = 'car' } = {}) {
  const { coords, cum } = route;
  const part = [];
  for (let i = 0; i < coords.length; i++) {
    if (cum[i] >= fromS && cum[i] <= toS) part.push(coords[i]);
    if (cum[i] > toS) break;
  }
  if (part.length < 2) return { counts: [], limits: [] };
  const start = cum[coords.indexOf(part[0])];
  const body = {
    encoded_polyline: encodePolyline(part),
    costing: mode === 'motorcycle' ? 'motorcycle' : 'auto',
    shape_match: 'edge_walk',
    filters: { attributes: ['edge.lane_count', 'edge.length', 'edge.speed_limit'], action: 'include' },
    directions_options: { units: 'kilometers' },
  };
  for (const provider of providers) {
    if (skipped.has(provider.name) || !provider.traceUrl) continue;
    let res;
    try {
      res = await call(provider, body, signal, fetchImpl, provider.traceUrl);
    } catch (err) {
      if (signal?.aborted) throw err;
      continue;
    }
    if (res.status === 401 || res.status === 403) { skipped.add(provider.name); continue; }
    if (!res.ok) continue;
    const json = await res.json();
    return { counts: parseLaneCounts(json, start), limits: parseSpeedLimits(json, start) };
  }
  throw new RouteError('offline');
}

export function parseLaneCounts(json, baseS = 0) {
  const out = [];
  let s = baseS;
  for (const edge of json.edges || []) {
    const len = (edge.length || 0) * 1000;
    if (len <= 0) continue;
    const count = Math.min(8, Math.max(1, edge.lane_count || 1));
    const last = out[out.length - 1];
    if (last && last.count === count) last.to = s + len;
    else out.push({ from: s, to: s + len, count });
    s += len;
  }
  return out;
}

// Only what's actually mapped. No limit shown is better than a guessed one.
export function parseSpeedLimits(json, baseS = 0) {
  const out = [];
  let s = baseS;
  for (const edge of json.edges || []) {
    const len = (edge.length || 0) * 1000;
    if (len <= 0) continue;
    const limit = Number(edge.speed_limit);
    if (limit >= 5 && limit <= 130) {
      const last = out[out.length - 1];
      if (last && last.limit === limit && last.to === s) last.to = s + len;
      else out.push({ from: s, to: s + len, limit });
    }
    s += len;
  }
  return out;
}

export function limitAt(segments, s) {
  for (const seg of segments || []) {
    if (s >= seg.from && s < seg.to) return seg.limit;
  }
  return null;
}

export function parseResponse(data) {
  const trips = [];
  if (data.trip) trips.push(data.trip);
  for (const alt of data.alternates || []) {
    const t = alt.trip || alt;
    if (t && t.legs) trips.push(t);
  }
  return trips.map(prepareTrip).filter(Boolean);
}

const DESTINATION_TYPES = new Set([4, 5, 6]);

// Joins a trip's legs into one line with one list of manoeuvres. Each stop
// splits a trip into legs, and each leg ends with its own "destination".
export function prepareTrip(trip) {
  const legs = trip.legs || [];
  if (!legs.length) return null;

  const coords = [];
  const maneuvers = [];
  for (let l = 0; l < legs.length; l++) {
    const leg = legs[l];
    if (!leg.shape || !leg.maneuvers || !leg.maneuvers.length) return null;
    const part = decodePolyline(leg.shape, 6);
    // Each leg starts where the last one ended, so that point is already there.
    const offset = coords.length ? coords.length - 1 : 0;
    coords.push(...(offset ? part.slice(1) : part));
    for (const m of leg.maneuvers) {
      maneuvers.push({
        ...m,
        begin_shape_index: (m.begin_shape_index ?? 0) + offset,
        end_shape_index: (m.end_shape_index ?? 0) + offset,
        isStop: l < legs.length - 1 && DESTINATION_TYPES.has(m.type),
      });
    }
  }
  if (coords.length < 2) return null;
  const cum = cumulative(coords);

  for (const m of maneuvers) m.beginDist = cum[Math.min(m.begin_shape_index, cum.length - 1)];

  // How long is left from the start of each manoeuvre to the end of the trip.
  let t = 0;
  for (let i = maneuvers.length - 1; i >= 0; i--) {
    t += maneuvers[i].time || 0;
    maneuvers[i].timeFromHere = t;
  }

  const summary = trip.summary || legs[0].summary || {};
  return {
    id: nextRouteId++,
    coords,
    cum,
    length: cum[cum.length - 1],
    maneuvers,
    time: summary.time ?? t,
    distanceKm: summary.length ?? cum[cum.length - 1] / 1000,
    hasToll: !!summary.has_toll || maneuvers.some((m) => m.toll),
    // A manoeuvre is marked if any of it is tolled, so this is a little generous.
    tollKm: maneuvers.reduce((km, m) => km + (m.toll ? m.length || 0 : 0), 0),
    hasHighway: !!summary.has_highway || maneuvers.some((m) => m.highway),
    hasFerry: !!summary.has_ferry || maneuvers.some((m) => m.ferry),
    via: mainRoads(maneuvers),
  };
}

// Seconds of driving between two points along a route.
export function timeBetween(route, fromS, toS) {
  const at = (s) => {
    const { maneuvers } = route;
    let i = 0;
    while (i < maneuvers.length - 1 && maneuvers[i + 1].beginDist <= s) i++;
    const m = maneuvers[i];
    const next = maneuvers[i + 1];
    const span = next ? next.beginDist - m.beginDist : 0;
    const done = span > 0 ? Math.min(1, (s - m.beginDist) / span) : 0;
    return route.time - m.timeFromHere + (m.time || 0) * done;
  };
  return Math.max(0, at(toS) - at(fromS));
}

// How far along the route you'd be after a given number of seconds.
export function distanceAfter(route, fromS, seconds) {
  let lo = fromS, hi = route.length;
  for (let k = 0; k < 24; k++) {
    const mid = (lo + hi) / 2;
    if (timeBetween(route, fromS, mid) < seconds) lo = mid; else hi = mid;
  }
  return hi;
}

// The road you spend the most distance on, to tell routes apart at a glance.
function mainRoads(maneuvers) {
  const totals = new Map();
  for (const m of maneuvers) {
    const { name, ref } = roadNames(m);
    const label = name || ref;
    if (label) totals.set(label, (totals.get(label) || 0) + (m.length || 0));
  }
  return [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([n]) => n);
}
