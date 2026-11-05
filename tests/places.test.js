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

test('a server that goes quiet is abandoned, and rested afterwards', async (t) => {
  clearPlacesCache();
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const r = route();
  const calls = [];
  const fetchImpl = (u, init) => {
    calls.push(u);
    if (u.includes('quiet')) {
      return new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))));
    }
    return Promise.resolve(new Response(JSON.stringify(OSM)));
  };
  const servers = ['https://quiet.test/i', 'https://b.test/i'];
  const pending = findAlongRoute(r, 'fuel', 0, { fetchImpl, servers });
  await new Promise((res) => setImmediate(res));
  t.mock.timers.tick(12001);
  const places = await pending;
  assert.ok(places.length >= 2);
  assert.deepEqual(calls, servers);
  t.mock.timers.reset();
  await findAlongRoute(r, 'surau', 0, { fetchImpl, servers });
  assert.equal(calls.length, 3, 'the quiet one is left alone for now');
  assert.equal(calls[2], 'https://b.test/i');
});

test('"OK" with a time-out note counts as no answer', async () => {
  clearPlacesCache();
  const r = route();
  const calls = [];
  const fetchImpl = async (u) => {
    calls.push(u);
    if (u.includes('late')) return new Response(JSON.stringify({ elements: [], remark: 'runtime error: Query timed out' }));
    return new Response(JSON.stringify(OSM));
  };
  const places = await findAlongRoute(r, 'fuel', 0, { fetchImpl, servers: ['https://late.test/i', 'https://b.test/i'] });
  assert.ok(places.length >= 2);
  assert.equal(calls.length, 2);
});

test('a server saying "too many requests" is not asked again straight away', async () => {
  clearPlacesCache();
  const r = route();
  let n = 0;
  const fetchImpl = async (u) => {
    if (u.includes('busy')) { n++; return new Response('', { status: 429 }); }
    return new Response(JSON.stringify(OSM));
  };
  const servers = ['https://busy.test/i', 'https://b.test/i'];
  await findAlongRoute(r, 'fuel', 0, { fetchImpl, servers });
  await findAlongRoute(r, 'ev', 0, { fetchImpl, servers });
  await findAlongRoute(r, 'rest', 0, { fetchImpl, servers });
  assert.equal(n, 1);
});

test('nonsense from a server moves on to the next', async () => {
  clearPlacesCache();
  const fetchImpl = async (u) => (u.includes('bad') ? new Response('<html>busy</html>') : new Response(JSON.stringify(OSM)));
  const places = await findAlongRoute(route(), 'fuel', 0, { fetchImpl, servers: ['https://bad.test/i', 'https://b.test/i'] });
  assert.ok(places.length >= 2);
});

test('with every Overpass server down, the search service is asked instead', async () => {
  clearPlacesCache();
  const urls = [];
  const fetchImpl = async (u) => {
    urls.push(String(u));
    if (String(u).includes('over.test')) return new Response('', { status: 504 });
    return new Response(JSON.stringify({ features: [
      { type: 'Feature', geometry: { type: 'Point', coordinates: [101.705, 3.1502] }, properties: { name: 'Petronas', osm_type: 'N', osm_id: 5, osm_key: 'amenity', osm_value: 'fuel' } },
      { type: 'Feature', geometry: { type: 'Point', coordinates: [101.7051, 3.1503] }, properties: { name: 'Kedai Buku', osm_type: 'N', osm_id: 6, osm_key: 'shop', osm_value: 'books' } },
    ] }));
  };
  const places = await findAlongRoute(route(), 'fuel', 0, { fetchImpl, servers: ['https://over.test/i'] });
  assert.equal(places[0].name, 'Petronas');
  assert.equal(places.length, 1, 'the same place from several points counts once');
  const photon = urls.filter((u) => u.includes('photon'));
  assert.ok(photon.length >= 2 && photon.length <= 4, String(photon.length));
  assert.match(photon[0], /include=osm\.amenity\.fuel/);
  assert.match(photon[0], /lat=3\.\d+&lon=101\.\d+/);
});

test('the search service only offers mosques and surau as surau', async () => {
  clearPlacesCache();
  const fetchImpl = async (u) => {
    if (String(u).includes('over.test')) return new Response('', { status: 504 });
    const worship = (name, id, lng) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [lng, 3.1502] }, properties: { name, osm_type: 'N', osm_id: id, osm_key: 'amenity', osm_value: 'place_of_worship' } });
    return new Response(JSON.stringify({ features: [worship('Surau Al-Hidayah', 1, 101.705), worship('St Mary Church', 2, 101.7051), worship('Masjid Jamek', 3, 101.7052)] }));
  };
  const places = await findAlongRoute(route(), 'surau', 0, { fetchImpl, servers: ['https://over.test/i'] });
  assert.deepEqual(places.map((p) => p.name).sort(), ['Masjid Jamek', 'Surau Al-Hidayah']);
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
  assert.equal(calls.length, 3, 'different category, and the busy server is left alone');
});

test('reports failure when no server answers', async () => {
  clearPlacesCache();
  await assert.rejects(findAlongRoute(route(), 'ev', 0, {
    servers: ['https://a.test/i'],
    fetchImpl: async () => { throw new TypeError('offline'); },
  }));
  clearPlacesCache();
});
