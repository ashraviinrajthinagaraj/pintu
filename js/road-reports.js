// Things people using Pintu have reported on the road (police, accidents,
// hazards, jams, closed roads), and which of them lie ahead on your route.
import { angleDiff, boundsOf, clamp, sliceBetween } from './geo.js';
import { placeOnRoute } from './places.js';
import { deviceCode, get, post } from './hub.js';

export const REPORT_KINDS = ['police', 'crash', 'hazard', 'jam', 'closed'];
export const REPORTS_EVERY_MS = 2 * 60e3;
export const LOOK_AHEAD_M = 30000;
export const REPORT_OFF_M = 40;       // further from the road than this is somewhere else
export const SAME_WAY_DEG = 75;       // reported by someone going the other way
export const ASK_AFTER_M = 40;        // once you've passed it, is it still there?
const ASK_UNTIL_M = 250;
const BEHIND_M = 20;
const SAME_PLACE_M = 60;
const PAD = 0.005;

// The area the next stretch of road runs through, small enough to ask for.
export function reportBox(route, s) {
  const part = sliceBetween(route.coords, route.cum, s, s + LOOK_AHEAD_M);
  const [[w, so], [e, n]] = boundsOf(part);
  const cx = (w + e) / 2, cy = (so + n) / 2;
  const half = (v) => Math.min(0.95, v / 2 + PAD);
  const hx = half(e - w), hy = half(n - so);
  const f = (v) => v.toFixed(4);
  return [f(cx - hx), f(cy - hy), f(cx + hx), f(cy + hy)].join(',');
}

export function reportsOnRoute(route, reports) {
  const out = [];
  for (const r of reports || []) {
    if (!REPORT_KINDS.includes(r.kind)) continue;
    const where = placeOnRoute(route, r, 0);
    if (!where || where.off > REPORT_OFF_M) continue;
    // A report from the other side of a divided road isn't about yours.
    if (r.heading != null && where.bearing != null && angleDiff(r.heading, where.bearing) > SAME_WAY_DEG) continue;
    if (out.some((o) => o.kind === r.kind && Math.abs(o.along - where.along) < SAME_PLACE_M)) continue;
    out.push({ ...r, along: where.along });
  }
  return out.sort((a, b) => a.along - b.along);
}

export const reportAlertM = (speed) => clamp((speed || 0) * 30, 400, 1000);

export function reportAhead(placed, s, speed) {
  for (const report of placed || []) {
    const ahead = report.along - s;
    if (ahead < -BEHIND_M) continue;
    return ahead <= reportAlertM(speed) ? { report, ahead: Math.max(0, ahead) } : null;
  }
  return null;
}

// A report you've just driven past, to ask about once.
export function justPassed(placed, s, asked) {
  return (placed || []).find((r) => !asked.has(r.id) && s - r.along >= ASK_AFTER_M && s - r.along <= ASK_UNTIL_M) || null;
}

export async function fetchReports(bbox, { signal } = {}) {
  const { reports } = await get(`/reports?bbox=${bbox}`, { signal });
  return Array.isArray(reports) ? reports : [];
}

export function sendReport(kind, fix) {
  return post('/reports/add', { kind, lng: fix.lng, lat: fix.lat, heading: fix.heading ?? null, device: deviceCode() });
}

export function voteReport(id, still) {
  return post('/reports/vote', { id, still, device: deviceCode() });
}
