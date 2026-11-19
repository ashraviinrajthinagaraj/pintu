// Builds data/transit.json, for buses and trains on the map:
//  - the Klang Valley's LRT, MRT, monorail and BRT lines, in their colours, and
//    their stations and KTM's, from the operators' timetables;
//  - each live feed of bus and train positions: where it covers, and the name
//    and colour of each of its routes, so a bus on the map can say which it is.
// From the timetables Prasarana, KTMB and BAS.MY publish on data.gov.my, under
// CC BY 4.0. Run each week by .github/workflows/transit-data.yml.
//
//   node scripts/transit-data.mjs [out-file]
import { readFile, writeFile } from 'node:fs/promises';
import { inflateRawSync } from 'node:zlib';

const STATIC = 'https://api.data.gov.my/gtfs-static';
const LIVE = 'https://api.data.gov.my/gtfs-realtime/vehicle-position';
const RAIL = `${STATIC}/prasarana?category=rapid-rail-kl`;
// Every feed of live positions, and the timetable that goes with it.
export const FEEDS = [
  { id: 'rapid-bus-kl', name: 'Rapid KL', kind: 'bus', path: 'prasarana?category=rapid-bus-kl' },
  { id: 'rapid-bus-mrtfeeder', name: 'Rapid KL', kind: 'bus', path: 'prasarana?category=rapid-bus-mrtfeeder' },
  { id: 'rapid-bus-penang', name: 'Rapid Penang', kind: 'bus', path: 'prasarana?category=rapid-bus-penang' },
  { id: 'ktmb', name: 'KTM', kind: 'train', path: 'ktmb' },
  { id: 'mybas-kangar', name: 'BAS.MY Kangar', kind: 'bus', path: 'mybas-kangar' },
  { id: 'mybas-alor-setar', name: 'BAS.MY Alor Setar', kind: 'bus', path: 'mybas-alor-setar' },
  { id: 'mybas-kota-bharu', name: 'BAS.MY Kota Bharu', kind: 'bus', path: 'mybas-kota-bharu' },
  { id: 'mybas-kuala-terengganu', name: 'BAS.MY Kuala Terengganu', kind: 'bus', path: 'mybas-kuala-terengganu' },
  { id: 'mybas-ipoh', name: 'BAS.MY Ipoh', kind: 'bus', path: 'mybas-ipoh' },
  { id: 'mybas-seremban-a', name: 'BAS.MY Seremban', kind: 'bus', path: 'mybas-seremban-a' },
  { id: 'mybas-seremban-b', name: 'BAS.MY Seremban', kind: 'bus', path: 'mybas-seremban-b' },
  { id: 'mybas-melaka', name: 'BAS.MY Melaka', kind: 'bus', path: 'mybas-melaka' },
  { id: 'mybas-johor', name: 'BAS.MY Johor Bahru', kind: 'bus', path: 'mybas-johor' },
  { id: 'mybas-kuching', name: 'BAS.MY Kuching', kind: 'bus', path: 'mybas-kuching' },
];
export const DEFAULT_COLOUR = { bus: '#1565C0', train: '#3C5A9F', rail: '#6B7280' };
// The data portal allows four requests a minute.
const GAP_MS = 16000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The files in a zip, by name: only those asked for, stored or deflated (all GTFS uses).
export function unzip(buf, wanted = null) {
  let end = buf.length - 22;
  while (end >= 0 && buf.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0) throw new Error('not a zip');
  const count = buf.readUInt16LE(end + 10);
  let at = buf.readUInt32LE(end + 16);
  const files = {};
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(at) !== 0x02014b50) throw new Error('bad zip directory');
    const method = buf.readUInt16LE(at + 10);
    const size = buf.readUInt32LE(at + 20);
    const nameLen = buf.readUInt16LE(at + 28), extraLen = buf.readUInt16LE(at + 30), commentLen = buf.readUInt16LE(at + 32);
    const local = buf.readUInt32LE(at + 42);
    const path = buf.toString('utf8', at + 46, at + 46 + nameLen);
    at += 46 + nameLen + extraLen + commentLen;
    const name = path.split('/').pop().toLowerCase();
    // Mac copies of each file ride along in some of them.
    if (!name || path.startsWith('__MACOSX') || name.startsWith('._')) continue;
    if (wanted && !wanted.includes(name)) continue;
    const dataAt = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(dataAt, dataAt + size);
    files[name] = (method === 8 ? inflateRawSync(raw) : raw).toString('utf8');
  }
  return files;
}

// Rows of a CSV file as objects, quoted fields and all.
export function csv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  const s = String(text || '').replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') { field += '"'; i++; } else if (c === '"') quoted = false; else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return [];
  const [head, ...body] = rows;
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] ?? '').trim()])));
}

const KEEP_UPPER = new Set(['KL', 'KLCC', 'KTM', 'MRT', 'LRT', 'BRT', 'USJ', 'SS', 'PJ', 'UKM', 'UPM', 'IOI', 'TRX', 'KLIA', 'KLIA2', 'KPJ',
  'PWTC', 'MAEPS', 'UIA', 'IIUM', 'TBS', 'BSI', 'PPR', 'KTMB', 'ETS', 'KWC', 'UTM', 'UITM', 'UNITEN', 'HKL', 'HUKM', 'JB', 'CIQ', 'MBSA',
  'MBPJ', 'DBKL', 'PPUM', 'UM', 'USM', 'KK', 'BBCC', 'LCCT', 'II', 'III', 'IV', 'TTDI', 'MITC', 'ICT', 'RTC', 'KB', 'KT', 'MRR2']);
// Names written all in capitals, "TAMAN BAHAGIA", become "Taman Bahagia",
// leaving "KL", "SS 15" and "U8210" as they are. Names already in mixed case stay.
export function nameCase(s) {
  const text = String(s || '').trim().replace(/\s+/g, ' ');
  if (/[a-z]/.test(text)) return text;
  return text.toLowerCase().replace(/[a-z0-9']+/g, (w) => {
    const up = w.toUpperCase();
    if (KEEP_UPPER.has(up) || /\d/.test(w)) return up;
    return w[0].toUpperCase() + w.slice(1);
  });
}

// Fewer points along a line, none moved more than `tolerance` metres off it.
export function simplify(points, tolerance = 10) {
  if (points.length < 3) return points;
  const off = (p, a, b) => {
    const k = Math.cos((a[1] * Math.PI) / 180);
    const ax = a[0] * k, ay = a[1], bx = b[0] * k, by = b[1], px = p[0] * k, py = p[1];
    const dx = bx - ax, dy = by - ay;
    const len = dx * dx + dy * dy;
    const t = len ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len)) : 0;
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy)) * 111320;
  };
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    let worst = -1, at = -1;
    for (let i = s + 1; i < e; i++) {
      const d = off(points[i], points[s], points[e]);
      if (d > worst) { worst = d; at = i; }
    }
    if (worst > tolerance) { keep[at] = 1; stack.push([s, at], [at, e]); }
  }
  return points.filter((_, i) => keep[i]);
}

const round = (x) => Math.round(x * 1e5) / 1e5;
// A route's own colour, unless it's missing or so pale it would vanish on the map.
export function colourOf(c, fallback) {
  if (!/^[0-9a-f]{6}$/i.test(c || '')) return fallback;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16));
  if (0.2126 * r + 0.7152 * g + 0.0722 * b > 225) return fallback;
  return `#${c.toUpperCase()}`;
}
const point = (s) => {
  const lat = Number(s.stop_lat), lng = Number(s.stop_lon);
  // Inside Malaysia and Singapore, or it's a slip in the data.
  return lat > 0.5 && lat < 7.6 && lng > 99 && lng < 119.5 ? [lng, lat] : null;
};

// The area a feed covers, from its stops, with some room around it.
export function boxOf(stops, pad = 0.05) {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const st of stops) {
    const p = point(st);
    if (!p) continue;
    w = Math.min(w, p[0]); e = Math.max(e, p[0]); s = Math.min(s, p[1]); n = Math.max(n, p[1]);
  }
  if (!Number.isFinite(w)) return null;
  return [round(w - pad), round(s - pad), round(e + pad), round(n + pad)];
}

// The LRT, MRT, monorail and BRT lines, one way along each, and their stations.
export function railLines(rail) {
  const routes = csv(rail['routes.txt']);
  const trips = csv(rail['trips.txt']);
  const shapes = new Map();
  for (const p of csv(rail['shapes.txt'])) {
    if (!shapes.has(p.shape_id)) shapes.set(p.shape_id, []);
    shapes.get(p.shape_id).push([Number(p.shape_pt_sequence), Number(p.shape_pt_lon), Number(p.shape_pt_lat)]);
  }
  const colours = {};
  const lines = [];
  for (const r of routes) {
    if (r.status && r.status !== 'valid') continue;
    const colour = colourOf(r.route_color, DEFAULT_COLOUR.rail);
    colours[r.route_id] = colour;
    const trip = trips.find((t) => t.route_id === r.route_id && t.direction_id === '0' && shapes.has(t.shape_id))
      || trips.find((t) => t.route_id === r.route_id && shapes.has(t.shape_id));
    if (!trip) continue;
    const pts = shapes.get(trip.shape_id).slice().sort((a, b) => a[0] - b[0])
      .map(([, lng, lat]) => [lng, lat]).filter((p) => point({ stop_lat: p[1], stop_lon: p[0] }));
    if (pts.length < 2) continue;
    lines.push({
      id: r.route_id,
      name: nameCase(r.route_long_name || r.route_short_name),
      kind: r.category || 'LRT',
      colour,
      line: simplify(pts).map(([lng, lat]) => [round(lng), round(lat)]),
    });
  }
  const stations = [];
  for (const s of csv(rail['stops.txt'])) {
    if (s.status && s.status !== 'valid') continue;
    const p = point(s);
    if (!p) continue;
    stations.push([nameCase(s.stop_name), round(p[1]), round(p[0]), colours[s.route_id] || DEFAULT_COLOUR.rail]);
  }
  return { lines, stations };
}

// KTM's stations, each in the colour of the line most of its trains run on.
export function ktmStations(ktm) {
  const colour = Object.fromEntries(csv(ktm['routes.txt']).map((r) => [r.route_id, colourOf(r.route_color, DEFAULT_COLOUR.train)]));
  const routeOfTrip = Object.fromEntries(csv(ktm['trips.txt']).map((t) => [t.trip_id, t.route_id]));
  const counts = new Map();
  for (const st of csv(ktm['stop_times.txt'])) {
    const route = routeOfTrip[st.trip_id];
    if (!route) continue;
    const c = counts.get(st.stop_id) || new Map();
    c.set(route, (c.get(route) || 0) + 1);
    counts.set(st.stop_id, c);
  }
  const out = [];
  for (const s of csv(ktm['stops.txt'])) {
    const p = point(s);
    if (!p) continue;
    const c = [...(counts.get(s.stop_id) || new Map())].sort((a, b) => b[1] - a[1])[0];
    out.push([nameCase(s.stop_name), round(p[1]), round(p[0]), colour[c?.[0]] || DEFAULT_COLOUR.train]);
  }
  return out;
}

// What a live feed needs: where it covers, and its routes by id as
// [number or short name, long name, colour]; KTM's trains by trip too.
export function feedOf(def, files) {
  const fallback = DEFAULT_COLOUR[def.kind];
  const routes = {};
  for (const r of csv(files['routes.txt'])) {
    if (!r.route_id) continue;
    let short = nameCase(r.route_short_name || '');
    const long = nameCase(r.route_long_name || '');
    // Some put the route's name in both and its number only in its id ("N50").
    if (short && short === long && /^[A-Z]{0,3}\d{1,4}[A-Z]?$/.test(r.route_id)) short = r.route_id;
    routes[r.route_id] = [short || long || r.route_id, short && short !== long ? long : '', colourOf(r.route_color, fallback)];
  }
  const feed = {
    id: def.id,
    name: def.name,
    kind: def.kind,
    url: `${LIVE}/${def.path}`,
    box: boxOf(csv(files['stops.txt'])),
    routes,
  };
  if (def.kind === 'train') feed.trips = Object.fromEntries(csv(files['trips.txt']).map((t) => [t.trip_id, t.route_id]).filter(([a, b]) => a && b));
  return feed;
}

async function download(url) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: { 'user-agent': 'Pintu transit-data (https://github.com/ashraviinrajthinagaraj/pintu)' } });
    if (res.ok) return Buffer.from(await res.arrayBuffer());
    if (attempt >= 2 || (res.status !== 429 && res.status < 500)) throw new Error(`${res.status} from ${url}`);
    await sleep(GAP_MS * 3);
  }
}

async function main() {
  const out = process.argv[2] || 'data/transit.json';
  // What was there before stands in for a feed that can't be had this week.
  let before = {};
  try { before = JSON.parse(await readFile(out, 'utf8')); } catch { /* the first time */ }
  const oldFeed = Object.fromEntries((before.feeds || []).map((f) => [f.id, f]));

  const rail = unzip(await download(RAIL), ['routes.txt', 'trips.txt', 'shapes.txt', 'stops.txt']);
  const { lines, stations } = railLines(rail);
  const feeds = [];
  let ktm = [];
  for (const def of FEEDS) {
    await sleep(GAP_MS);
    try {
      const zip = await download(`${STATIC}/${def.path}`);
      const files = unzip(zip, ['routes.txt', 'stops.txt', 'trips.txt', 'stop_times.txt'].filter((f) => def.kind === 'train' || f === 'routes.txt' || f === 'stops.txt'));
      const feed = feedOf(def, files);
      if (!feed.box || !Object.keys(feed.routes).length) {
        let inside = '';
        try { inside = Object.keys(unzip(zip)).map((n) => `${n} (${unzip(zip)[n].length})`).join(', '); } catch (err) { inside = err.message; }
        throw new Error(`no stops or routes: ${zip.length} bytes holding ${inside || 'nothing'}`);
      }
      feeds.push(feed);
      if (def.id === 'ktmb') ktm = ktmStations(files);
      console.log(`${def.id}: ${Object.keys(feed.routes).length} routes`);
    } catch (err) {
      console.warn(`${def.id}: ${err.message}${oldFeed[def.id] ? ', keeping last week’s' : ''}`);
      if (oldFeed[def.id]) feeds.push(oldFeed[def.id]);
    }
  }
  if (!ktm.length) ktm = (before.stations || []).filter((s) => s[4] === 'ktm').map((s) => s.slice(0, 4));
  if (lines.length < 5 || stations.length < 100 || !feeds.some((f) => f.id === 'rapid-bus-kl')) {
    throw new Error(`too little: ${lines.length} lines, ${stations.length} stations, ${feeds.length} feeds`);
  }
  const allStations = [...stations, ...ktm.map((s) => [...s, 'ktm'])];
  const list = (rows) => `[\n${rows.map((r) => JSON.stringify(r)).join(',\n')}\n]`;
  await writeFile(out, `{"source":"Prasarana Malaysia, KTMB and BAS.MY, through data.gov.my, under CC BY 4.0",\n`
    + `"lines":${list(lines)},\n"stations":${list(allStations)},\n"feeds":${list(feeds)}}\n`);
  console.log(`Wrote ${lines.length} lines, ${allStations.length} stations and ${feeds.length} feeds to ${out}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((err) => { console.error(err.message); process.exit(1); });
