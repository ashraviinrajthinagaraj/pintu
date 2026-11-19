// Trips by bus, train and on foot. Pintu's server asks Transitous
// (https://transitous.org), a free, community-run journey planner fed with the
// operators' own timetables, and passes back each way there: the walks, every
// bus and train with its number, colour and stops, and when each leaves.

import { decodePolyline } from './geo.js';

// What sort of thing each part of a trip is on.
const KINDS = {
  WALK: 'walk', BUS: 'bus', COACH: 'bus', ODM: 'bus', FLEX: 'bus',
  SUBWAY: 'metro', METRO: 'metro', TRAM: 'tram', FUNICULAR: 'tram',
  RAIL: 'train', REGIONAL_RAIL: 'train', REGIONAL_FAST_RAIL: 'train', HIGHSPEED_RAIL: 'train',
  LONG_DISTANCE: 'train', NIGHT_RAIL: 'train', SUBURBAN: 'train',
  FERRY: 'ferry', AIRPLANE: 'plane', AERIAL_LIFT: 'cable', AREAL_LIFT: 'cable', CABLE_CAR: 'cable',
};
export const kindOf = (mode) => KINDS[mode] || 'other';

export const KIND_COLOUR = { walk: '#8A96A3', bus: '#1565C0', train: '#3C5A9F', metro: '#6B7280', tram: '#00897B', ferry: '#0277BD', plane: '#455A64', cable: '#6D4C41', other: '#6B7280' };
// Singapore's MRT and LRT lines come without their colours.
const LINE_COLOURS = {
  NS: '#D42E12', EW: '#009645', CG: '#009645', NE: '#9900AA', CC: '#FA9E0D', CE: '#FA9E0D',
  DT: '#005EC4', TE: '#9D5B25', BP: '#748477', SK: '#748477', PG: '#748477', SE: '#748477', SW: '#748477', PE: '#748477', PW: '#748477',
};

const colourOf = (hex, kind, name) => {
  if (/^[0-9a-f]{6}$/i.test(hex || '')) {
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
    // White or nearly: it would vanish on the map and on the page.
    if (0.2126 * r + 0.7152 * g + 0.0722 * b <= 225) return `#${hex.toUpperCase()}`;
  }
  return (kind === 'metro' && LINE_COLOURS[name]) || KIND_COLOUR[kind] || KIND_COLOUR.other;
};
// Dark writing on a light colour, white on a dark one.
export function textOn(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 160 ? '#15191C' : '#FFFFFF';
}

const KEEP_UPPER = new Set(['KL', 'KLCC', 'KTM', 'MRT', 'LRT', 'BRT', 'ETS', 'USJ', 'SS', 'PJ', 'UKM', 'UPM', 'UM', 'IOI', 'TRX', 'KLIA', 'KLIA2',
  'PWTC', 'UIA', 'TBS', 'BSI', 'PPR', 'KTMB', 'UITM', 'HKL', 'JB', 'CIQ', 'DBKL', 'USM', 'KK', 'TTDI', 'MITC', 'KB', 'KT', 'MRR2', 'SMK', 'SK', 'SJK', 'LRT3', 'MMU', 'AEON', 'KPJ', 'II', 'III', 'IV']);

// A stop's name as people say it: "PJ347 KOMERSIAL SS2 (POH KONG)" becomes
// "Komersial SS2 (Poh Kong)". Names already written properly are left alone.
export function placeName(raw) {
  let s = String(raw || '').trim().replace(/\s+/g, ' ');
  // Rapid KL's bus stops start with their code.
  s = s.replace(/^[A-Z]{1,4}\d{2,5}[A-Z]?\s+(?=\S)/, '');
  if (/[a-z]/.test(s)) return s;
  return s.toLowerCase().replace(/[a-z0-9']+/g, (w) => {
    const up = w.toUpperCase();
    if (KEEP_UPPER.has(up) || /\d/.test(w)) return up;
    return w[0].toUpperCase() + w.slice(1);
  });
}

const ms = (iso) => (iso ? Date.parse(iso) : NaN);
const at = (p) => ({
  name: p?.name || '',
  lng: p?.lon,
  lat: p?.lat,
  at: ms(p?.at),
  planned: ms(p?.planned),
  track: p?.track || '',
  cancelled: !!p?.cancelled,
});

function legOf(l, ends) {
  const kind = kindOf(l.mode);
  const named = (p, end) => {
    const place = at(p);
    // Where the trip starts and ends are yours, not stops.
    if (p?.name === 'START' || p?.name === 'END') place.name = ends[end] || '';
    else place.name = placeName(place.name);
    return place;
  };
  const leg = {
    kind,
    mode: l.mode,
    from: named(l.from, 'from'),
    to: named(l.to, 'to'),
    start: ms(l.start),
    end: ms(l.end),
    seconds: l.seconds ?? Math.round((ms(l.end) - ms(l.start)) / 1000),
    coords: l.line ? decodePolyline(l.line, l.precision ?? 6) : [],
  };
  if (kind === 'walk') {
    leg.metres = l.metres ?? 0;
    leg.colour = KIND_COLOUR.walk;
    return leg;
  }
  const name = String(l.name || '').trim();
  leg.name = name;
  leg.long = placeName(l.long || '');
  leg.colour = colourOf(l.colour, kind, name);
  leg.text = textOn(leg.colour);
  leg.agency = l.agency || '';
  leg.toward = placeName(l.toward || '');
  leg.live = !!l.live;
  leg.cancelled = !!l.cancelled;
  leg.stay = !!l.stay;
  leg.planStart = ms(l.planStart);
  // How late it's running, when that's known.
  leg.late = leg.live && Number.isFinite(leg.planStart) ? Math.round((leg.start - leg.planStart) / 1000) : null;
  leg.stops = (l.stops || []).map(([n, t]) => ({ name: placeName(n), at: ms(t) }));
  return leg;
}

function tripOf(t, ends) {
  const legs = (t.legs || []).map((l) => legOf(l, ends));
  const rides = legs.filter((l) => l.kind !== 'walk');
  const start = ms(t.start), end = ms(t.end);
  return {
    start,
    end,
    seconds: t.seconds ?? Math.round((end - start) / 1000),
    transfers: t.transfers ?? Math.max(0, rides.length - 1),
    legs,
    first: rides[0] || null,
    walkSeconds: legs.filter((l) => l.kind === 'walk').reduce((a, l) => a + l.seconds, 0),
    key: `${start}|${end}|${rides.map((r) => `${r.name}@${r.start}`).join(',')}`,
  };
}

// The server's answer made ready to show: { trips, walk, earlier, later }.
// `ends` names the start and the destination ({ from, to }).
export function prepareTrips(json, ends = {}) {
  return {
    trips: (json?.trips || []).map((t) => tripOf(t, ends)).filter((t) => Number.isFinite(t.start) && t.legs.length),
    walk: json?.walk ? tripOf(json.walk, ends) : null,
    earlier: json?.earlier || null,
    later: json?.later || null,
  };
}

// Trips from a later or earlier page added to those already shown, in order, without repeats.
export function mergeTrips(shown, more) {
  const seen = new Set();
  return [...shown, ...more]
    .filter((t) => !seen.has(t.key) && seen.add(t.key))
    .sort((a, b) => a.start - b.start || a.end - b.end);
}

export class JourneyError extends Error {
  constructor(code) { super(code); this.code = code; }
}

// Asks the server for trips from `from` to `to` (each { lat, lng }).
export async function planTrips({ server, from, to, when = null, arriveBy = false, cursor = null, lang = 'ms', version = '', fetchImpl = (...a) => fetch(...a), signal } = {}) {
  if (!server) throw new JourneyError('unavailable');
  const u = new URL(`${server}/transit`);
  u.searchParams.set('from', `${from.lat.toFixed(6)},${from.lng.toFixed(6)}`);
  u.searchParams.set('to', `${to.lat.toFixed(6)},${to.lng.toFixed(6)}`);
  if (when) u.searchParams.set('time', new Date(when).toISOString());
  if (when && arriveBy) u.searchParams.set('arriveBy', '1');
  if (cursor) u.searchParams.set('cursor', cursor);
  u.searchParams.set('lang', lang);
  if (version) u.searchParams.set('v', version);
  let res;
  try {
    res = await fetchImpl(u.href, { signal });
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new JourneyError('offline');
  }
  if (res.status === 429) throw new JourneyError('busy');
  if (!res.ok) throw new JourneyError('unavailable');
  return res.json();
}

// The trip on the map: each part as a line in its colour (walks dashed), and a
// dot where you get on and off.
export function journeyFeatures(trip) {
  const features = [];
  for (const leg of trip?.legs || []) {
    const coords = leg.coords.length > 1 ? leg.coords
      : [[leg.from.lng, leg.from.lat], [leg.to.lng, leg.to.lat]].filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
    if (coords.length > 1) {
      features.push({ type: 'Feature', properties: { c: leg.colour, walk: leg.kind === 'walk' }, geometry: { type: 'LineString', coordinates: coords } });
    }
    if (leg.kind === 'walk') continue;
    for (const p of [leg.from, leg.to]) {
      if (Number.isFinite(p.lng) && Number.isFinite(p.lat)) {
        features.push({ type: 'Feature', properties: { c: leg.colour, stop: true }, geometry: { type: 'Point', coordinates: [p.lng, p.lat] } });
      }
    }
  }
  return { type: 'FeatureCollection', features };
}

// Every point of the trip, to fit it on screen.
export const journeyCoords = (trip) => (trip?.legs || []).flatMap((l) => (l.coords.length ? l.coords : [[l.from.lng, l.from.lat], [l.to.lng, l.to.lat]]))
  .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));

// The parts worth a chip in a trip's summary: every ride, and walks of two minutes or more.
export const summaryLegs = (trip) => (trip?.legs || []).filter((l) => l.kind !== 'walk' || l.seconds >= 120);
