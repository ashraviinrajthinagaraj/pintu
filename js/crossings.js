// The two road crossings between Johor and Singapore: the Causeway (Tambak
// Johor) and the Second Link (Laluan Kedua). A trip between the two countries
// goes over one of them, and which is quicker changes by the hour. The plan
// works out the trip over each, with traffic, and shows Singapore's own camera
// photos of both (LTA, through data.gov.sg, under the Singapore Open Data Licence).

// A point on each bridge, and the way traffic into Singapore faces there. The
// points are where the routing server places them on the bridge itself.
export const CROSSINGS = [
  { id: 'causeway', bridge: { lat: 1.453495, lng: 103.768985 }, intoSg: 157, cameras: ['2701', '2702'] },
  { id: 'second-link', bridge: { lat: 1.355772, lng: 103.626322 }, intoSg: 130, cameras: ['4703', '4713'] },
];
export const CAMERA_URL = 'https://api.data.gov.sg/v1/transport/traffic-images';
export const NEAR_M = 400;

const M_PER_DEG = 111320;
const metres = (a, b) => Math.hypot((a[0] - b[0]) * Math.cos((a[1] * Math.PI) / 180), a[1] - b[1]) * M_PER_DEG;
const bearing = (a, b) => ((Math.atan2((b[0] - a[0]) * Math.cos((a[1] * Math.PI) / 180), b[1] - a[1]) * 180) / Math.PI + 360) % 360;
const turnBetween = (a, b) => Math.abs((((a - b) % 360) + 540) % 360 - 180);

// Which crossing a route goes over, which way, and where along it:
// { crossing, intoSg, at } or null.
export function crossingOf(route) {
  const coords = route?.coords;
  if (!coords?.length) return null;
  for (const crossing of CROSSINGS) {
    const p = [crossing.bridge.lng, crossing.bridge.lat];
    let best = -1, bestD = Infinity;
    for (let i = 0; i < coords.length; i++) {
      const d = metres(coords[i], p);
      if (d < bestD) { bestD = d; best = i; }
    }
    if (bestD > NEAR_M) continue;
    const a = coords[Math.max(0, best - 3)], b = coords[Math.min(coords.length - 1, best + 3)];
    const way = bearing(a, b);
    return { crossing, intoSg: turnBetween(way, crossing.intoSg) < 90, at: route.cum?.[best] ?? null };
  }
  return null;
}

// The point to pass to go over this crossing, facing the way the trip goes.
export function throughFor(crossing, intoSg) {
  return { ...crossing.bridge, heading: intoSg ? crossing.intoSg : (crossing.intoSg + 180) % 360 };
}

// The latest photo from each camera: id → { image, at (ms), lat, lng }.
export async function fetchCameras({ fetchImpl = (...a) => fetch(...a), signal } = {}) {
  const res = await fetchImpl(CAMERA_URL, { signal });
  if (!res.ok) throw new Error(`cameras ${res.status}`);
  const json = await res.json();
  const out = new Map();
  for (const c of json?.items?.[0]?.cameras || []) {
    if (!c?.camera_id || typeof c.image !== 'string' || !/^https:\/\/images\.data\.gov\.sg\//.test(c.image)) continue;
    out.set(String(c.camera_id), { image: c.image, at: Date.parse(c.timestamp) || null, lat: c.location?.latitude, lng: c.location?.longitude });
  }
  return out;
}
