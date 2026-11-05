// Builds responses in the shape Valhalla documents, so tests exercise the real parser.
import { haversine } from '../../js/geo.js';

export function encodePolyline(coords, precision = 6) {
  const factor = 10 ** precision;
  let out = '', pLat = 0, pLng = 0;
  const enc = (v) => {
    let n = v < 0 ? ~(v << 1) : v << 1, s = '';
    while (n >= 0x20) { s += String.fromCharCode((0x20 | (n & 0x1f)) + 63); n >>>= 5; }
    return s + String.fromCharCode(n + 63);
  };
  for (const [lng, lat] of coords) {
    const a = Math.round(lat * factor), b = Math.round(lng * factor);
    out += enc(a - pLat) + enc(b - pLng);
    pLat = a; pLng = b;
  }
  return out;
}

// A list of straight stretches, each with what happens at its start.
// legs: [{ to:[lng,lat], type, street, kph, ...maneuverFields }]
export function buildTrip(start, legs, summaryExtra = {}) {
  const coords = [start];
  const maneuvers = [];
  let total = 0, totalTime = 0;
  for (const leg of legs) {
    const begin = coords.length - 1;
    const from = coords[coords.length - 1];
    const dist = haversine(from, leg.to);
    const steps = Math.max(1, Math.ceil(dist / 50));
    for (let k = 1; k <= steps; k++) {
      coords.push([from[0] + ((leg.to[0] - from[0]) * k) / steps, from[1] + ((leg.to[1] - from[1]) * k) / steps]);
    }
    const km = dist / 1000;
    const time = dist / ((leg.kph || 50) / 3.6);
    const { to, kph, street, ...rest } = leg;
    maneuvers.push({
      instruction: `Server text for ${street || 'road'}`,
      street_names: street ? [].concat(street) : undefined,
      begin_shape_index: begin,
      end_shape_index: coords.length - 1,
      length: km,
      time,
      travel_mode: 'drive',
      ...rest,
    });
    total += km; totalTime += time;
  }
  const end = coords.length - 1;
  maneuvers.push({ type: 4, instruction: 'You have arrived', begin_shape_index: end, end_shape_index: end, length: 0, time: 0 });
  const summary = { time: totalTime, length: total, has_toll: false, has_highway: false, has_ferry: false, ...summaryExtra };
  return { summary, status: 0, units: 'kilometers', legs: [{ summary, shape: encodePolyline(coords), maneuvers }] };
}

// KLCC area: east along one road, north on the next, east to the destination.
export const P = {
  a: [101.7000, 3.1500],
  b: [101.7100, 3.1500],
  c: [101.7100, 3.1600],
  d: [101.7180, 3.1600],
};

export const cityTrip = (extra) => buildTrip(P.a, [
  { to: P.b, type: 1, street: 'Jalan Ampang', kph: 40 },
  { to: P.c, type: 10, street: 'Jalan Tun Razak', kph: 50 },
  { to: P.d, type: 15, street: ['FT2', 'Jalan Pinang'], kph: 40 },
], extra);

export const altTrip = () => buildTrip(P.a, [
  { to: [101.7000, 3.1600], type: 1, street: 'Jalan Raja Chulan', kph: 35 },
  { to: P.d, type: 10, street: ['E12', 'Lebuhraya AKLEH'], kph: 90, toll: true, highway: true },
], { has_toll: true, has_highway: true });

export function along(a, b, f) { return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]; }
