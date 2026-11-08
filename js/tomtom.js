// The rest of what Pintu asks TomTom, through its server: speed limits along a
// route, addresses, and where an electric car should charge on a long trip.
import { CONFIG } from './config.js';
import { placeOnRoute } from './places.js';
import { TrafficError, tracePoints } from './traffic.js';
import { countUse, overCap } from './usage.js';

const LIMIT_OFF_M = 60;

async function askServer(path, { body, signal, fetchImpl = fetch, server = CONFIG.server } = {}) {
  if (!server) throw new TrafficError('no server', 0);
  if (overCap()) throw new TrafficError('daily limit', 0);
  countUse();
  const init = body === undefined
    ? { signal }
    : { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify(body), signal };
  const res = await fetchImpl(`${server}${path}`, init);
  let json = null;
  try { json = await res.json(); } catch { /* nothing readable */ }
  if (!res.ok) throw new TrafficError(json?.error || 'unavailable', res.status);
  return json;
}

/* ---------- Speed limits ---------- */

// TomTom's stretches placed on Pintu's route, in the same form as the limits
// read from OpenStreetMap: { from, to, limit } in metres along it.
export function placeLimits(route, stretches) {
  const out = [];
  let after = 0;
  for (const st of stretches || []) {
    const a = placeOnRoute(route, { lng: st.from[0], lat: st.from[1] }, Math.max(0, after - 100));
    const b = placeOnRoute(route, { lng: st.to[0], lat: st.to[1] }, Math.max(0, after - 100));
    if (!a || !b || a.off > LIMIT_OFF_M || b.off > LIMIT_OFF_M || b.along <= a.along) continue;
    out.push({ from: a.along, to: b.along, limit: st.limit });
    after = b.along;
  }
  return out;
}

export async function fetchLimits(route, opts = {}) {
  const json = await askServer('/limits', { ...opts, body: { points: tracePoints(route, 0) } });
  return placeLimits(route, json?.limits);
}

/* ---------- Addresses ---------- */

export async function searchAddresses(q, near, { signal, fetchImpl, server } = {}) {
  const params = new URLSearchParams({ q });
  if (near) {
    params.set('lat', near.lat.toFixed(4));
    params.set('lon', near.lng.toFixed(4));
  }
  const json = await askServer(`/geocode?${params}`, { signal, fetchImpl, server });
  return (json?.places || []).map((p) => ({ name: p.name, detail: p.detail || '', lng: p.lng, lat: p.lat, country: p.country || 'MY', address: true }));
}

// Pintu's usual search finds places by name; TomTom is better at street
// addresses. Both lists, with the likelier first and anything found twice once.
export function mergeResults(named, addresses, q) {
  const looksLikeAddress = /\d/.test(q) || /\b(jalan|jln|lorong|lrg|persiaran|lebuh|taman|tmn|no\.?|blok|lot)\b/i.test(q);
  // The same spot, or the same name close by. A house next to a shop is still a house.
  const spot = (a, b, d) => Math.abs(a.lng - b.lng) < d && Math.abs(a.lat - b.lat) < d;
  const near = (a, b) => spot(a, b, 0.00015);
  const extra = addresses.filter((a) => !named.some((n) => near(n, a) || (n.name.toLowerCase() === a.name.toLowerCase() && spot(n, a, 0.01))));
  return looksLikeAddress ? [...extra, ...named] : [...named, ...extra];
}

/* ---------- Charging an electric car ---------- */

// What TomTom needs to know about the car, from what's saved about it.
export function evCar(v) {
  if (v?.kind !== 'ev' || !v.range || !v.consumption) return null;
  const battery = (v.range * v.consumption) / 100;
  if (!(battery >= 10)) return null;
  return { battery: Math.round(battery * 10) / 10, level: Math.max(1, v.level ?? 100), consumption: v.consumption };
}

export async function planCharging({ from, to, stops = [], car, avoidTolls = false }, opts = {}) {
  const points = [from, ...stops, to].map((p) => [Math.round(p.lng * 1e5) / 1e5, Math.round(p.lat * 1e5) / 1e5]);
  return askServer('/ev', { ...opts, body: { points, ...car, avoidTolls } });
}
