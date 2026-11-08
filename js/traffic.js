// Live traffic along the route, from TomTom through Pintu's server. Every few
// minutes the rest of the route is sent, and what comes back is each slow
// stretch on it and how many minutes it adds.
import { CONFIG } from './config.js';
import { bearing, haversine } from './geo.js';
import { pointAt } from './motion.js';
import { placeOnRoute } from './places.js';

export const TRAFFIC_EVERY_MS = 3 * 60 * 1000;
export const TRAFFIC_POINTS = 1500;
// A quicker way is only offered if it saves this much, and a fair share of the trip.
export const FASTER_MIN_S = 180;
export const FASTER_SHARE = 0.08;
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
  return {
    at: Date.now(),
    from: s,
    delay: answer?.delay || 0,
    travel: Number.isFinite(answer?.travel) ? answer.travel : null,
    better: answer?.better?.path?.length >= 2 ? answer.better : null,
    leave: answer?.leave ? new Date(answer.leave) : null,
    jams,
  };
}

// Anything that isn't just slow traffic is worth knowing about, however short.
export const ALWAYS_SAY = new Set(['ROAD_CLOSURE', 'ACCIDENT', 'FLOOD', 'BREAKDOWN', 'HAZARD']);
const worth = (j) => j.delay >= JAM_MIN_DELAY_S || ALWAYS_SAY.has(j.kind);

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

// The arrival time as TomTom takes it: to the second, in UTC.
export const isoTime = (date) => `${date.toISOString().slice(0, 19)}Z`;

export async function fetchTraffic(route, s, { better = false, arriveAt = null, signal, fetchImpl = fetch, server = CONFIG.server } = {}) {
  if (!server) throw new TrafficError('no server', 0);
  const ask = { points: tracePoints(route, s) };
  if (better) ask.better = true;
  if (arriveAt) ask.arriveAt = isoTime(arriveAt);
  const res = await fetchImpl(`${server}/traffic`, {
    method: 'POST',
    // Plain text, so the page needn't ask the server's permission first.
    headers: { 'content-type': 'text/plain' },
    body: JSON.stringify(ask),
    signal,
  });
  let body = null;
  try { body = await res.json(); } catch { /* nothing readable */ }
  if (!res.ok) throw new TrafficError(body?.error || 'unavailable', res.status);
  return placeTraffic(route, s, body);
}

// How much a quicker way TomTom found would save, if it's worth offering.
export function fasterSaving(traffic) {
  if (!traffic?.better || !Number.isFinite(traffic.travel)) return 0;
  const saving = traffic.travel - traffic.better.travel;
  return saving >= Math.max(FASTER_MIN_S, traffic.travel * FASTER_SHARE) ? Math.round(saving) : 0;
}

// Points along TomTom's quicker way for the route planner to pass through, so
// it takes the same roads. The first stretch is shared with the current
// route anyway, and the very end is the destination itself.
export function throughPoints(path, max = 12) {
  let total = 0;
  const cum = [0];
  for (let i = 1; i < path.length; i++) cum.push(total += haversine(path[i - 1], path[i]));
  if (total < 1500) return [];
  const out = [];
  const from = 600, to = total - 400;
  for (let k = 0; k < max; k++) {
    const at = from + ((to - from) * k) / Math.max(1, max - 1);
    let i = 1;
    while (i < cum.length - 1 && cum[i] < at) i++;
    const a = path[i - 1], b = path[i];
    const span = cum[i] - cum[i - 1] || 1;
    const t = Math.min(1, Math.max(0, (at - cum[i - 1]) / span));
    out.push({ lng: a[0] + (b[0] - a[0]) * t, lat: a[1] + (b[1] - a[1]) * t, heading: bearing(a, b) });
  }
  return out;
}
