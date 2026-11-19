// Buses and trains on the map. The LRT, MRT, monorail and BRT lines in their
// colours, and stations, come from data/transit.json (built each week by
// scripts/transit-data.mjs from Prasarana's, KTMB's and BAS.MY's timetables on
// data.gov.my, CC BY 4.0). Where each bus and KTM train is right now comes
// straight from data.gov.my's live feeds, which the phone asks for itself,
// only for the feeds the map is looking at and no faster than the portal allows.
// The LRT and MRT have no live feed yet, so their trains aren't shown.

const URL_ = './data/transit.json';
export const MIN_GAP_MS = 16000;     // the portal allows four requests a minute
export const FEED_EVERY_MS = 30000;  // and each feed is updated every 30 s
export const BACKOFF_MS = 90000;     // after a refusal or a failure
export const KEEP_MS = 10 * 60000;   // a position older than this is no use
export const MIN_ZOOM = 11;          // further out there are too many to make sense of

let loading = null;
export function loadTransit({ fetchImpl = (...a) => fetch(...a) } = {}) {
  loading ||= fetchImpl(URL_)
    .then((res) => {
      if (!res.ok) throw new Error(`transit ${res.status}`);
      return res.json();
    })
    .then((json) => ({
      lines: (json?.lines || []).filter((l) => Array.isArray(l?.line) && l.line.length > 1),
      stations: (json?.stations || []).filter((s) => Array.isArray(s) && Number.isFinite(s[1]) && Number.isFinite(s[2])),
      feeds: (json?.feeds || []).filter((f) => f?.id && /^https:\/\/api\.data\.gov\.my\//.test(f.url || '') && Array.isArray(f.box)),
    }))
    .catch((err) => { loading = null; throw err; });
  return loading;
}
export const forgetTransit = () => { loading = null; };

/* ---------- Reading a live feed (GTFS Realtime, a protocol buffer) ---------- */

// Just enough of the format for vehicle positions: each field's number and
// value, skipping what isn't needed.
function* fields(bytes, start = 0, end = bytes.length) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = start;
  const varint = () => {
    let n = 0, mul = 1, b;
    do {
      if (at >= end) throw new Error('cut short');
      b = bytes[at++];
      n += (b & 0x7f) * mul;
      mul *= 128;
    } while (b & 0x80);
    return n;
  };
  while (at < end) {
    const key = varint();
    const field = Math.floor(key / 8), wire = key % 8;
    if (wire === 0) yield { field, value: varint() };
    else if (wire === 1) {
      if (at + 8 > end) throw new Error('cut short');
      yield { field, double: view.getFloat64(at, true) };
      at += 8;
    } else if (wire === 2) {
      const len = varint();
      if (at + len > end) throw new Error('cut short');
      yield { field, start: at, end: at + len };
      at += len;
    } else if (wire === 5) {
      if (at + 4 > end) throw new Error('cut short');
      yield { field, float: view.getFloat32(at, true) };
      at += 4;
    } else throw new Error(`wire type ${wire}`);
  }
}
const text = (bytes, f) => new TextDecoder().decode(bytes.subarray(f.start, f.end));

function vehicleOf(bytes, start, end) {
  const v = { id: '', trip: '', route: '', lat: NaN, lng: NaN, bearing: null, at: null, label: '' };
  for (const f of fields(bytes, start, end)) {
    if (f.field === 1 && f.start != null) {          // TripDescriptor
      for (const g of fields(bytes, f.start, f.end)) {
        if (g.field === 1 && g.start != null) v.trip = text(bytes, g);
        else if (g.field === 5 && g.start != null) v.route = text(bytes, g);
      }
    } else if (f.field === 2 && f.start != null) {   // Position
      for (const g of fields(bytes, f.start, f.end)) {
        const num = g.float ?? g.double;
        if (g.field === 1) v.lat = num;
        else if (g.field === 2) v.lng = num;
        else if (g.field === 3 && Number.isFinite(num)) v.bearing = num;
      }
    } else if (f.field === 5 && f.value != null) v.at = f.value * 1000;
    else if (f.field === 8 && f.start != null) {     // VehicleDescriptor
      for (const g of fields(bytes, f.start, f.end)) {
        if (g.field === 1 && g.start != null) v.id = text(bytes, g);
        else if (g.field === 2 && g.start != null) v.label = text(bytes, g);
      }
    }
  }
  return v;
}

// Every vehicle in a feed: { at (ms, the feed's time), vehicles: [{ id, trip,
// route, lat, lng, bearing, at, label }] }. Only plausible positions are kept.
export function decodeFeed(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let at = null;
  const vehicles = [];
  for (const f of fields(bytes)) {
    if (f.field === 1 && f.start != null) {          // FeedHeader
      for (const g of fields(bytes, f.start, f.end)) if (g.field === 3 && g.value != null) at = g.value * 1000;
    } else if (f.field === 2 && f.start != null) {   // FeedEntity
      let id = '';
      for (const g of fields(bytes, f.start, f.end)) {
        if (g.field === 1 && g.start != null) id = text(bytes, g);
        else if (g.field === 4 && g.start != null) {
          const v = vehicleOf(bytes, g.start, g.end);
          v.id ||= id;
          // Malaysia and Singapore, not a bus parked at 0,0 with no fix.
          if (v.lat > 0.5 && v.lat < 7.6 && v.lng > 99 && v.lng < 119.5) vehicles.push(v);
        }
      }
    }
  }
  return { at, vehicles };
}

/* ---------- Which feeds to ask for, and when ---------- */

export const overlaps = (a, b) => !!a && !!b && a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];

// Keeps the live positions of the feeds in view up to date, one request at a
// time and never more often than the portal allows.
export class LiveTransit {
  constructor({ feeds, fetchImpl = (...a) => fetch(...a), now = () => Date.now(), onUpdate = () => {} }) {
    this.feeds = feeds;
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.onUpdate = onUpdate;
    this.state = new Map();   // feed id → { fetched, vehicles, until }
    this.lastAsk = -Infinity;
    this.busy = false;
  }

  inView(box) { return this.feeds.filter((f) => overlaps(f.box, box)); }

  // The feed to ask for next, if any may be asked for now.
  due(box, zoom) {
    if (this.busy || zoom < MIN_ZOOM || !box) return null;
    const now = this.now();
    if (now - this.lastAsk < MIN_GAP_MS) return null;
    let best = null, bestAt = Infinity;
    for (const f of this.inView(box)) {
      const s = this.state.get(f.id);
      if (s && (now < s.until || now - s.fetched < FEED_EVERY_MS)) continue;
      const at = s?.fetched ?? -Infinity;
      if (at < bestAt) { best = f; bestAt = at; }
    }
    return best;
  }

  // Asks for the next feed due, if any; true when something new came.
  async poll(box, zoom) {
    const feed = this.due(box, zoom);
    if (!feed) return false;
    this.busy = true;
    this.lastAsk = this.now();
    const s = this.state.get(feed.id) || { fetched: -Infinity, vehicles: [], until: 0 };
    this.state.set(feed.id, s);
    try {
      const res = await this.fetchImpl(feed.url, { cache: 'no-store' });
      if (!res.ok) throw new Error(`${feed.id} ${res.status}`);
      const got = decodeFeed(await res.arrayBuffer());
      const now = this.now();
      s.fetched = now;
      s.until = 0;
      // A vehicle's own clock can be badly wrong; then the feed's, or ours.
      const sane = (t) => (t && t <= now + 5 * 60000 && t > now - 24 * 3600000 ? t : null);
      s.vehicles = got.vehicles.map((v) => ({ ...v, at: sane(v.at) ?? sane(got.at) ?? now }));
      this.onUpdate();
      return true;
    } catch {
      s.until = this.now() + BACKOFF_MS;
      return false;
    } finally {
      this.busy = false;
    }
  }

  // Every vehicle known and recent enough, with its feed.
  vehicles() {
    const now = this.now();
    const out = [];
    for (const f of this.feeds) {
      const s = this.state.get(f.id);
      for (const v of s?.vehicles || []) if (now - v.at < KEEP_MS) out.push({ ...v, feed: f });
    }
    return out;
  }

  clear() { this.state.clear(); this.lastAsk = -Infinity; }
}

/* ---------- What a vehicle is ---------- */

// Its route: { number, name, colour }, from the feed's timetable.
export function routeOf(v, feed) {
  const id = v.route || feed?.trips?.[v.trip] || '';
  const r = feed?.routes?.[id];
  const fallback = feed?.kind === 'train' ? '#3C5A9F' : '#1565C0';
  // A feed with no timetable: its id, if that's a route number people would know ("K10").
  const bare = !Object.keys(feed?.routes || {}).length && /^[A-Z]{0,3}\d{1,4}[A-Z]?$/.test(id);
  if (!r) return { number: bare ? id : '', name: '', colour: fallback };
  return { number: r[0] || '', name: r[1] || '', colour: r[2] || fallback };
}

// For the map: each vehicle as a point, coloured by its route.
export function vehicleFeatures(list) {
  return {
    type: 'FeatureCollection',
    features: list.map((v) => {
      const r = routeOf(v, v.feed);
      return {
        type: 'Feature',
        properties: { k: v.feed.kind, c: r.colour, n: r.number.length <= 6 ? r.number : '', feed: v.feed.id, id: v.id, at: v.at },
        geometry: { type: 'Point', coordinates: [v.lng, v.lat] },
      };
    }),
  };
}

export function lineFeatures(data) {
  return {
    type: 'FeatureCollection',
    features: (data?.lines || []).map((l) => ({
      type: 'Feature',
      properties: { c: l.colour, name: l.name },
      geometry: { type: 'LineString', coordinates: l.line },
    })),
  };
}

export function stationFeatures(data) {
  return {
    type: 'FeatureCollection',
    features: (data?.stations || []).map(([name, lat, lng, colour]) => ({
      type: 'Feature',
      properties: { c: colour, name },
      geometry: { type: 'Point', coordinates: [lng, lat] },
    })),
  };
}
