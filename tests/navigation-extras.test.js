// Speed cameras, parking, leaving on time, toll roads and junction pictures.
import test from 'node:test';
import assert from 'node:assert/strict';
import { alertDistance, cameraAhead, cameraQuery, camerasOnRoute, fetchCameras, parseCameras, samplePoints } from '../js/cameras.js';
import { findParking, isParking, rankParking, tilesAround } from '../js/parking.js';
import { leaveBy } from '../js/leaveby.js';
import { junctionFor, junctionSvg } from '../js/junction.js';
import { prepareTrip } from '../js/routing.js';
import { clearPlacesCache } from '../js/places.js';
import { buildTrip, cityTrip, P, along } from './helpers/fixtures.js';
import { encodeTile } from './helpers/mvt.js';

const route = prepareTrip(cityTrip());

/* ---------- Speed cameras ---------- */

test('cameras are asked for along the whole route, in one request', () => {
  const points = samplePoints(route);
  assert.deepEqual(points[0], route.coords[0]);
  assert.deepEqual(points.at(-1), route.coords.at(-1));
  assert.ok(points.length <= 401);
  const q = cameraQuery(points);
  assert.match(q, /node\["highway"="speed_camera"\]\(around:150,3\.15000,101\.70000,/);
  assert.match(q, /out tags/);
});

test('a camera\'s limit is read when it\'s mapped, and only a sensible one', () => {
  const cams = parseCameras({ elements: [
    { type: 'node', id: 1, lat: 3.15, lon: 101.705, tags: { highway: 'speed_camera', maxspeed: '90' } },
    { type: 'node', id: 2, lat: 3.15, lon: 101.706, tags: { maxspeed: 'signals' } },
    { type: 'node', id: 3, lat: 3.15, lon: 101.707, tags: { maxspeed: '900' } },
    { type: 'node', id: 4, tags: {} },
  ] });
  assert.deepEqual(cams.map((c) => [c.id, c.limit]), [['node/1', 90], ['node/2', null], ['node/3', null]]);
});

test('only cameras on your side of the road count, each once, in order', () => {
  const on = along(P.a, P.b, 0.5);
  const later = along(P.b, P.c, 0.5);
  const cams = camerasOnRoute(route, [
    { id: 'later', lng: later[0], lat: later[1], limit: null },
    { id: 'on', lng: on[0], lat: on[1], limit: 60 },
    { id: 'twin', lng: on[0] + 0.0001, lat: on[1], limit: 60 },
    { id: 'across', lng: on[0], lat: on[1] + 0.0003, limit: 60 },
    { id: 'away', lng: 101.75, lat: 3.2, limit: 60 },
  ]);
  assert.deepEqual(cams.map((c) => c.id), ['on', 'later']);
  assert.ok(Math.abs(cams[0].along - 555) < 30, String(cams[0].along));
});

test('a camera is mentioned early enough to slow down, and dropped once passed', () => {
  const cams = [{ id: 'x', along: 1000 }, { id: 'y', along: 3000 }];
  assert.equal(alertDistance(0), 300);
  assert.equal(alertDistance(30), 750);
  assert.equal(alertDistance(60), 800);
  assert.equal(cameraAhead(cams, 0, 10), null, 'too far yet');
  assert.deepEqual(cameraAhead(cams, 600, 25), { camera: cams[0], ahead: 400 });
  assert.equal(cameraAhead(cams, 1010, 25).camera.id, 'x', 'just past it, still shown');
  assert.equal(cameraAhead(cams, 1030, 25), null);
  assert.equal(cameraAhead(cams, 2500, 25).camera.id, 'y');
  assert.equal(cameraAhead([], 0, 25), null);
  assert.equal(cameraAhead(undefined, 0, 25), null);
});

test('cameras come from Overpass, and no answer is an error, not "no cameras"', async () => {
  clearPlacesCache();
  const asked = [];
  const ok = async (url, init) => { asked.push(String(init.body)); return new Response(JSON.stringify({ elements: [{ id: 5, lat: 3.15, lon: 101.705, tags: {} }] })); };
  const cams = await fetchCameras(route, { fetchImpl: ok, servers: ['https://o.test/a'] });
  assert.equal(cams.length, 1);
  assert.match(decodeURIComponent(asked[0]), /speed_camera/);
  clearPlacesCache();
  const down = async () => new Response('', { status: 504 });
  await assert.rejects(fetchCameras(route, { fetchImpl: down, servers: ['https://o.test/a', 'https://o.test/b'] }));
  clearPlacesCache();
});

/* ---------- Toll roads ---------- */

test('each route knows how far it runs on toll roads', () => {
  const trip = prepareTrip(buildTrip(P.a, [
    { to: P.b, type: 1, street: 'Jalan A' },
    { to: P.c, type: 18, street: 'E2', toll: true, highway: true },
    { to: P.d, type: 10, street: 'Jalan B' },
  ], { has_toll: true }));
  assert.equal(trip.hasToll, true);
  assert.ok(Math.abs(trip.tollKm - 1.11) < 0.05, String(trip.tollKm));
  assert.equal(prepareTrip(cityTrip()).tollKm, 0);
});

/* ---------- Parking ---------- */

const dest = { lng: 101.7, lat: 3.15 };
const spot = (dx, dy, props) => ({ id: `${dx}/${dy}`, lng: dest.lng + dx, lat: dest.lat + dy, ...props });

test('car parks, not bicycle racks, and motorcycle bays only on a motorcycle', () => {
  assert.equal(isParking({ class: 'parking', subclass: 'parking' }), true);
  assert.equal(isParking({ class: 'entrance', subclass: 'parking_entrance' }), true);
  assert.equal(isParking({ class: 'parking', subclass: 'bicycle_parking' }), false);
  assert.equal(isParking({ class: 'parking', subclass: 'motorcycle_parking' }), false);
  assert.equal(isParking({ class: 'parking', subclass: 'motorcycle_parking' }, 'motorcycle'), true);
  assert.equal(isParking({ class: 'fuel', subclass: 'fuel' }), false);
});

test('the closest car parks first, each only once, within a short walk', () => {
  const list = rankParking([
    spot(0.003, 0, { name: 'Far', class: 'parking', subclass: 'parking' }),
    spot(0.001, 0, { name: 'Near', class: 'parking', subclass: 'parking' }),
    spot(0.0012, 0, { name: 'Near', class: 'parking', subclass: 'parking_entrance' }),
    spot(0.0001, 0.0001, { name: '', class: 'parking', subclass: 'parking' }),
    spot(0.01, 0, { name: 'Too far', class: 'parking', subclass: 'parking' }),
    spot(0.0005, 0, { name: 'Racks', class: 'parking', subclass: 'bicycle_parking' }),
  ], dest);
  assert.deepEqual(list.map((p) => p.name), ['', 'Near', 'Far']);
  assert.ok(list[1].distance > 100 && list[1].distance < 120, String(list[1].distance));
});

test('the tiles around a place cover it, and no more than needed', () => {
  const tiles = tilesAround(dest.lng, dest.lat, 500);
  assert.ok(tiles.length >= 1 && tiles.length <= 4, String(tiles.length));
  assert.ok(tiles.every((t) => t.z === 14));
});

test('car parks are read from the real tile format', async () => {
  const tiles = tilesAround(dest.lng, dest.lat, 500);
  const fetchImpl = async (url) => {
    const [, x, y] = url.match(/14\/(\d+)\/(\d+)/).map(Number);
    const here = tiles.find((t) => t.x === x && t.y === y) || { z: 14, x, y };
    const poi = [
      { id: 1, lng: dest.lng + 0.001, lat: dest.lat, props: { name: 'Parkir A', class: 'parking', subclass: 'parking' } },
      { id: 2, lng: dest.lng + 0.0005, lat: dest.lat, props: { name: 'Kedai', class: 'shop', subclass: 'convenience' } },
    ];
    return new Response(encodeTile(here, { poi }));
  };
  const list = await findParking(dest, { fetchImpl, tileUrl: 'https://t.test/{z}/{x}/{y}.pbf' });
  assert.equal(list[0].name, 'Parkir A');
  await assert.rejects(findParking(dest, { fetchImpl: async () => new Response('', { status: 500 }), tileUrl: 'https://t.test/{z}/{x}/{y}.pbf' }));
});

/* ---------- Leaving on time ---------- */

test('when to leave, to arrive by a time', () => {
  const now = new Date(2026, 10, 7, 8, 0).getTime();
  const plan = leaveBy(now, '09:00', 1800);
  assert.equal(plan.leave.getHours(), 8);
  assert.equal(plan.leave.getMinutes(), 30);
  assert.equal(plan.late, false);
  assert.equal(plan.tomorrow, false);
});

test('too late is said plainly, with when you\'d get there', () => {
  const now = new Date(2026, 10, 7, 8, 50).getTime();
  const plan = leaveBy(now, '09:00', 1800);
  assert.equal(plan.late, true);
  assert.equal(Math.round(plan.lateBy / 60), 20);
  assert.equal(plan.arriveIfNow.getHours(), 9);
  assert.equal(plan.arriveIfNow.getMinutes(), 20);
});

test('a time that has passed today means tomorrow', () => {
  const now = new Date(2026, 10, 7, 20, 0).getTime();
  const plan = leaveBy(now, '07:30', 1800);
  assert.equal(plan.tomorrow, true);
  assert.equal(plan.late, false);
  assert.equal(plan.leave.getDate(), 8);
  assert.equal(plan.leave.getHours(), 7);
});

test('nonsense times are ignored', () => {
  for (const bad of ['', '25:00', '9', 'abc', null]) assert.equal(leaveBy(Date.now(), bad, 600), null, String(bad));
});

/* ---------- Junction pictures ---------- */

test('exits, ramps and forks get a picture, and ordinary turns don\'t', () => {
  assert.deepEqual(junctionFor({ type: 20 }), { take: 'right', others: ['straight'], exitNo: '', branch: '', toward: '' });
  assert.equal(junctionFor({ type: 21 }).take, 'left');
  assert.equal(junctionFor({ type: 23 }).take, 'right');
  assert.deepEqual(junctionFor({ type: 24 }).others, ['right']);
  assert.equal(junctionFor({ type: 17 }).take, 'straight');
  for (const type of [1, 4, 10, 15, 26, 25]) assert.equal(junctionFor({ type }), null, String(type));
  assert.equal(junctionFor(null), null);
});

test('a junction picture carries the exit\'s signs', () => {
  const j = junctionFor({ type: 20, sign: { exit_number_elements: [{ text: '235' }], exit_branch_elements: [{ text: 'E35' }], exit_toward_elements: [{ text: 'Seremban' }] } });
  assert.deepEqual([j.exitNo, j.branch, j.toward], ['235', 'E35', 'Seremban']);
});

test('the picture shows the road to take, with an arrow, and no words', () => {
  for (const type of [17, 18, 19, 20, 21, 22, 23, 24]) {
    const svg = junctionSvg(junctionFor({ type, sign: { exit_toward_elements: [{ text: '<script>' }] } }));
    assert.equal((svg.match(/class="jv-route"/g) || []).length, 2, String(type));
    assert.equal((svg.match(/class="jv-head"/g) || []).length, 1);
    assert.doesNotMatch(svg, /script|<text/);
  }
});
