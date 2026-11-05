import test from 'node:test';
import assert from 'node:assert/strict';
import { buildQuery, clearPlacesCache, findAlongRoute, parseElements, placeOnRoute, rankAlongRoute, routeSample } from '../js/places.js';
import { prepareTrip } from '../js/routing.js';
import { P, buildTrip, cityTrip } from './helpers/fixtures.js';

const route = () => prepareTrip(cityTrip());
const OSM = { elements: [
  { type: 'node', id: 1, lat: 3.1502, lon: 101.705, tags: { amenity: 'fuel', name: 'Petronas Ampang', brand: 'Petronas' } },
  { type: 'way', id: 2, center: { lat: 3.1498, lon: 101.702 }, tags: { amenity: 'fuel', brand: 'Shell' } },
  { type: 'node', id: 3, lat: 3.17, lon: 101.75, tags: { amenity: 'fuel' } },
  { type: 'relation', id: 4, tags: { amenity: 'fuel' } },
] };

test('asks Overpass for the right kind of place along the line', () => {
  const q = buildQuery('fuel', [[101.7, 3.15], [101.71, 3.15]]);
  assert.match(q, /\[out:json\]/);
  assert.match(q, /nwr\["amenity"="fuel"\]\(around:1500,3\.15000,101\.70000,3\.15000,101\.71000\);/);
  assert.match(buildQuery('surau', [[101.7, 3.15]]), /"religion"="muslim"/);
  assert.match(buildQuery('rest', [[101.7, 3.15]]), /services\|rest_area/);
  assert.match(buildQuery('ev', [[101.7, 3.15]]), /charging_station/);
});

test('keeps long routes down to a reasonable request', () => {
  const long = prepareTrip(buildTrip([100.3, 5.4], [{ to: [101.7, 3.15], type: 1, street: 'E1', kph: 100 }]));
  const pts = routeSample(long, 0);
  assert.ok(pts.length >= 2 && pts.length <= 125, String(pts.length));
  assert.ok(buildQuery('fuel', pts).length < 6000);
});

test('search starts from where you are now', () => {
  const r = route();
  const pts = routeSample(r, 1500);
  assert.ok(pts[0][1] > P.a[1], 'skips the road already behind you');
});

test('reads places, using the brand when there is no name', () => {
  const places = parseElements(OSM, 'fuel');
  assert.equal(places.length, 3);
  assert.equal(places[0].name, 'Petronas Ampang');
  assert.equal(places[1].name, 'Shell');
  assert.equal(places[1].lat, 3.1498);
  assert.equal(places[2].name, '');
});

test('works out how far ahead and which side', () => {
  const r = route();
  const left = placeOnRoute(r, { lng: 101.705, lat: 3.1502 }, 0);
  assert.ok(left.ahead > 500 && left.ahead < 600, String(left.ahead));
  assert.ok(left.off > 15 && left.off < 30, String(left.off));
  assert.equal(left.side, 'left');
  assert.equal(placeOnRoute(r, { lng: 101.705, lat: 3.1498 }, 0).side, 'right');
  assert.equal(placeOnRoute(r, { lng: 101.705, lat: 3.15 }, 0).side, null);
});

test('only counts what is still ahead, nearest first', () => {
  const r = route();
  const places = parseElements(OSM, 'fuel');
  const ranked = rankAlongRoute(r, places, 0);
  assert.deepEqual(ranked.slice(0, 2).map((p) => p.name), ['Shell', 'Petronas Ampang']);
  assert.equal(ranked.length, 2, 'the one 4 km off the route is dropped');
  const later = rankAlongRoute(r, places.slice(0, 2), 800);
  for (const p of later) assert.ok(p.ahead >= 0);
  assert.ok(later.every((p) => p.along >= 800));
});

test('the same place mapped twice appears once', () => {
  const r = route();
  const a = { id: 'a', name: 'Shell', lng: 101.705, lat: 3.1501 };
  const b = { id: 'b', name: 'Shell', lng: 101.7051, lat: 3.1501 };
  const far = { id: 'c', name: 'Shell', lng: 101.709, lat: 3.1501 };
  assert.equal(rankAlongRoute(r, [a, b, far], 0).length, 2);
});

test('falls back to the next server, reusing results afterwards', async () => {
  clearPlacesCache();
  const r = route();
  const calls = [];
  const fetchImpl = async (u, init) => {
    calls.push(u);
    assert.equal(init.method, 'POST');
    assert.match(init.body.toString(), /^data=/);
    if (u.includes('a.test')) return new Response('busy', { status: 429 });
    return new Response(JSON.stringify(OSM));
  };
  const servers = ['https://a.test/i', 'https://b.test/i'];
  const places = await findAlongRoute(r, 'fuel', 0, { fetchImpl, servers });
  assert.ok(places.length >= 2);
  assert.equal(calls.length, 2);
  await findAlongRoute(r, 'fuel', 200, { fetchImpl, servers });
  assert.equal(calls.length, 2, 'same route, no new request');
  await findAlongRoute(r, 'surau', 200, { fetchImpl, servers });
  assert.equal(calls.length, 4, 'different category');
});

test('reports failure when no server answers', async () => {
  clearPlacesCache();
  await assert.rejects(findAlongRoute(route(), 'ev', 0, {
    servers: ['https://a.test/i'],
    fetchImpl: async () => { throw new TypeError('offline'); },
  }));
});
