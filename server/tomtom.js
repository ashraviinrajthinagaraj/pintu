// Everything Pintu asks TomTom goes through here, so the key never leaves the
// server. Each answer is cut down to what the app shows.
//
//   POST /traffic   a route's points: slow stretches, the delay, a faster way
//                   round if there is one, or when to leave to arrive on time
//   GET  /tiles/flow/z/x/y.pbf, /tiles/incidents/z/x/y.pbf   map overlays
//   POST /limits    a route's points: speed limits along it
//   GET  /geocode?q=   addresses
//   POST /ev        an electric car's trip: where to charge, and for how long
//   POST /route     directions, when the usual route server can't answer

import { encodePolyline } from '../js/geo.js';

const TT = 'https://api.tomtom.com';
export const MAX_POINTS = 2000;
const MAX_BODY = 400000;
export const BETTER_PATH_POINTS = 600;
const TILE_SECONDS = { flow: 60, incidents: 120 };
// A short drive in KL, only to check the key works.
export const CHECK_ROUTE = [[101.71230, 3.15790], [101.71800, 3.15900]];

const loc = ([lng, lat]) => `${lat.toFixed(5)},${lng.toFixed(5)}`;
const round5 = (n) => Math.round(n * 1e5) / 1e5;
const pair = (p) => (p && Number.isFinite(p.longitude) && Number.isFinite(p.latitude) ? [round5(p.longitude), round5(p.latitude)] : null);
const num = (v) => (Number.isFinite(v) ? v : null);

export function routePoints(raw, max = MAX_POINTS) {
  if (!Array.isArray(raw) || raw.length < 2 || raw.length > max) return null;
  for (const p of raw) {
    if (!Array.isArray(p) || p.length < 2 || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) return null;
    if (Math.abs(p[0]) > 180 || Math.abs(p[1]) > 90) return null;
  }
  return raw.map((p) => [p[0], p[1]]);
}

// Every TomTom failure comes back as one of a few plain answers.
async function ask(url, init, fetchImpl, notFollowed = 'could not follow the route') {
  const res = await fetchImpl(url, init);
  if (res.ok) return { json: await res.json() };
  let why = '';
  try {
    const raw = await res.text();
    try { why = JSON.parse(raw)?.detailedError?.message || JSON.parse(raw)?.error?.description || raw; } catch { why = raw; }
    why = String(why).slice(0, 160);
  } catch { /* none given */ }
  if (res.status === 401 || res.status === 403) return { fail: { status: 503, body: { error: 'key refused', why } } };
  if (res.status === 429) return { fail: { status: 429, body: { error: 'busy' } } };
  if (res.status === 400 || res.status === 404) return { fail: { status: 422, body: { error: notFollowed, why } } };
  return { fail: { status: 502, body: { error: 'traffic unavailable' } } };
}

// Evenly thinned, keeping both ends.
function thin(points, max) {
  if (points.length <= max) return points;
  const out = [];
  const step = (points.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) out.push(points[Math.round(i * step)]);
  return out;
}

/* ---------- Traffic along a route ---------- */

// What a slow stretch is, from TomTom's category and the causes it gives
// (TPEG TEC codes: 2 accident, 5/1 flooding, 7 standing water, 13 broken-down
// vehicle, and 9 to 14 for things on or across the road).
export function kindOf(sec) {
  const causes = sec.tec?.causes || [];
  const has = (test) => causes.some((c) => test(c.mainCauseCode, c.subCauseCode));
  if (sec.simpleCategory === 'ROAD_CLOSURE') return 'ROAD_CLOSURE';
  if (has((m) => m === 2)) return 'ACCIDENT';
  if (has((m, s) => (m === 5 && s === 1) || m === 7)) return 'FLOOD';
  if (has((m) => m === 13)) return 'BREAKDOWN';
  if (has((m) => [9, 10, 11, 12, 14].includes(m))) return 'HAZARD';
  if (sec.simpleCategory === 'ROAD_WORK' || has((m) => m === 3)) return 'ROAD_WORK';
  if (sec.simpleCategory === 'JAM' || has((m) => m === 1)) return 'JAM';
  return 'OTHER';
}

function slowStretches(route) {
  const along = (route.legs || []).flatMap((leg) => leg.points || []);
  const jams = [];
  for (const sec of route.sections || []) {
    if (sec.sectionType !== 'TRAFFIC') continue;
    const from = pair(along[sec.startPointIndex]), to = pair(along[sec.endPointIndex]);
    if (!from || !to) continue;
    jams.push({
      from,
      to,
      delay: Math.max(0, Math.round(sec.delayInSeconds ?? 0)),
      speed: num(sec.effectiveSpeedInKmh),
      kind: kindOf(sec),
      size: num(sec.magnitudeOfDelay),
    });
  }
  return { along, jams };
}

// TomTom follows Pintu's own route point by point, with today's traffic. It can
// also look for a quicker way to the same place, which must stay on Pintu's
// route for the first stretch so there's time to take it; or work out when to
// leave to arrive at a given time, from how traffic usually is then.
export async function askTraffic(points, key, { better = false, arriveAt = null } = {}, fetchImpl = fetch) {
  const query = new URLSearchParams({
    key,
    traffic: 'true',
    sectionType: 'traffic',
    routeRepresentation: 'polyline',
    computeTravelTimeFor: 'all',
    travelMode: 'car',
  });
  if (arriveAt) query.set('arriveAt', arriveAt);
  else if (better && points.length > 2) {
    query.set('maxAlternatives', '1');
    query.set('alternativeType', 'betterRoute');
    query.set('minDeviationDistance', '500');
  }
  const url = `${TT}/routing/1/calculateRoute/${loc(points[0])}:${loc(points[points.length - 1])}/json?${query}`;
  const init = points.length > 2
    ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ supportingPoints: points.map(([lng, lat]) => ({ latitude: lat, longitude: lng })) }) }
    : { method: 'GET' };
  const { json, fail } = await ask(url, init, fetchImpl);
  if (fail) return fail;
  const route = json.routes?.[0];
  if (!route) return { status: 502, body: { error: 'traffic unavailable' } };
  const { jams } = slowStretches(route);
  const sum = route.summary || {};
  const body = {
    delay: Math.max(0, Math.round(sum.trafficDelayInSeconds ?? 0)),
    travel: num(sum.travelTimeInSeconds),
    length: num(sum.lengthInMeters),
    jams,
  };
  if (arriveAt) {
    body.leave = sum.departureTime || null;
    body.arrive = sum.arrivalTime || null;
  }
  const alt = json.routes?.[1];
  if (alt && !arriveAt) {
    const altSum = alt.summary || {};
    const path = (alt.legs || []).flatMap((leg) => leg.points || []).map(pair).filter(Boolean);
    if (path.length >= 2 && Number.isFinite(altSum.travelTimeInSeconds)) {
      body.better = {
        travel: altSum.travelTimeInSeconds,
        delay: Math.max(0, Math.round(altSum.trafficDelayInSeconds ?? 0)),
        length: num(altSum.lengthInMeters),
        path: thin(path, BETTER_PATH_POINTS),
      };
    }
  }
  return { status: 200, body };
}

/* ---------- Map overlays ---------- */

const TILE = /^\/tiles\/(flow|incidents)\/(\d{1,2})\/(\d{1,7})\/(\d{1,7})\.pbf$/;

export function tileRequest(pathname) {
  const m = TILE.exec(pathname);
  if (!m) return null;
  const [kind, z, x, y] = [m[1], +m[2], +m[3], +m[4]];
  if (z > 18 || x >= 2 ** z || y >= 2 ** z) return null;
  return { kind, z, x, y };
}

// Tiles are kept a minute or two, so everyone looking at the same place shares
// one request to TomTom.
export async function tomtomTile({ kind, z, x, y }, key, origin, { cache = globalThis.caches?.default, fetchImpl = fetch, ctx } = {}) {
  const headers = {
    'content-type': 'application/x-protobuf',
    'cache-control': `public, max-age=${TILE_SECONDS[kind]}`,
    'access-control-allow-origin': origin,
    vary: 'Origin',
  };
  const cacheKey = new Request(`https://tiles.pintu.internal/${kind}/${z}/${x}/${y}`);
  const kept = await cache?.match(cacheKey);
  if (kept) return new Response(kept.body, { status: 200, headers });

  const path = kind === 'flow' ? 'flow/relative' : 'incidents';
  const res = await fetchImpl(`${TT}/traffic/map/4/tile/${path}/${z}/${x}/${y}.pbf?key=${encodeURIComponent(key)}`);
  // An empty tile is fine for the map, and better than an error it keeps retrying.
  if (!res.ok) return new Response(null, { status: res.status === 403 || res.status === 401 ? 503 : 204, headers });
  const body = await res.arrayBuffer();
  if (cache) {
    const save = cache.put(cacheKey, new Response(body, { headers: { 'cache-control': `public, max-age=${TILE_SECONDS[kind]}` } }));
    if (ctx?.waitUntil) ctx.waitUntil(save); else await save;
  }
  return new Response(body, { status: 200, headers });
}

/* ---------- Speed limits ---------- */

// TomTom matches the route to its roads and gives each road's limit. Runs of
// the same limit come back as one stretch, from where it starts to where it ends.
export async function askLimits(points, key, fetchImpl = fetch) {
  const query = new URLSearchParams({
    key,
    fields: '{route{type,geometry{type,coordinates},properties{speedLimits{value,unit,type}}}}',
    vehicleType: 'PassengerCar',
    measurementSystem: 'metric',
  });
  const body = { points: points.map(([lng, lat]) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [lng, lat] }, properties: {} })) };
  const { json, fail } = await ask(`${TT}/snapToRoads/1?${query}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }, fetchImpl);
  if (fail) return fail;
  const stretches = [];
  for (const road of json.route || []) {
    const line = road.geometry?.coordinates;
    if (!Array.isArray(line) || line.length < 2) continue;
    const sl = road.properties?.speedLimits;
    const limit = sl && sl.type !== 'Recommended' && sl.unit !== 'mph' && Number.isFinite(sl.value) && sl.value >= 5 && sl.value <= 130 ? sl.value : null;
    const from = [round5(line[0][0]), round5(line[0][1])], to = [round5(line[line.length - 1][0]), round5(line[line.length - 1][1])];
    const last = stretches[stretches.length - 1];
    if (last && last.limit === limit) last.to = to;
    else stretches.push({ from, to, limit });
  }
  return { status: 200, body: { limits: stretches.filter((s) => s.limit != null) } };
}

/* ---------- Addresses ---------- */

export async function askGeocode(q, near, key, fetchImpl = fetch) {
  const query = new URLSearchParams({ key, countrySet: 'MY,SG,BN', limit: '6', language: 'en-GB' });
  if (near) {
    query.set('lat', near.lat.toFixed(4));
    query.set('lon', near.lng.toFixed(4));
  }
  const { json, fail } = await ask(`${TT}/search/2/geocode/${encodeURIComponent(q)}.json?${query}`, { method: 'GET' }, fetchImpl, 'not found');
  if (fail) return fail;
  const places = [];
  for (const r of json.results || []) {
    const a = r.address || {};
    const lat = r.position?.lat, lng = r.position?.lon;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const street = [a.streetNumber, a.streetName].filter(Boolean).join(' ');
    const name = street || a.municipalitySubdivision || a.municipality || a.freeformAddress || q;
    const area = [a.municipalitySubdivision !== name ? a.municipalitySubdivision : null, a.municipality !== name ? a.municipality : null, a.countrySubdivision]
      .filter(Boolean).filter((v, i, all) => all.indexOf(v) === i).join(', ');
    places.push({ name, detail: area || a.freeformAddress || '', lng: round5(lng), lat: round5(lat), type: r.type || null, country: a.countryCode || null });
  }
  return { status: 200, body: { places } };
}

/* ---------- Electric cars ---------- */

// Consumption at a few steady speeds, from the car's everyday average: slower
// is a little cheaper, and highway speeds cost noticeably more.
export function consumptionCurve(avg) {
  return [[30, 0.75], [60, 0.85], [90, 1.05], [110, 1.25], [130, 1.45]]
    .map(([kmh, f]) => `${kmh},${(avg * f).toFixed(2)}`).join(':');
}

// Malaysia's public chargers are almost all Type 2 for AC and CCS2 for DC.
const PLUGS = ['IEC_62196_Type_2_Outlet', 'IEC_62196_Type_2_Connector_Cable_Attached', 'Combo_to_IEC_62196_Type_2_Base'];

export function evRequest(raw) {
  const points = routePoints(raw?.points, 20);
  const battery = Number(raw?.battery), level = Number(raw?.level), use = Number(raw?.consumption);
  if (!points || !(battery >= 10 && battery <= 200) || !(level >= 1 && level <= 100) || !(use >= 5 && use <= 60)) return null;
  const dc = Math.min(350, Math.max(20, Number(raw?.dcKw) || 100));
  return { points, battery, level, use, dc, avoidTolls: !!raw?.avoidTolls };
}

export async function askEv({ points, battery, level, use, dc, avoidTolls }, key, fetchImpl = fetch) {
  const query = new URLSearchParams({
    key,
    vehicleEngineType: 'electric',
    constantSpeedConsumptionInkWhPerHundredkm: consumptionCurve(use),
    currentChargeInkWh: ((battery * level) / 100).toFixed(1),
    maxChargeInkWh: battery.toFixed(1),
    // Arrive, and reach each charger, with at least a tenth left.
    minChargeAtDestinationInkWh: (battery * 0.1).toFixed(1),
    minChargeAtChargingStopsInkWh: (battery * 0.1).toFixed(1),
    traffic: 'true',
  });
  if (avoidTolls) query.append('avoid', 'tollRoads');
  const body = {
    chargingParameters: {
      batteryCurveInterpolation: 'piecewiseLinear',
      batteryCurve: [
        { stateOfChargeInkWh: battery * 0.1, maxPowerInkW: dc },
        { stateOfChargeInkWh: battery * 0.6, maxPowerInkW: dc },
        { stateOfChargeInkWh: battery * 0.8, maxPowerInkW: dc * 0.5 },
        { stateOfChargeInkWh: battery * 0.95, maxPowerInkW: dc * 0.15 },
      ],
      chargingConnectors: [
        { currentType: 'AC3', plugTypes: PLUGS, efficiency: 0.9, baseLoadInkW: 0.2, maxPowerInkW: 11 },
        { currentType: 'DC', plugTypes: PLUGS, efficiency: 0.92, baseLoadInkW: 0.2, maxPowerInkW: dc, voltageRange: { minVoltageInV: 0, maxVoltageInV: 500 } },
      ],
      chargingTimeOffsetInSec: 120,
    },
  };
  const url = `${TT}/routing/1/calculateLongDistanceEVRoute/${points.map(loc).join(':')}/json?${query}`;
  const { json, fail } = await ask(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }, fetchImpl, 'no way to charge');
  if (fail) return fail;
  const route = json.routes?.[0];
  if (!route) return { status: 422, body: { error: 'no way to charge' } };
  const pct = (kwh) => (Number.isFinite(kwh) ? Math.round((kwh / battery) * 100) : null);
  // Each leg ends at a charger, at one of the trip's own stops, or at the end.
  // A charger is put before whichever of the trip's stops comes next.
  const stops = [];
  let passed = 0;
  for (const leg of route.legs || []) {
    const info = leg.summary?.chargingInformationAtEndOfLeg;
    if (!info) {
      passed++;
      continue;
    }
    const place = info.chargingParkLocation?.coordinate;
    const at = pair(place) || pair((leg.points || [])[(leg.points || []).length - 1]);
    if (!at) continue;
    stops.push({
      name: info.chargingParkName || info.chargingParkOperatorName || null,
      operator: info.chargingParkOperatorName || null,
      lng: at[0],
      lat: at[1],
      minutes: Number.isFinite(info.chargingTimeInSeconds) ? Math.max(1, Math.round(info.chargingTimeInSeconds / 60)) : null,
      arrive: pct(leg.summary?.remainingChargeAtArrivalInkWh),
      to: pct(info.targetChargeInkWh),
      kw: num(info.chargingConnectionInfo?.chargingPowerInkW) ?? num(info.chargingParkPowerInkW),
      before: passed,
    });
  }
  const sum = route.summary || {};
  return {
    status: 200,
    body: {
      stops,
      arrive: pct(sum.remainingChargeAtArrivalInkWh),
      charging: Number.isFinite(sum.totalChargingTimeInSeconds) ? Math.round(sum.totalChargingTimeInSeconds / 60) : 0,
      travel: num(sum.travelTimeInSeconds),
    },
  };
}

/* ---------- Directions, as a backup ---------- */

// Pintu reads routes in the form the Valhalla route planner gives them, so
// TomTom's answer is reshaped into that: one line per leg, with numbered turns.
const TURN = {
  DEPART: 1,
  ARRIVE: 4, ARRIVE_AHEAD: 4, ARRIVE_RIGHT: 5, ARRIVE_LEFT: 6,
  WAYPOINT_REACHED: 4, WAYPOINT_AHEAD: 4, WAYPOINT_RIGHT: 5, WAYPOINT_LEFT: 6,
  STRAIGHT: 8, FOLLOW: 8, TOLLGATE: 8, CROSS_BORDER: 8,
  BEAR_RIGHT: 9, SLIGHT_RIGHT: 9, TURN_RIGHT: 10, SHARP_RIGHT: 11,
  BEAR_LEFT: 16, SLIGHT_LEFT: 16, TURN_LEFT: 15, SHARP_LEFT: 14,
  MAKE_UTURN: 12, TRY_MAKE_UTURN: 12,
  KEEP_RIGHT: 23, KEEP_LEFT: 24, SWITCH_MAIN_ROAD: 22, SWITCH_PARALLEL_ROAD: 22,
  SWITCH_MOTORWAY_RIGHT: 23, SWITCH_MOTORWAY_LEFT: 24,
  MOTORWAY_EXIT_RIGHT: 20, EXIT_MOTORWAY_RIGHT: 20, MOTORWAY_EXIT_LEFT: 21, EXIT_MOTORWAY_LEFT: 21,
  MERGE_RIGHT_LANE: 37, MERGE_LEFT_LANE: 38,
  EXIT_ROUNDABOUT: 27,
  TAKE_FERRY: 28, TAKE_SHIP_FERRY: 28, LEAVE_SHIP_FERRY: 29,
};

export function turnType(ins) {
  const m = ins.maneuver || '';
  const angle = Number(ins.turnAngleInDecimalDegrees) || 0;
  if (m.startsWith('ROUNDABOUT_')) return 26;
  if (['ENTER_MOTORWAY', 'ENTER_FREEWAY', 'ENTER_HIGHWAY', 'ENTRANCE_RAMP'].includes(m)) return angle > 15 ? 18 : angle < -15 ? 19 : 17;
  if (m === 'TAKE_EXIT') return angle < 0 ? 21 : 20;
  return TURN[m] ?? 8;
}

const isWaypoint = (ins) => /^WAYPOINT_/.test(ins.maneuver || '');

const MODES = { auto: 'car', motorcycle: 'motorcycle', pedestrian: 'pedestrian' };

export function routeRequest(raw) {
  const locs = Array.isArray(raw?.locations) ? raw.locations : null;
  if (!locs || locs.length < 2 || locs.length > 25) return null;
  const ok = (l) => l && Number.isFinite(l.lat) && Number.isFinite(l.lon) && Math.abs(l.lat) <= 90 && Math.abs(l.lon) <= 180;
  if (!locs.every(ok)) return null;
  const mode = MODES[raw.costing] || 'car';
  // Points to pass without stopping can't be given to TomTom as such; its own
  // way between the stops is a fine backup.
  const stops = locs.filter((l, i) => i === 0 || i === locs.length - 1 || l.type !== 'through');
  const heading = Number.isFinite(locs[0].heading) ? Math.round(((locs[0].heading % 360) + 360) % 360) : null;
  return {
    stops: stops.map((l) => [l.lon, l.lat]),
    mode,
    heading,
    alternates: stops.length === 2 ? Math.min(2, Math.max(0, Number(raw.alternates) || 0)) : 0,
    avoidTolls: raw.costing_options?.auto?.use_tolls === 0,
  };
}

// The index along the line nearest a turn's point, never going backwards.
function indexOf(points, at, from) {
  let best = from, bestD = Infinity;
  for (let i = from; i < points.length; i++) {
    const d = (points[i][0] - at[0]) ** 2 + (points[i][1] - at[1]) ** 2;
    if (d < bestD) { best = i; bestD = d; }
    if (bestD < 1e-12) break;
  }
  return best;
}

export function toValhalla(route) {
  // One line for the whole route; a later leg starts where the last one ended.
  const points = [];
  for (const leg of route.legs || []) {
    for (const p of leg.points || []) {
      const pt = [p.longitude, p.latitude];
      const last = points[points.length - 1];
      if (last && last[0] === pt[0] && last[1] === pt[1]) continue;
      points.push(pt);
    }
  }
  if (points.length < 2) return null;
  const flagged = (type) => (route.sections || []).filter((x) => x.sectionType === type).map((x) => [x.startPointIndex, x.endPointIndex]);
  const tolls = flagged('TOLL_ROAD'), motorways = flagged('MOTORWAY'), ferries = flagged('FERRY');
  const overlaps = (spans, a, b) => spans.some(([s, e]) => s < Math.max(b, a + 1) && e > a);

  const raw = route.guidance?.instructions || [];
  let after = 0;
  const turns = raw.map((ins) => {
    const at = [ins.point?.longitude, ins.point?.latitude];
    const i = Number.isInteger(ins.pointIndex) && points[ins.pointIndex] && Math.abs(points[ins.pointIndex][0] - at[0]) < 1e-5
      ? ins.pointIndex
      : indexOf(points, at, after);
    after = Math.max(after, i);
    return { ins, i: Math.max(i, after) };
  });
  if (!turns.length) return null;

  const legs = [];
  let leg = { start: 0, turns: [] };
  for (const t of turns) {
    leg.turns.push(t);
    if (isWaypoint(t.ins)) {
      legs.push(leg);
      leg = { start: t.i, turns: [{ ins: { maneuver: 'DEPART', routeOffsetInMeters: t.ins.routeOffsetInMeters, travelTimeInSeconds: t.ins.travelTimeInSeconds, street: '' }, i: t.i }] };
    }
  }
  legs.push(leg);

  const out = legs.map((lg, n) => {
    const end = n < legs.length - 1 ? legs[n + 1].start : points.length - 1;
    const maneuvers = lg.turns.map((t, k) => {
      const next = lg.turns[k + 1];
      const ins = t.ins;
      const b = t.i, e = next ? next.i : end;
      const m = {
        type: turnType(ins),
        begin_shape_index: b - lg.start,
        end_shape_index: e - lg.start,
        length: Math.max(0, ((next?.ins.routeOffsetInMeters ?? ins.routeOffsetInMeters) - ins.routeOffsetInMeters) / 1000),
        time: Math.max(0, (next?.ins.travelTimeInSeconds ?? ins.travelTimeInSeconds) - ins.travelTimeInSeconds),
      };
      const names = [ins.street, ...(ins.roadNumbers || [])].filter(Boolean).filter((v, j, all) => all.indexOf(v) === j);
      if (names.length) m.street_names = names;
      if (Number.isInteger(ins.roundaboutExitNumber)) m.roundabout_exit_count = ins.roundaboutExitNumber;
      const sign = {};
      if (ins.exitNumber) sign.exit_number_elements = [{ text: String(ins.exitNumber) }];
      if (ins.signpostText) sign.exit_toward_elements = [{ text: ins.signpostText }];
      if (Object.keys(sign).length) m.sign = sign;
      if (overlaps(tolls, b, e)) m.toll = true;
      if (overlaps(motorways, b, e)) m.highway = true;
      if (overlaps(ferries, b, e)) m.ferry = true;
      if (ins.message) m.instruction = ins.message;
      return m;
    });
    // Each leg ends with arriving, as Valhalla's do.
    const last = maneuvers[maneuvers.length - 1];
    if (![4, 5, 6].includes(last.type)) maneuvers.push({ type: 4, begin_shape_index: end - lg.start, end_shape_index: end - lg.start, length: 0, time: 0 });
    const line = points.slice(lg.start, end + 1);
    return {
      shape: encodePolyline(line, 6),
      maneuvers,
      summary: { length: maneuvers.reduce((km, m) => km + m.length, 0), time: maneuvers.reduce((t, m) => t + m.time, 0) },
    };
  });
  const sum = route.summary || {};
  return {
    legs: out,
    summary: {
      length: (sum.lengthInMeters ?? 0) / 1000,
      time: sum.travelTimeInSeconds ?? 0,
      has_toll: tolls.length > 0,
      has_highway: motorways.length > 0,
      has_ferry: ferries.length > 0,
    },
    units: 'kilometers',
    status: 0,
  };
}

export async function askRoute(req, key, fetchImpl = fetch) {
  const query = new URLSearchParams({
    key,
    instructionsType: 'coded',
    language: 'en-GB',
    routeRepresentation: 'polyline',
    traffic: 'true',
    travelMode: req.mode,
  });
  for (const t of ['tollRoad', 'motorway', 'ferry']) query.append('sectionType', t);
  if (req.alternates) query.set('maxAlternatives', String(req.alternates));
  if (req.heading != null && req.mode !== 'pedestrian') query.set('vehicleHeading', String(req.heading));
  if (req.avoidTolls) query.append('avoid', 'tollRoads');
  const url = `${TT}/routing/1/calculateRoute/${req.stops.map(loc).join(':')}/json?${query}`;
  const { json, fail } = await ask(url, { method: 'GET' }, fetchImpl, 'no route');
  if (fail) return fail;
  const trips = (json.routes || []).map(toValhalla).filter(Boolean);
  if (!trips.length) return { status: 422, body: { error: 'no route' } };
  return { status: 200, body: { trip: trips[0], alternates: trips.slice(1).map((trip) => ({ trip })) } };
}

/* ---------- Fair use ---------- */

// The TomTom allowance is shared, and this server's address isn't secret, so
// each connection gets a generous number of requests a minute and no more.
// Counts are kept per server instance: enough to stop a runaway loop or
// someone helping themselves. If a Cloudflare rate limiting binding called
// TOMTOM_LIMITER is set up, it's used as well.
export const PER_MINUTE = { api: 40, tile: 400 };
const counts = new Map();

export function allowed(who, kind, now = Date.now()) {
  const key = `${kind}|${who}`;
  let c = counts.get(key);
  if (!c || now - c.start >= 60000) {
    c = { start: now, n: 0 };
    counts.set(key, c);
  }
  c.n++;
  if (counts.size > 5000) {
    for (const [k, v] of counts) if (now - v.start >= 60000) counts.delete(k);
  }
  return c.n <= PER_MINUTE[kind];
}

export const forgetCounts = () => counts.clear();

/* ---------- The routes ---------- */

export const TOMTOM_POSTS = ['/traffic', '/limits', '/ev', '/route'];

async function readJson(request) {
  try {
    const raw = await request.text();
    return raw.length < MAX_BODY ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// Answers anything TomTom's, or null if the path isn't one of these.
export async function tomtomRoute(request, url, origin, env, ctx, reply) {
  const key = env?.TOMTOM_API_KEY;
  const tile = tileRequest(url.pathname);
  const known = tile || ['/traffic', '/limits', '/geocode', '/ev', '/route'].includes(url.pathname);
  if (!known) return null;
  if (!key) {
    if (tile) return new Response(null, { status: 204, headers: { 'access-control-allow-origin': origin, vary: 'Origin' } });
    return reply({ error: 'no key' }, origin, 503);
  }
  const done = (result) => reply(result.body, origin, result.status, { 'cache-control': 'no-store' });

  const who = request.headers.get('cf-connecting-ip') || 'unknown';
  let ok = allowed(who, tile ? 'tile' : 'api');
  if (ok && !tile && env.TOMTOM_LIMITER?.limit) {
    try { ok = (await env.TOMTOM_LIMITER.limit({ key: who })).success; } catch { /* the count above stands */ }
  }
  if (!ok) {
    if (tile) return new Response(null, { status: 429, headers: { 'access-control-allow-origin': origin, vary: 'Origin', 'retry-after': '60' } });
    return reply({ error: 'busy' }, origin, 429, { 'retry-after': '60' });
  }

  if (tile) return tomtomTile(tile, key, origin, { ctx });

  if (url.pathname === '/geocode') {
    const q = (url.searchParams.get('q') || '').trim();
    if (q.length < 3 || q.length > 120) return reply({ error: 'not an address' }, origin, 400);
    const lat = Number(url.searchParams.get('lat')), lng = Number(url.searchParams.get('lon'));
    const near = Number.isFinite(lat) && Number.isFinite(lng) && url.searchParams.has('lat') ? { lat, lng } : null;
    return done(await askGeocode(q, near, key));
  }

  if (request.method !== 'POST') return reply({ error: 'send the route' }, origin, 405);
  const sent = await readJson(request);

  if (url.pathname === '/route') {
    const req = routeRequest(sent);
    if (!req) return reply({ error: 'not a trip' }, origin, 400);
    return done(await askRoute(req, key));
  }

  if (url.pathname === '/ev') {
    const ev = evRequest(sent);
    if (!ev) return reply({ error: 'not a trip' }, origin, 400);
    return done(await askEv(ev, key));
  }

  const points = routePoints(sent?.points);
  if (!points) return reply({ error: 'not a route' }, origin, 400);
  if (url.pathname === '/limits') return done(await askLimits(points, key));

  let arriveAt = null;
  if (typeof sent.arriveAt === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d)?([+-]\d\d:\d\d|Z)$/.test(sent.arriveAt)) arriveAt = sent.arriveAt;
  return done(await askTraffic(points, key, { better: !!sent.better, arriveAt }));
}

// Opening /traffic?check=1 in a browser says whether traffic works, and nothing more.
export async function trafficCheck(env) {
  const text = (body) => new Response(body, { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
  if (!env?.TOMTOM_API_KEY) return text('Traffic: no TomTom key yet. Add TOMTOM_API_KEY as a secret.');
  const result = await askTraffic(CHECK_ROUTE, env.TOMTOM_API_KEY);
  if (result.status === 200) return text(`Traffic: working. A test drive in KL came back with ${result.body.jams.length} slow stretch(es).`);
  if (result.status === 503) return text(`Traffic: TomTom refused the key. ${result.body.why || ''}`.trim());
  if (result.status === 429) return text('Traffic: the key works, but TomTom says it is busy or the allowance is used up.');
  return text('Traffic: TomTom did not answer properly. Try again in a minute.');
}
