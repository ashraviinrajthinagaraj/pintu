// What a route passes before you set off: tolls with their fares, cameras, R&Rs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareTrip } from '../js/routing.js';
import { alongQuery, alongRoute, fetchAlong, findAlong, clearAlongCache, linePoints, parseAlong, restsOnRoute, routeBoxes, REST_OFF_M } from '../js/along.js';
import { FARES, fareAt, priceTolls, tollTotal } from '../js/toll-fares.js';
import { buildTrip, P, along } from './helpers/fixtures.js';

// Ordinary road, then the LDP, then KESAS, then a closed-system highway.
const Q = { a: [101.60, 3.10], b: [101.62, 3.10], c: [101.62, 3.13], d: [101.65, 3.13], e: [101.65, 3.16] };
const highwayTrip = () => prepareTrip(buildTrip(Q.a, [
  { to: Q.b, type: 1, street: 'Jalan Kenari', kph: 50 },
  { to: Q.c, type: 10, street: ['E11', 'Lebuhraya Damansara–Puchong'], kph: 90, toll: true, highway: true },
  { to: Q.d, type: 15, street: ['E5', 'Lebuhraya Shah Alam'], kph: 90, toll: true, highway: true },
  { to: Q.e, type: 10, street: ['E1', 'Lebuhraya Utara–Selatan'], kph: 100, toll: true, highway: true },
], { has_toll: true, has_highway: true }));
const node = (id, [lng, lat], tags) => ({ type: 'node', id, lat, lon: lng, tags });

test('every fare says where it was announced and since when', () => {
  for (const f of FARES) {
    assert.ok(f.rm > 0 && f.rm < 20, f.road);
    assert.match(f.since, /^\d{4}-\d\d-\d\d$/);
    assert.match(f.source, /^https:\/\//);
    assert.ok(f.refs.every((r) => /^E\d+$/.test(r)));
  }
});

test('one request covers every route, in small boxes along them, and asks only for what is needed', () => {
  const r = highwayTrip();
  const boxes = routeBoxes([r], 150);
  // Boxes along the route, every point of it inside one.
  for (const [lng, lat] of r.coords) assert.ok(boxes.some(([s, w, n, e]) => lat >= s && lat <= n && lng >= w && lng <= e), `${lng},${lat}`);
  // Not one big box over everything: 20 km of route in about 2 km squares.
  const area = boxes.reduce((sum, [s, w, n, e]) => sum + (n - s) * (e - w), 0);
  assert.ok(area < 0.03, `${area} square degrees`);
  // The same road twice doesn't ask twice.
  assert.deepEqual(routeBoxes([r, r], 150), boxes);
  const q = alongQuery([r, r]);
  assert.equal(q.match(/"barrier"="toll_booth"/g).length, boxes.length);
  assert.match(q, /node\["highway"="speed_camera"\]\(3\.\d+,101\.\d+,3\.\d+,101\.\d+\);/);
  assert.match(q, /nwr\["highway"="services"\]\(/);
  assert.match(q, /nwr\["highway"="rest_area"\]\(/);
  assert.doesNotMatch(q, /around:/, 'no "within so many metres of a line": the servers take most of a minute over it');
  assert.doesNotMatch(q, /"highway"~/, 'no patterns on the highway key: they make the server slow');
  const quick = alongQuery([r], { features: false, timeout: 15 });
  assert.match(quick, /^\[out:json\]\[timeout:15\]/);
  assert.doesNotMatch(quick, /traffic_signals|level_crossing|traffic_calming/);
  assert.match(alongQuery([r], { tolls: false, cameras: false, rests: false }), /traffic_signals[\s\S]*traffic_calming[\s\S]*level_crossing/);
  assert.ok(q.length < 60000, 'small enough to send');
});

test('sorts what comes back into tolls, cameras and places to stop', () => {
  const found = parseAlong({ elements: [
    node(1, Q.a, { barrier: 'toll_booth', name: 'Plaza Tol Penchala' }),
    node(2, Q.b, { highway: 'toll_gantry' }),
    node(3, Q.c, { highway: 'speed_camera', maxspeed: '90' }),
    { type: 'way', id: 4, center: { lat: 3.12, lon: 101.63 }, tags: { highway: 'services', name: 'R&R Awan Besar' } },
    node(5, Q.d, { highway: 'rest_area' }),
    node(6, Q.e, { amenity: 'fuel' }),
  ] });
  assert.deepEqual(found.tolls.map((t) => [t.id, t.gantry]), [['node/1', false], ['node/2', true]]);
  assert.deepEqual(found.cameras.map((c) => c.limit), [90]);
  assert.deepEqual(found.rests.map((x) => [x.kind, x.name]), [['rnr', 'R&R Awan Besar'], ['layby', '']]);
});

test('prices a plaza by the highway it stands on, and leaves the rest unknown', () => {
  const r = highwayTrip();
  const plaza = (id, at) => node(id, at, { barrier: 'toll_booth' });
  const { tolls } = alongRoute(r, parseAlong({ elements: [
    plaza(1, along(Q.b, Q.c, 0.5)),
    plaza(2, along(Q.c, Q.d, 0.5)),
    plaza(3, along(Q.d, Q.e, 0.5)),
  ] }));
  const priced = priceTolls(r, tolls);
  assert.deepEqual(priced.map((t) => [t.road, t.fare]), [['LDP', 2.1], ['KESAS', 2], [null, null]]);
  assert.equal(fareAt(r, { along: 10 }), null, 'an ordinary road has no fare');
  const sum = tollTotal(priced);
  assert.deepEqual(sum, { plazas: 3, priced: 2, unknown: 1, total: 4.1, roads: ['LDP', 'KESAS'], byDrivers: 0 });
  assert.equal(tollTotal([]).total, null, 'nothing known is not RM0');
  assert.equal(tollTotal(priced.slice(2)).total, null);
});

test('an R&R counts only if you can drive into it from your side of the road', () => {
  const r = highwayTrip();
  const mid = along(Q.c, Q.d, 0.5);           // heading east on KESAS
  const rests = restsOnRoute(r, [
    { id: 'left', kind: 'rnr', name: 'R&R Kiri', lng: mid[0], lat: mid[1] + 0.002 },             // north = your left
    { id: 'right', kind: 'rnr', name: 'R&R Kanan', lng: mid[0] + 0.003, lat: mid[1] - 0.002 },   // for the other way
    { id: 'far', kind: 'rnr', name: 'Jauh', lng: mid[0], lat: mid[1] + 0.02 },
    { id: 'twin', kind: 'layby', name: '', lng: mid[0] + 0.001, lat: mid[1] + 0.001 },            // the same place again
    { id: 'start', kind: 'layby', name: '', lng: Q.a[0], lat: Q.a[1] },
  ]);
  assert.deepEqual(rests.map((x) => [x.id, x.kind]), [['left', 'rnr']]);
  assert.ok(rests[0].off < REST_OFF_M);
});

test('asks once for the same routes, and says so when nobody answers', async () => {
  clearAlongCache();
  const r = highwayTrip();
  let asked = 0;
  const fetchImpl = async () => { asked++; return new Response(JSON.stringify({ elements: [node(1, Q.b, { highway: 'speed_camera' })] })); };
  const a = await fetchAlong([r], { fetchImpl, servers: ['https://one.example/api'] });
  const b = await fetchAlong([r], { fetchImpl, servers: ['https://one.example/api'] });
  assert.equal(asked, 1);
  assert.equal(a, b);
  assert.equal(a.cameras.length, 1);
  await assert.rejects(fetchAlong([highwayTrip()], { fetchImpl: async () => new Response('busy', { status: 429 }), servers: ['https://two.example/api'] }));
});

test('leaves out what isn\'t wanted', () => {
  const r = highwayTrip();
  const q = alongQuery([r], { tolls: false, cameras: false });
  assert.doesNotMatch(q, /toll_booth|toll_gantry|speed_camera/);
  assert.match(q, /rest_area/);
});

test('every Overpass server asked is one that holds the whole world', async () => {
  const { CONFIG } = await import('../js/config.js');
  // ovp.dresel.systems holds only Germany: for Malaysia it answers "nothing" faster than anyone.
  assert.ok(!CONFIG.overpass.some((s) => s.includes('dresel')));
  assert.ok(CONFIG.overpass.length >= 2);
});

test('a fare drivers paid fills a gap: from the same entry, or agreed by all', async () => {
  const { driverFare, priceTolls, tollTotal } = await import('../js/toll-fares.js');
  const exit = [{ prev: 'node/1', rm: 12.4 }, { prev: 'node/7', rm: 30.1 }, { prev: 'node/1', rm: 12.4 }];
  assert.equal(driverFare(exit, 'node/1'), 12.4, 'the same way on');
  assert.equal(driverFare(exit, 'node/9'), null, 'from somewhere else, and they disagree');
  assert.equal(driverFare([{ prev: 'node/3', rm: 2.3 }, { prev: null, rm: 2.3 }], 'node/9'), 2.3, 'an open plaza charges everyone the same');
  assert.equal(driverFare([], 'node/1'), null);
  const r = highwayTrip();
  const plaza = (id, at) => node(id, at, { barrier: 'toll_booth' });
  const { tolls } = alongRoute(r, parseAlong({ elements: [plaza(1, along(Q.b, Q.c, 0.5)), plaza(3, along(Q.d, Q.e, 0.5))] }));
  const priced = priceTolls(r, tolls, { 'node/3': [{ prev: 'node/1', rm: 5.5 }] });
  assert.deepEqual(priced.map((t) => [t.fare, t.byDrivers || false]), [[2.1, false], [5.5, true]]);
  assert.deepEqual(tollTotal(priced), { plazas: 2, priced: 2, unknown: 0, total: 7.6, roads: ['LDP'], byDrivers: 1 });
});

test('no more than two map-data requests at a time; the rest wait their turn', async () => {
  const { overpass, overpassBusy, AT_ONCE } = await import('../js/places.js');
  assert.equal(AT_ONCE, 2);
  const pending = [];
  const fetchImpl = (url, { signal }) => new Promise((resolve, reject) => {
    pending.push({ url, answer: () => resolve(new Response(JSON.stringify({ elements: [] }))) });
    signal.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')));
  });
  const servers = ['https://a.test/api', 'https://b.test/api'];
  const waits = { server: 5000 };
  const first = overpass('q1', { fetchImpl, servers, waits });
  const second = overpass('q2', { fetchImpl, servers, waits });
  const ctrl = new AbortController();
  const third = overpass('q3', { fetchImpl, servers, waits, signal: ctrl.signal });
  const fourth = overpass('q4', { fetchImpl, servers, waits });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(pending.length, 4, 'two requests, each to two servers');
  assert.deepEqual(overpassBusy(), { running: 2, waiting: 2 });
  // One given up while waiting is never sent.
  ctrl.abort();
  assert.equal(await third, null);
  pending[0].answer();
  assert.deepEqual(await first, { elements: [] });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(pending.length, 6, 'the next in line goes once one is done');
  for (const p of pending.slice(2)) p.answer();
  await Promise.all([second, fourth]);
  assert.deepEqual(overpassBusy(), { running: 0, waiting: 0 });
});

/* ---------- The copy kept with the app ---------- */

import { readFile } from 'node:fs/promises';
import { dataNear, expand, forgetAlongData, loadAlongData, nearRoute } from '../js/along-data.js';
import { compact, serialise } from '../scripts/along-data.mjs';

const kept = async () => JSON.parse(await readFile(new URL('../data/along.json', import.meta.url), 'utf8'));

test('the kept copy is from OpenStreetMap, recent, and of a sensible size', async () => {
  const json = await kept();
  assert.match(json.source, /OpenStreetMap/);
  assert.match(json.updated, /^\d{4}-\d\d-\d\d$/);
  const data = expand(json);
  assert.ok(data.tolls.length >= 300 && data.cameras.length >= 20 && data.rests.length >= 100);
  for (const x of [...data.tolls, ...data.cameras, ...data.rests]) {
    assert.match(x.id, /^(node|way|relation)\/\d+$/);
    assert.ok(x.lat > 0.5 && x.lat < 7.6 && x.lng > 99.5 && x.lng < 119.5, x.id);
  }
});

test('built from the map server’s answer, and read back the same as one', () => {
  const answer = { elements: [
    node(1, Q.a, { barrier: 'toll_booth', name: 'Plaza Tol Penchala' }),
    node(2, Q.b, { highway: 'toll_gantry' }),
    node(3, Q.c, { highway: 'speed_camera', maxspeed: '90' }),
    { type: 'way', id: 4, center: { lat: 3.12, lon: 101.63 }, tags: { highway: 'services', name: 'R&R Awan Besar' } },
    node(5, Q.d, { highway: 'rest_area' }),
    node(6, Q.e, { amenity: 'fuel' }),
  ] };
  const fromKept = expand(JSON.parse(serialise(compact(answer, '2026-11-15'))));
  const fromServer = parseAlong(answer);
  assert.deepEqual(fromKept.tolls, fromServer.tolls);
  assert.deepEqual(fromKept.cameras, fromServer.cameras);
  assert.deepEqual([...fromKept.rests].sort((a, b) => a.id.localeCompare(b.id)), [...fromServer.rests].sort((a, b) => a.id.localeCompare(b.id)));
  assert.throws(() => expand({ elements: [] }));
});

test('only what is near the route is kept, and a route by Sungai Besi finds its plaza', async () => {
  const data = expand(await kept());
  // Up the Besraya past the SMART Sungai Besi plaza.
  const r = prepareTrip(buildTrip([101.7040, 3.0950], [{ to: [101.7000, 3.1200], type: 1, street: ['E9', 'Lebuhraya Besraya'], kph: 80, toll: true, highway: true }], { has_toll: true }));
  const near = nearRoute(r);
  assert.equal(near({ lng: 101.7020, lat: 3.1080 }), true);
  assert.equal(near({ lng: 101.80, lat: 3.30 }), false);
  const found = dataNear(data, [r]);
  assert.ok(found.tolls.length > 0 && found.tolls.length < 40, `${found.tolls.length}`);
  assert.ok(found.tolls.some((t) => /Sungai Besi/.test(t.name)));
  assert.ok(alongRoute(r, found).tolls.length >= 1);
});

test('the kept copy first; a map server only if it can’t be had', async () => {
  forgetAlongData();
  clearAlongCache();
  const r = highwayTrip();
  const asked = [];
  const json = serialise(compact({ elements: [node(1, along(Q.b, Q.c, 0.5), { barrier: 'toll_booth', name: 'Plaza Kept' })] }, '2026-11-15'));
  const fetchImpl = async (u) => {
    asked.push(String(u));
    if (String(u).endsWith('data/along.json')) return new Response(json);
    return new Response(JSON.stringify({ elements: [node(2, along(Q.b, Q.c, 0.5), { barrier: 'toll_booth', name: 'Plaza From Server' })] }));
  };
  const a = await findAlong([r], { fetchImpl, servers: ['https://a.test/api'] });
  assert.equal(a.fromData, true);
  assert.deepEqual(a.tolls.map((t) => t.name), ['Plaza Kept']);
  assert.deepEqual(asked, ['./data/along.json']);

  forgetAlongData();
  const missing = async (u) => (String(u).endsWith('data/along.json') ? new Response('', { status: 404 }) : fetchImpl(u));
  const b = await findAlong([r], { fetchImpl: missing, servers: ['https://a.test/api'] });
  assert.deepEqual(b.tolls.map((t) => t.name), ['Plaza From Server']);
  forgetAlongData();
});
