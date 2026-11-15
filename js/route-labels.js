// The labels on the map beside each route on offer ("3 j 48 min · Tol RM27.10"),
// and the coloured bar on each route that shows where the traffic is.
//
// A label goes where its route is furthest from the others, so you can tell
// whose label it is, and not too near the ends, where routes run together.

const M_PER_DEG = 111320;
const SAMPLES = 160;          // points kept from each other line, to compare against
const FROM = 0.2, TO = 0.8, STEP = 0.025;

// Metres between two points close enough that the earth is flat between them.
function flatMetres(a, b, k) {
  const dx = (a[0] - b[0]) * k;
  const dy = a[1] - b[1];
  return Math.sqrt(dx * dx + dy * dy) * M_PER_DEG;
}

function thin(coords, n = SAMPLES) {
  if (coords.length <= n) return coords;
  const step = (coords.length - 1) / (n - 1);
  return Array.from({ length: n }, (_, i) => coords[Math.round(i * step)]);
}

// The point a share of the way along a line, by distance.
export function pointAlong(coords, share) {
  if (!coords?.length) return null;
  if (coords.length === 1) return coords[0];
  const k = Math.cos((coords[0][1] * Math.PI) / 180);
  const lens = [];
  let total = 0;
  for (let i = 1; i < coords.length; i++) {
    const d = flatMetres(coords[i - 1], coords[i], k);
    lens.push(d);
    total += d;
  }
  let want = total * Math.min(1, Math.max(0, share));
  for (let i = 0; i < lens.length; i++) {
    if (want <= lens[i] || i === lens.length - 1) {
      const t = lens[i] ? Math.min(1, want / lens[i]) : 0;
      const [a, b] = [coords[i], coords[i + 1]];
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    }
    want -= lens[i];
  }
  return coords[coords.length - 1];
}

// One spot per line. Each is as far as it can be from the other lines and from
// the labels already placed; among equals, the one nearest the middle.
export function labelSpots(lines) {
  const valid = (lines || []).map((c) => (Array.isArray(c) && c.length ? c : null));
  const lat0 = valid.find(Boolean)?.[0]?.[1] ?? 0;
  const k = Math.cos((lat0 * Math.PI) / 180);
  const thinned = valid.map((c) => (c ? thin(c) : null));
  const spots = [];
  valid.forEach((coords, i) => {
    if (!coords) { spots.push(null); return; }
    let best = null;
    for (let share = FROM; share <= TO + 1e-9; share += STEP) {
      const p = pointAlong(coords, share);
      let near = Infinity;
      thinned.forEach((other, j) => {
        if (j === i || !other) return;
        for (const q of other) near = Math.min(near, flatMetres(p, q, k));
      });
      for (const s of spots) if (s) near = Math.min(near, flatMetres(p, s, k));
      // Beyond a few hundred metres apart, every spot is as clear as the next.
      const score = Math.min(near, 3000) - Math.abs(share - 0.5) * 100;
      if (!best || score > best.score) best = { score, p };
    }
    spots.push(best.p);
  });
  return spots;
}

// Of these points (in order along a line), the one furthest from all of `avoid`,
// so a pin doesn't sit under a label; among equals, the one nearest the middle.
export function clearOf(points, avoid) {
  if (!points?.length) return null;
  const k = Math.cos((points[0][1] * Math.PI) / 180);
  let best = null;
  points.forEach((p, i) => {
    let near = Infinity;
    for (const q of avoid || []) if (q) near = Math.min(near, flatMetres(p, q, k));
    const middle = points.length > 1 ? Math.abs(i / (points.length - 1) - 0.5) : 0;
    const score = Math.min(near, 3000) - middle * 100;
    if (!best || score > best.score) best = { score, p };
  });
  return best.p;
}

// The same on the screen: of these points ([x, y] in pixels), the index of the one
// furthest from every box ([left, top, right, bottom]), nearest the middle among equals.
export const LABEL_BOX = { left: 48, up: 76, right: 48, down: 6 };   // around a label's point
export function clearOfBoxes(points, boxes, enough = 60) {
  if (!points?.length) return -1;
  let best = -1, bestScore = -Infinity;
  points.forEach(([x, y], i) => {
    let near = Infinity;
    for (const [l, t, r, b] of boxes || []) {
      const dx = Math.max(l - x, 0, x - r), dy = Math.max(t - y, 0, y - b);
      near = Math.min(near, Math.hypot(dx, dy));
    }
    const middle = points.length > 1 ? Math.abs(i / (points.length - 1) - 0.5) : 0;
    const score = Math.min(near, enough) - middle * 10;
    if (score > bestScore) { best = i; bestScore = score; }
  });
  return best;
}

// The traffic along a route as stretches of the bar, each a share of the trip
// from 0 to 1: 'slow' where it's slower than usual, 'jam' where it's at a crawl
// or closed. The rest of the bar is clear.
export const CRAWL_S_PER_KM = 90;      // losing this much a kilometre is a jam
export const CRAWL_KMH = 15;

export function trafficBar(length, traffic) {
  if (!traffic || !(length > 0)) return [];
  const out = [];
  for (const j of traffic.jams || []) {
    const from = Math.max(0, j.start / length), to = Math.min(1, j.end / length);
    if (!(to > from)) continue;
    const km = (j.end - j.start) / 1000;
    const crawl = j.kind === 'ROAD_CLOSURE' || (j.speed != null && j.speed <= CRAWL_KMH) || (km > 0 && j.delay / km >= CRAWL_S_PER_KM);
    if (!crawl && !(j.delay > 0) && j.kind !== 'ACCIDENT') continue;
    out.push({ from, to, level: crawl ? 'jam' : 'slow' });
  }
  return out;
}

// The bar as a CSS gradient: clear by default, with each stretch on top.
export function trafficGradient(stretches, colours) {
  const stops = [];
  let at = 0;
  const pct = (x) => `${(x * 100).toFixed(2)}%`;
  for (const s of [...stretches].sort((a, b) => a.from - b.from)) {
    const from = Math.max(at, s.from);
    if (s.to <= from) continue;
    if (from > at) stops.push(`${colours.clear} ${pct(at)} ${pct(from)}`);
    // A stretch too short to see is drawn a little wider.
    const to = Math.min(1, Math.max(s.to, from + 0.012));
    stops.push(`${colours[s.level]} ${pct(from)} ${pct(to)}`);
    at = to;
  }
  if (at < 1) stops.push(`${colours.clear} ${pct(at)} 100%`);
  return `linear-gradient(90deg, ${stops.join(', ')})`;
}
