import test from 'node:test';
import assert from 'node:assert/strict';
import { TOLL_NOTICE_M, fetchTolls, parseTolls, tollAhead, tollQuery, tolledAt, tollsOnRoute } from '../js/tolls.js';
import { prepareTrip } from '../js/routing.js';
import { buildTrip, cityTrip, P, along } from './helpers/fixtures.js';

const tollTrip = () => prepareTrip(buildTrip(P.a, [
  { to: P.b, type: 1, street: 'Jalan Ampang', kph: 50 },
  { to: P.c, type: 10, street: 'Lebuhraya Duta', kph: 80, toll: true },
  { to: P.d, type: 15, street: 'Jalan Pinang', kph: 40 },
], { has_toll: true }));
const booth = (id, [lng, lat], tags = {}) => ({ type: 'node', id, lat, lon: lng, tags: { barrier: 'toll_booth', ...tags } });

test('asks for booths and gantries along the whole route', () => {
  const q = tollQuery([[101.7, 3.15], [101.71, 3.16]]);
  assert.match(q, /"barrier"="toll_booth"/);
  assert.match(q, /"highway"="toll_gantry"/);
  assert.match(q, /3\.15000,101\.70000,3\.16000,101\.71000/);
  assert.match(q, /out center/);
});

test('reads booths, plaza outlines and gantries, and nothing else', () => {
  const tolls = parseTolls({ elements: [
    booth(1, [101.7, 3.15], { name: 'Plaza Tol Gombak' }),
    { type: 'way', id: 2, center: { lat: 3.151, lon: 101.701 }, tags: { barrier: 'toll_booth' } },
    { type: 'node', id: 3, lat: 3.152, lon: 101.702, tags: { highway: 'toll_gantry' } },
    { type: 'node', id: 4, lat: 3.153, lon: 101.703, tags: { amenity: 'fuel' } },
    { type: 'node', id: 5, tags: { barrier: 'toll_booth' } },
  ] });
  assert.deepEqual(tolls.map((t) => [t.id, t.name, t.gantry]), [['node/1', 'Plaza Tol Gombak', false], ['way/2', null, false], ['node/3', null, true]]);
});

test('knows which stretches of the route are tolled', () => {
  const r = tollTrip();
  const startOfToll = r.maneuvers[1].beginDist;
  assert.equal(tolledAt(r, startOfToll + 200), true);
  assert.equal(tolledAt(r, startOfToll - 100), true, 'a plaza just before the toll road starts');
  assert.equal(tolledAt(r, 100), false);
});

test('a plaza on the route counts once, however many booths it has', () => {
  const r = tollTrip();
  const at = along(P.b, P.c, 0.5);
  const tolls = tollsOnRoute(r, parseTolls({ elements: [
    booth(1, at),
    booth(2, [at[0] + 0.0004, at[1]], { name: 'Plaza Tol Duta' }),   // the other carriageway, ~45 m off
    booth(3, [at[0] + 0.004, at[1]]),                                 // another road, 450 m away
  ] }));
  assert.equal(tolls.length, 1);
  assert.equal(tolls[0].name, 'Plaza Tol Duta', 'takes a name from any of its booths');
  assert.ok(Math.abs(tolls[0].along - (r.maneuvers[1].beginDist + 556)) < 30);
});

test('off the tolled stretch, only a booth right on the road counts', () => {
  const r = tollTrip();
  const a = along(P.a, P.b, 0.5);
  const near = tollsOnRoute(r, parseTolls({ elements: [booth(1, [a[0], a[1] + 0.0004])] }));   // ~45 m to the side
  assert.equal(near.length, 0, 'a car park barrier beside an ordinary road');
  const on = tollsOnRoute(r, parseTolls({ elements: [booth(1, [a[0], a[1] + 0.0001])] }));
  assert.equal(on.length, 1);
});

test('mentioned within reach, and gone once passed', () => {
  const tolls = [{ id: 'a', along: 3000 }, { id: 'b', along: 9000 }];
  assert.equal(tollAhead(tolls, 0), null, 'too far yet');
  assert.equal(tollAhead(tolls, 3000 - TOLL_NOTICE_M).toll.id, 'a');
  assert.equal(tollAhead(tolls, 2990).ahead, 10);
  assert.equal(tollAhead(tolls, 3010).ahead, 0, 'still at the booths');
  assert.equal(tollAhead(tolls, 3100), null);
  assert.equal(tollAhead(tolls, 7500).toll.id, 'b');
  assert.equal(tollAhead([], 0), null);
});

test('fetches through the shared Overpass helper', async () => {
  const r = prepareTrip(cityTrip());
  const asked = [];
  const fetchImpl = async (url, opts) => {
    asked.push(decodeURIComponent(String(opts.body)));
    return new Response(JSON.stringify({ elements: [booth(1, [101.705, 3.15])] }), { headers: { 'Content-Type': 'application/json' } });
  };
  const tolls = await fetchTolls(r, { fetchImpl, servers: ['https://one.test/api'] });
  assert.equal(tolls.length, 1);
  assert.match(asked[0], /toll_booth/);
});
