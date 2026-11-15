// The labels on the map beside each route on offer ("3 j 48 min · Tol RM27.10"),
// and the coloured bar on each route that shows where the traffic is.
//
// A label goes where its route is furthest from the others, so you can tell
// whose label it is, and not too near the ends, where routes run together.

const M_PER_DEG = 111320;
const SAMPLES = 160;          // points kept from each other line, to compare against
const FROM = 0.1, TO = 0.9, STEP = 0.025;

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

// How big the whole picture is, in metres: the routes are fitted to the screen,
// so this says how far apart things must be to look apart.
function spanOf(lines, k) {
  let w = Infinity, e = -Infinity, so = Infinity, n = -Infinity;
  for (const c of lines) {
    if (!c) continue;
    for (const [lng, lat] of c) {
      if (lng < w) w = lng;
      if (lng > e) e = lng;
      if (lat < so) so = lat;
      if (lat > n) n = lat;
    }
  }
  return Number.isFinite(w) ? Math.max((e - w) * k, n - so) * M_PER_DEG : 0;
}

// One spot per line. Above all, labels mustn't cover each other; then each is
// best away from the other routes, and near the middle of its own. This is
// worked out on the screen as it will be once the routes are fitted to it:
// `pxPerM` says how many pixels a metre will be (by default, the whole picture
// about 300 px across), and `label` how big a label is.
export const LABEL_PX = { w: 104, h: 58, lift: 8 };

// About how big a label with these words will be on the screen.
export function labelSize(time, note) {
  const w = Math.max(String(time || '').length * 9.4, String(note || '').length * 7.3) + 24;
  return { w: Math.ceil(w), h: note ? 48 : 30 };
}

// Each label is placed in turn, then each placed again with the others where
// they ended up, so the first doesn't take the only spot the rest could use.
// `sizes` gives each label's own size; LABEL_PX is used where it doesn't.
export function labelSpots(lines, { pxPerM = null, label = LABEL_PX, sizes = [] } = {}) {
  const valid = (lines || []).map((c) => (Array.isArray(c) && c.length ? c : null));
  const lat0 = valid.find(Boolean)?.[0]?.[1] ?? 0;
  const k = Math.cos((lat0 * Math.PI) / 180);
  const scale = pxPerM || 300 / Math.max(300, spanOf(valid, k));
  // To pixels, with up as up.
  const px = ([lng, lat]) => [lng * k * M_PER_DEG * scale, lat * M_PER_DEG * scale];
  const thinned = valid.map((c) => (c ? thin(c).map(px) : null));
  const size = (i) => sizes[i] || label;
  const spots = valid.map(() => null), at = valid.map(() => null);
  // A box is drawn above its point; how far apart two are (below 0: they overlap).
  const gapBetween = ([x1, y1], s1, [x2, y2], s2) => Math.max(Math.abs(x1 - x2) - (s1.w + s2.w) / 2 - 4, Math.abs(y1 - y2) - (y1 > y2 ? s1.h : s2.h) - 4);
  const place = (i) => {
    const coords = valid[i];
    let best = null;
    for (let share = FROM; share <= TO + 1e-9; share += STEP) {
      const p = pointAlong(coords, share);
      const xy = px(p);
      let gap = Infinity;
      at.forEach((other, j) => { if (j !== i && other) gap = Math.min(gap, gapBetween(xy, size(i), other, size(j))); });
      let nearLine = Infinity;
      thinned.forEach((other, j) => {
        if (j === i || !other) return;
        for (const [qx, qy] of other) nearLine = Math.min(nearLine, Math.hypot(xy[0] - qx, xy[1] - qy));
      });
      const score = (gap < 0 ? gap * 10 : Math.min(gap, 24) * 2) + Math.min(nearLine, 40) - Math.abs(share - 0.5) * 20;
      if (!best || score > best.score) best = { score, p, xy };
    }
    spots[i] = best.p;
    at[i] = best.xy;
  };
  for (let pass = 0; pass < 2; pass++) valid.forEach((c, i) => { if (c) place(i); });
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
