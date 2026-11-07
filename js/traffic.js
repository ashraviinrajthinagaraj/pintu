// Live traffic along the route, from TomTom through Pintu's server. Every few
// minutes the rest of the route is sent, and what comes back is each slow
// stretch on it and how many minutes it adds.
import { CONFIG } from './config.js';
import { pointAt } from './motion.js';
import { placeOnRoute } from './places.js';

export const TRAFFIC_EVERY_MS = 3 * 60 * 1000;
export const TRAFFIC_POINTS = 1500;
const MIN_STEP_M = 60;
export const JAM_OFF_M = 80;            // TomTom's line and Pintu's can differ a little
export const JAM_NOTICE_M = 10000;      // a slow stretch is shown once it's this close
export const JAM_SAY_M = 2500;          // and said once, at about this distance
export const JAM_MIN_DELAY_S = 60;      // shorter holdups aren't worth a mention

// The rest of the route from s, as at most `max` points: every corner where
// there's room, evenly thinned where there isn't.
export function tracePoints(route, s, max = TRAFFIC_POINTS) {
  const { coords, cum } = route;
  const total = cum[cum.length - 1];
  const from = Math.min(Math.max(s, 0), total);
  const step = Math.max(MIN_STEP_M, (total - from) / Math.max(1, max - 2));
  const out = [pointAt(route, from)];
  let last = from;
  for (let k = 1; k < coords.length - 1; k++) {
    if (cum[k] <= from || cum[k] - last < step) continue;
    out.push(coords[k]);
    last = cum[k];
  }
  const end = coords[coords.length - 1];
  if (total - last > 1 || out.length < 2) out.push(end);
  return out.map(([lng, lat]) => [Math.round(lng * 1e5) / 1e5, Math.round(lat * 1e5) / 1e5]);
}

// TomTom's slow stretches, placed on Pintu's own route.
export function placeTraffic(route, s, answer) {
  const jams = [];
  for (const j of answer?.jams || []) {
    const a = placeOnRoute(route, { lng: j.from[0], lat: j.from[1] }, Math.max(0, s - 200));
    const b = placeOnRoute(route, { lng: j.to[0], lat: j.to[1] }, Math.max(0, s - 200));
    if (!a || !b || a.off > JAM_OFF_M || b.off > JAM_OFF_M) continue;
    const start = Math.min(a.along, b.along), end = Math.max(a.along, b.along);
    jams.push({ start, end, delay: j.delay || 0, speed: j.speed ?? null, kind: j.kind || 'OTHER' });
  }
  jams.sort((x, y) => x.start - y.start);
  return { at: Date.now(), from: s, delay: answer?.delay || 0, jams };
}

const worth = (j) => j.delay >= JAM_MIN_DELAY_S || j.kind === 'ROAD_CLOSURE';

// The next slow stretch worth mentioning, if it's close enough.
export function jamAhead(traffic, s, range = JAM_NOTICE_M) {
  for (const jam of traffic?.jams || []) {
    if (jam.end <= s || !worth(jam)) continue;
    if (jam.start - s > range) return null;
    const inside = s >= jam.start;
    const share = inside && jam.end > jam.start ? (jam.end - s) / (jam.end - jam.start) : 1;
    return { jam, ahead: Math.max(0, jam.start - s), inside, left: jam.end - Math.max(s, jam.start), delay: Math.round(jam.delay * share) };
  }
  return null;
}

// Extra time the traffic still ahead adds to the trip.
export function delayAhead(traffic, s) {
  let total = 0;
  for (const jam of traffic?.jams || []) {
    if (jam.end <= s) continue;
    const share = s > jam.start && jam.end > jam.start ? (jam.end - s) / (jam.end - jam.start) : 1;
    total += jam.delay * share;
  }
  return Math.round(total);
}

export class TrafficError extends Error {
  constructor(kind, status) {
    super(kind);
    this.kind = kind;
    this.status = status;
  }
}

export async function fetchTraffic(route, s, { signal, fetchImpl = fetch, server = CONFIG.server } = {}) {
  if (!server) throw new TrafficError('no server', 0);
  const res = await fetchImpl(`${server}/traffic`, {
    method: 'POST',
    // Plain text, so the page needn't ask the server's permission first.
    headers: { 'content-type': 'text/plain' },
    body: JSON.stringify({ points: tracePoints(route, s) }),
    signal,
  });
  let body = null;
  try { body = await res.json(); } catch { /* nothing readable */ }
  if (!res.ok) throw new TrafficError(body?.error || 'unavailable', res.status);
  return placeTraffic(route, s, body);
}
