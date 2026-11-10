// Fixes to the map from Pintu's own drivers: a traffic light, bump or camera
// the map is missing, or one it shows that isn't there. They're shared through
// Pintu's server and used at once, before anyone fixes OpenStreetMap itself.
import { deviceCode, get, post } from './hub.js';
import { haversine } from './geo.js';

export const MARK_KINDS = ['light', 'bump', 'camera'];
const MAX_BOX_DEG = 8;
const MARGIN_DEG = 0.02;
const GONE_NEAR_M = 25;      // "not here" without the map's own id: whatever's this close

// The area around the routes, if it's small enough to ask about in one go.
export function marksBox(routes) {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const r of routes || []) {
    for (const [lng, lat] of r.coords) {
      if (lng < w) w = lng;
      if (lng > e) e = lng;
      if (lat < s) s = lat;
      if (lat > n) n = lat;
    }
  }
  if (!Number.isFinite(w)) return null;
  [w, s, e, n] = [w - MARGIN_DEG, s - MARGIN_DEG, e + MARGIN_DEG, n + MARGIN_DEG];
  if (e - w > MAX_BOX_DEG || n - s > MAX_BOX_DEG) return null;
  return [w, s, e, n].map((v) => v.toFixed(4)).join(',');
}

export async function fetchMarks(box, { signal } = {}) {
  if (!box) return [];
  const got = await get(`/marks?bbox=${box}`, { signal });
  return Array.isArray(got?.marks) ? got.marks : [];
}

export function sendMark({ kind, action, fix, ref = null }) {
  return post('/marks/add', { device: deviceCode(), kind, action, lng: fix.lng, lat: fix.lat, heading: fix.heading ?? null, ref });
}

// The map's lights, bumps and cameras, with drivers' fixes laid over them:
// added ones put in, and gone ones taken out (an added one can be gone too).
export function withMarks(things, marks, kinds) {
  const gone = (marks || []).filter((m) => m.action === 'gone' && kinds.includes(m.kind));
  const isGone = (t) => gone.some((m) => (m.ref ? m.ref === t.id : m.kind === t.kind && haversine([m.lng, m.lat], [t.lng, t.lat]) <= GONE_NEAR_M));
  const added = (marks || [])
    .filter((m) => m.action === 'add' && kinds.includes(m.kind))
    .map((m) => ({ id: `mark/${m.id}`, kind: m.kind, lng: m.lng, lat: m.lat, limit: null, mark: true }));
  return [...(things || []), ...added].filter((t) => !isGone(t));
}

// The map's features (lights and bumps; crossings pass through) and its cameras.
export const markFeatures = (features, marks) => [
  ...withMarks((features || []).filter((f) => f.kind !== 'rail'), marks, ['light', 'bump']),
  ...(features || []).filter((f) => f.kind === 'rail'),
];
export const markCameras = (cameras, marks) => withMarks((cameras || []).map((c) => ({ ...c, kind: 'camera' })), marks, ['camera']);
