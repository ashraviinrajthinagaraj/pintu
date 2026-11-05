import { CONFIG } from './config.js';
import { cumulative, decodePolyline } from './geo.js';
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

function buildBody({ from, to, mode, avoidTolls, heading, alternates }) {
  const start = { lat: from.lat, lon: from.lng, type: 'break' };
  if (heading != null) { start.heading = Math.round(heading); start.heading_tolerance = 45; }
  const body = {
    locations: [start, { lat: to.lat, lon: to.lng, type: 'break' }],
    costing: mode === 'motorcycle' ? 'motorcycle' : 'auto',
    units: 'kilometers',
    language: 'en-GB',
  };
  if (alternates) body.alternates = alternates;
  if (mode !== 'motorcycle' && avoidTolls) body.costing_options = { auto: { use_tolls: 0 } };
  return body;
}

async function call(provider, body, outerSignal, fetchImpl) {
  const wait = (lastCall.get(provider.name) || 0) + MIN_GAP_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastCall.set(provider.name, Date.now());

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  const onOuter = () => ctrl.abort();
  outerSignal?.addEventListener('abort', onOuter);
  try {
    if (provider.method === 'GET') {
      const url = `${provider.url}?json=${encodeURIComponent(JSON.stringify(body))}`;
      return await fetchImpl(url, { signal: ctrl.signal });
    }
    return await fetchImpl(provider.url, {
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

export function parseResponse(data) {
  const trips = [];
  if (data.trip) trips.push(data.trip);
  for (const alt of data.alternates || []) {
    const t = alt.trip || alt;
    if (t && t.legs) trips.push(t);
  }
  return trips.map(prepareTrip).filter(Boolean);
}

export function prepareTrip(trip) {
  const leg = trip.legs && trip.legs[0];
  if (!leg || !leg.shape || !leg.maneuvers || !leg.maneuvers.length) return null;
  const coords = decodePolyline(leg.shape, 6);
  if (coords.length < 2) return null;
  const cum = cumulative(coords);

  const maneuvers = leg.maneuvers.map((m) => ({
    ...m,
    beginDist: cum[Math.min(m.begin_shape_index ?? 0, cum.length - 1)],
  }));

  // How long is left from the start of each manoeuvre to the end of the trip.
  let t = 0;
  for (let i = maneuvers.length - 1; i >= 0; i--) {
    t += maneuvers[i].time || 0;
    maneuvers[i].timeFromHere = t;
  }

  const summary = trip.summary || leg.summary || {};
  return {
    coords,
    cum,
    length: cum[cum.length - 1],
    maneuvers,
    time: summary.time ?? t,
    distanceKm: summary.length ?? cum[cum.length - 1] / 1000,
    hasToll: !!summary.has_toll || maneuvers.some((m) => m.toll),
    hasHighway: !!summary.has_highway || maneuvers.some((m) => m.highway),
    hasFerry: !!summary.has_ferry || maneuvers.some((m) => m.ferry),
    via: mainRoads(maneuvers),
  };
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
