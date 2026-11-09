// What a route passes before you set off: tolls with their fares, cameras, R&Rs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareTrip } from '../js/routing.js';
import { alongQuery, alongRoute, fetchAlong, clearAlongCache, linePoints, parseAlong, restsOnRoute, REST_OFF_M } from '../js/along.js';
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

test('one request covers every route, and asks only for what is needed', () => {
  const r = highwayTrip();
  const q = alongQuery([r, r]);
  assert.equal(q.match(/"barrier"="toll_booth"/g).length, 2);
  assert.match(q, /"highway"="speed_camera"/);
  assert.match(q, /"highway"~"\^\(services\|rest_area\)\$"/);
  assert.ok(linePoints(r).length <= 222);
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
